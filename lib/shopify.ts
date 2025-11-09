// lib/shopify.ts
export const gqlAdmin = (shop: string, token: string) => async <T>(query: string, variables?: any): Promise<T> => {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') || 1);
    await new Promise(r => setTimeout(r, retry * 1000));
    return gqlAdmin(shop, token)<T>(query, variables);
  }
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
};

/** -------- (1) Metafield definitions produit -------- */
type MFDef = { name: string; namespace: string; key: string; type: "single_line_text_field" };

const DEF_GET = `
query($ownerType:MetafieldOwnerType!, $namespace:String!, $key:String!){
  metafieldDefinitionByOwnerType(ownerType:$ownerType, namespace:$namespace, key:$key){ id }
}`;
const DEF_CREATE = `
mutation($definition: MetafieldDefinitionInput!){
  metafieldDefinitionCreate(definition:$definition){
    createdDefinition{ id }
    userErrors{ field message }
  }
}`;

async function upsertProductMetafieldDef(shop:string, token:string, def: MFDef){
  const gql = gqlAdmin(shop, token);
  const exist = await gql<any>(DEF_GET, { ownerType: "PRODUCT", namespace: def.namespace, key: def.key });
  if (exist.metafieldDefinitionByOwnerType?.id) return;
  const input = { name: def.name, key: def.key, namespace: def.namespace, ownerType: "PRODUCT", type: "SINGLE_LINE_TEXT_FIELD" };
  const r = await gql<any>(DEF_CREATE, { definition: input });
  const err = r.metafieldDefinitionCreate?.userErrors?.[0];
  if (err) throw new Error(`${err.field}: ${err.message}`);
}

export async function createProductCheckboxes(shop:string, token:string){
  const defs: MFDef[] = [
    { name: "Checkbox 1", namespace: "custom", key: "checkbox_1", type: "single_line_text_field" },
    { name: "Checkbox 2", namespace: "custom", key: "checkbox_2", type: "single_line_text_field" },
    { name: "Checkbox 3", namespace: "custom", key: "checkbox_3", type: "single_line_text_field" },
  ];
  for (const d of defs) await upsertProductMetafieldDef(shop, token, d);
}

/** -------- (2) Import produits CSV (simple) -------- */
type CsvRow = {
  Title:string; Handle?:string; "Body (HTML)"?:string; Vendor?:string; Tags?:string;
  "Variant SKU"?:string; "Variant Price"?:string; "Image Src"?:string; "Option1 Name"?:string; "Option1 Value"?:string;
};

// petit parser CSV sans dépendance (OK si séparateur virgule, sinon je te mets PapaParse)
function parseCsv(text:string): CsvRow[] {
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = headerLine.split(",").map(h=>h.trim());
  return lines.map(line=>{
    const cols = line.split(","); // basique : si ton CSV contient des virgules entre guillemets, on passera à PapaParse
    const obj:any = {};
    headers.forEach((h, i)=> obj[h] = (cols[i] ?? "").trim());
    return obj as CsvRow;
  });
}

async function findProductByHandle(shop:string, token:string, handle:string){
  const r = await fetch(`https://${shop}/admin/api/2025-01/products.json?handle=${encodeURIComponent(handle)}`, {
    headers: { 'X-Shopify-Access-Token': token }
  }).then(r=>r.json());
  return r.products?.[0] || null;
}

function slugify(t:string){
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}

async function createOrUpdateProduct(shop:string, token:string, row: CsvRow){
  const handle = row.Handle || slugify(row.Title);
  const existing = await findProductByHandle(shop, token, handle);

  const base:any = {
    title: row.Title,
    body_html: row["Body (HTML)"] || '',
    vendor: row.Vendor || '',
    tags: row.Tags || '',
    handle,
    variants: [{ sku: row["Variant SKU"] || undefined, price: row["Variant Price"] || undefined, option1: row["Option1 Value"] || "Default" }],
    options: row["Option1 Name"] ? [{ name: row["Option1 Name"] }] : undefined,
    images: row["Image Src"] ? [{ src: row["Image Src"] }] : undefined,
    status: "active"
  };

  if (existing) {
    await fetch(`https://${shop}/admin/api/2025-01/products/${existing.id}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ product: { id: existing.id, ...base } })
    });
  } else {
    await fetch(`https://${shop}/admin/api/2025-01/products.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ product: base })
    });
  }
}

export async function importProductsFromCsv(shop:string, token:string, csvUrl:string){
  if (!csvUrl) return;
  const text = await fetch(csvUrl).then(r=>r.text());
  const rows = parseCsv(text);
  for (const row of rows) { if (row?.Title) await createOrUpdateProduct(shop, token, row); }
}

/** -------- (3) Upload fichiers (.jpg) -> Files -------- */
const STAGED_UPLOADS_CREATE = `
mutation($input:[StagedUploadInput!]!){
  stagedUploadsCreate(input:$input){ stagedTargets { url resourceUrl parameters { name value } } userErrors{ field message } }
}`;
const FILE_CREATE = `
mutation($files:[FileCreateInput!]!){
  fileCreate(files:$files){ files { id alt } userErrors { field message } }
}`;

async function uploadImageFile(shop:string, token:string, filename:string, publicUrl:string, mime="image/jpeg"){
  const gql = gqlAdmin(shop, token);
  const up = await gql<any>(STAGED_UPLOADS_CREATE, { input: [{ resource:"FILE", filename, mimeType:mime, httpMethod:"POST" }]});
  const target = up.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  target.parameters.forEach((p:any)=>form.append(p.name, p.value));
  const bin = await fetch(publicUrl).then(r=>r.arrayBuffer());
  form.append('file', new Blob([bin]), filename);
  await fetch(target.url, { method:'POST', body: form });
  const res = await gql<any>(FILE_CREATE, { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: filename }]});
  const err = res.fileCreate?.userErrors?.[0]; if (err) throw new Error(err.message);
}

export async function uploadAllImages(shop:string, token:string, files:{filename:string; url:string}[]){
  if (!files?.length) return;
  for (const f of files) await uploadImageFile(shop, token, f.filename, f.url);
}

/** -------- (4) Pages -------- */
export async function upsertPage(shop:string, token:string, handle:string, title:string, bodyHtml:string){
  const find = await fetch(`https://${shop}/admin/api/2025-01/pages.json?handle=${encodeURIComponent(handle)}`, {
    headers: { 'X-Shopify-Access-Token': token }
  }).then(r=>r.json());
  const payload = { page: { handle, title, body_html: bodyHtml, published: true } };
  if (find.pages?.length) {
    const id = find.pages[0].id;
    await fetch(`https://${shop}/admin/api/2025-01/pages/${id}.json`, {
      method: 'PUT', headers: { 'Content-Type':'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify(payload)
    });
  } else {
    await fetch(`https://${shop}/admin/api/2025-01/pages.json`, {
      method: 'POST', headers: { 'Content-Type':'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify(payload)
    });
  }
}

/** -------- (5) Menu principal FR -------- */
const MENU_QUERY = `query($handle:String!){ menu(handle:$handle){ id } }`;
const MENU_UPDATE = `
mutation($id:ID!, $title:String, $items:[MenuItemUpdateInput!]){
  menuUpdate(id:$id, title:$title, items:$items){ menu{ id } userErrors{ field message } }
}`;
const MENU_CREATE = `
mutation($handle:String!, $title:String!, $items:[MenuItemCreateInput!]){
  menuCreate(handle:$handle, title:$title, items:$items){ menu{ id } userErrors{ field message } }
}`;

function frMainMenuItems(){
  return [
    { title: "Accueil", type: "HOME" },
    { title: "Nos produits", type: "CATALOG" },
    { title: "Livraison", type: "HTTP", url: "/pages/livraison" },
    { title: "FAQ", type: "HTTP", url: "/pages/faq" },
    { title: "Contact", type: "HTTP", url: "/pages/contact" }
  ];
}

export async function upsertMainMenuFR(shop:string, token:string){
  const gql = gqlAdmin(shop, token);
  const handle = "main-menu";
  const q = await gql<any>(MENU_QUERY, { handle });
  const items = frMainMenuItems();
  if (q.menu?.id) {
    await gql<any>(MENU_UPDATE, { id: q.menu.id, title: "Menu principal", items });
  } else {
    await gql<any>(MENU_CREATE, { handle, title: "Menu principal", items });
  }
}

/** -------- (6) Smart collections par tag -------- */
type Rule = { column:"tag"; relation:"equals"; condition:string };

async function upsertSmartCollectionByTag(shop:string, token:string, title:string, tag:string){
  const list = await fetch(`https://${shop}/admin/api/2025-01/smart_collections.json?title=${encodeURIComponent(title)}`, {
    headers: { 'X-Shopify-Access-Token': token }
  }).then(r=>r.json());

  const payload = {
    smart_collection: {
      title,
      rules: [{ column:"tag", relation:"equals", condition: tag }] as Rule[],
      disjunctive: false, published: true
    }
  };

  if (list.smart_collections?.length) {
    const id = list.smart_collections[0].id;
    await fetch(`https://${shop}/admin/api/2025-01/smart_collections/${id}.json`, {
      method:'PUT', headers:{ 'Content-Type':'application/json','X-Shopify-Access-Token':token }, body: JSON.stringify(payload)
    });
  } else {
    await fetch(`https://${shop}/admin/api/2025-01/smart_collections.json`, {
      method:'POST', headers:{ 'Content-Type':'application/json','X-Shopify-Access-Token':token }, body: JSON.stringify(payload)
    });
  }
}

export async function createCollections(shop:string, token:string){
  await upsertSmartCollectionByTag(shop, token, "Beauté & soins", "Beauté & soins");
  await upsertSmartCollectionByTag(shop, token, "Maison & confort", "Maison & confort");
}
