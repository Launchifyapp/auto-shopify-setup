// redeploy
// lib/shopify.js
export const gqlAdmin = (shop, token) => async (query, variables) => {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });
  if (res.status === 429) {
    const retry = Number(res.headers.get('Retry-After') || 1);
    await new Promise(r => setTimeout(r, retry * 1000));
    return gqlAdmin(shop, token)(query, variables);
  }
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
};

/** -------- (1) Metafield definitions produit -------- */
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

async function upsertProductMetafieldDef(shop, token, def){
  const gql = gqlAdmin(shop, token);
  const exist = await gql(DEF_GET, { ownerType: "PRODUCT", namespace: def.namespace, key: def.key });
  if (exist.metafieldDefinitionByOwnerType?.id) return;
  const input = { name: def.name, key: def.key, namespace: def.namespace, ownerType: "PRODUCT", type: "SINGLE_LINE_TEXT_FIELD" };
  const r = await gql(DEF_CREATE, { definition: input });
  const err = r.metafieldDefinitionCreate?.userErrors?.[0];
  if (err) throw new Error(`${err.field}: ${err.message}`);
}

export async function createProductCheckboxes(shop, token){
  const defs = [
    { name: "Checkbox 1", namespace: "custom", key: "checkbox_1" },
    { name: "Checkbox 2", namespace: "custom", key: "checkbox_2" },
    { name: "Checkbox 3", namespace: "custom", key: "checkbox_3" },
  ];
  for (const d of defs) await upsertProductMetafieldDef(shop, token, d);
}

/** -------- (2) Import produits CSV (simple) -------- */
function parseCsv(text){
  const rows = [];
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return rows;
  const headers = lines[0].split(",").map(h=>h.trim());
  for (let i=1;i<lines.length;i++){
    const cols = lines[i].split(",");
    const obj = {};
    headers.forEach((h, idx)=> obj[h] = (cols[idx] ?? "").trim());
    rows.push(obj);
  }
  return rows;
}

async function findProductByHandle(shop, token, handle){
  const r = await fetch(`https://${shop}/admin/api/2025-01/products.json?handle=${encodeURIComponent(handle)}`, {
    headers: { 'X-Shopify-Access-Token': token }
  }).then(r=>r.json());
  return r.products?.[0] || null;
}
function slugify(t){
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}
async function createOrUpdateProduct(shop, token, row){
  const handle = row.Handle || slugify(row.Title);
  const existing = await findProductByHandle(shop, token, handle);
  const base = {
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
export async function importProductsFromCsv(shop, token, csvUrl){
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

async function uploadImageFile(shop, token, filename, publicUrl, mime="image/jpeg"){
  const gql = gqlAdmin(shop, token);
  const up = await gql(STAGED_UPLOADS_CREATE, { input: [{ resource:"FILE", filename, mimeType:mime, httpMethod:"POST" }]});
  const target = up.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  target.parameters.forEach((p)=>form.append(p.name, p.value));
  const bin = await fetch(publicUrl).then(r=>r.arrayBuffer());
  form.append('file', new Blob([bin]), filename);
  await fetch(target.url, { method:'POST', body: form });
  const res = await gql(FILE_CREATE, { files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: filename }]});
  const err = res.fileCreate?.userErrors?.[0]; if (err) throw new Error(err.message);
}
export async function uploadAllImages(shop, token, files){
  if (!files?.length) return;
  for (const f of files) {
    const mime = f.filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    await uploadImageFile(shop, token, f.filename, f.url, mime);
  }
}

/** -------- (4) Pages -------- */
export async function upsertPage(shop, token, handle, title, bodyHtml){
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
export async function upsertMainMenuFR(shop, token){
  const gql = gqlAdmin(shop, token);
  const handle = "main-menu";
  const q = await gql(MENU_QUERY, { handle });
  const items = frMainMenuItems();
  if (q.menu?.id) { await gql(MENU_UPDATE, { id: q.menu.id, title: "Menu principal", items }); }
  else { await gql(MENU_CREATE, { handle, title: "Menu principal", items }); }
}

/** -------- (6) Smart collections par tag -------- */
async function upsertSmartCollectionByTag(shop, token, title, tag){
  const list = await fetch(`https://${shop}/admin/api/2025-01/smart_collections.json?title=${encodeURIComponent(title)}`, {
    headers: { 'X-Shopify-Access-Token': token }
  }).then(r=>r.json());
  const payload = {
    smart_collection: {
      title,
      rules: [{ column:"tag", relation:"equals", condition: tag }],
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
export async function createCollections(shop, token){
  await upsertSmartCollectionByTag(shop, token, "Beauté & soins", "Beauté & soins");
  await upsertSmartCollectionByTag(shop, token, "Maison & confort", "Maison & confort");
}
