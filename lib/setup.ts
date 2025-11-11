import { parse } from "csv-parse/sync";
import { adminGraphQL, adminREST } from "@/lib/shopify";

export async function runFullSetup({ shop, token }: { shop: string; token: string }) {
  // 1) Pages
  const livraisonHTML = `
    <h2>Livraison GRATUITE</h2>
    <p>Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:</p>
    <ul>
      <li>France : 4–10 jours ouvrables</li>
      <li>Belgique : 4–10 jours ouvrables</li>
      <li>Suisse : 7–12 jours ouvrables</li>
      <li>Canada : 7–12 jours ouvrables</li>
      <li>Reste du monde : 7–14 jours</li>
    </ul>`;

  const ensurePage = async (title: string, bodyHtml: string) => {
    const found = await adminGraphQL<{ pages: { nodes: { id: string }[] } }>({
      shop, token,
      query: `#graphql
        query($q:String!){ pages(first:1, query:$q){ nodes{ id } } }`,
      variables: { q: `title:${title}` }
    });
    if (found.pages.nodes[0]) {
      await adminGraphQL({
        shop, token,
        query: `#graphql
          mutation($id:ID!,$page:PageUpdateInput!){
            pageUpdate(id:$id,page:$page){ page{ id } userErrors{ message } }
          }`,
        variables: { id: found.pages.nodes[0].id, page: { title, bodyHtml } }
      });
    } else {
      await adminGraphQL({
        shop, token,
        query: `#graphql
          mutation($page:PageCreateInput!){
            pageCreate(page:$page){ page{ id } userErrors{ message } }
          }`,
        variables: { page: { title, bodyHtml } }
      });
    }
  };
  await ensurePage("Livraison", livraisonHTML);
  await ensurePage("FAQ", "<p>Crée ta FAQ ici</p>");

  // 2) Collections automatiques par tag
  const ensureSmartCollectionByTag = async (title: string, tag: string) => {
    const exists = await adminGraphQL<{ collections: { nodes: { id: string }[] } }>({
      shop, token,
      query: `#graphql
        query($q:String!){ collections(first:1, query:$q){ nodes{ id } } }`,
      variables: { q: `title:${title}` }
    });
    const input = {
      title,
      ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: tag }] }
    };
    if (exists.collections.nodes[0]) {
      await adminGraphQL({
        shop, token,
        query: `#graphql
          mutation($input:CollectionInput!){
            collectionUpdate(input:$input){ userErrors{ message } }
          }`,
        variables: { input: { id: exists.collections.nodes[0].id, ...input } }
      });
    } else {
      await adminGraphQL({
        shop, token,
        query: `#graphql
          mutation($input:CollectionInput!){
            collectionCreate(input:$input){ userErrors{ message } }
          }`,
        variables: { input }
      });
    }
  };
  await ensureSmartCollectionByTag("Beauté & soins", "Beauté & soins");
  await ensureSmartCollectionByTag("Maison & confort", "Maison & confort");

  // 3) Menu principal FR
  const menus = await adminGraphQL<{ menus: { nodes: { id: string; handle: string; isDefault: boolean }[] } }>({
    shop, token, query: `#graphql { menus(first:50){ nodes{ id handle isDefault } } }`
  });
  const main = menus.menus.nodes.find(m => m.handle === "main-menu") || menus.menus.nodes.find(m => m.isDefault);
  if (main) {
    const pages = await adminGraphQL<{ pages: { nodes: { id: string; title: string }[] } }>({
      shop, token, query: `#graphql { pages(first:10){ nodes{ id title } } }`
    });
    const livraison = pages.pages.nodes.find(p => p.title === "Livraison");
    const faq = pages.pages.nodes.find(p => p.title === "FAQ");
    await adminGraphQL({
      shop, token,
      query: `#graphql
        mutation($id:ID!,$items:[MenuItemUpdateInput!]!){
          menuUpdate(id:$id,title:"Menu principal",handle:"main-menu",items:$items){
            userErrors{ message } menu{ id }
          }
        }`,
      variables: {
        id: main.id,
        items: [
          { title: "Accueil", type: "FRONTPAGE", items: [] },
          { title: "Nos produits", type: "CATALOG", items: [] },
          { title: "Livraison", type: "PAGE", resourceId: livraison?.id, items: [] },
          { title: "FAQ", type: "PAGE", resourceId: faq?.id, items: [] },
          { title: "Contact", type: "CONTACT", items: [] }
        ]
      }
    });
  }

  // 4) Import produits depuis ton CSV (gère variantes)
  if (process.env.PRODUCTS_CSV_URL) {
    const txt = await fetch(process.env.PRODUCTS_CSV_URL).then(r => r.text());
    const rows: any[] = parse(txt, { columns: true, skip_empty_lines: true });

    // groupage par Handle (plusieurs lignes = variantes d’un même produit)
    const byHandle: Record<string, any[]> = {};
    for (const r of rows) {
      const handle = String(r["Handle"] ?? r["handle"] ?? r["Slug"] ?? "").trim();
      if (!handle) continue;
      (byHandle[handle] ||= []).push(r);
    }

    const CREATE = `#graphql
      mutation($input:ProductInput!,$media:[CreateMediaInput!]){
        productCreate(input:$input, media:$media){
          product{ id }
          userErrors{ message }
        }
      }`;

    const val = (v: any) => (v ?? "").toString().trim();
    const bool = (v: any) => ["true","1","oui","yes","vrai"].includes(val(v).toLowerCase());

    for (const [handle, group] of Object.entries(byHandle)) {
      const base = group[0];
      const title = val(base["Title"]) || handle;
      const descriptionHtml = base["Body (HTML)"] ?? base["Body"] ?? "";
      const vendor = val(base["Vendor"]) || undefined;
      const tags = val(base["Tags"]) ? val(base["Tags"]).split(",").map((t:string)=>t.trim()).filter(Boolean) : [];

      const optionNames = [val(base["Option1 Name"]), val(base["Option2 Name"]), val(base["Option3 Name"])].filter(Boolean) as string[];

      const optionValues: Record<string, Set<string>> = {};
      optionNames.forEach(n => (optionValues[n] = new Set()));
      for (const r of group) {
        optionNames.forEach((n, idx) => {
          const vv = val(r[`Option${idx+1} Value`]);
          if (vv) optionValues[n].add(vv);
        });
      }
      const options = optionNames.map(n => ({ name: n, values: Array.from(optionValues[n]) }));

      const variants = group.map(r => ({
        sku: val(r["Variant SKU"]) || undefined,
        price: val(r["Variant Price"]) || undefined,
        compareAtPrice: val(r["Variant Compare At Price"]) || undefined,
        requiresShipping: val(r["Variant Requires Shipping"]) ? bool(r["Variant Requires Shipping"]) : true,
        taxable: val(r["Variant Taxable"]) ? bool(r["Variant Taxable"]) : undefined,
        barcode: val(r["Variant Barcode"]) || undefined,
        options: [val(r["Option1 Value"]) || undefined, val(r["Option2 Value"]) || undefined, val(r["Option3 Value"]) || undefined].filter(v => v !== undefined)
      }));

      const imageSet = new Set<string>();
      for (const r of group) {
        const a = val(r["Image Src"]) || val(r["Image URL"]) || val(r["image_url"]) || "";
        const b = val(r["Variant Image"]) || "";
        [a, b].forEach(u => { if (u && /^https?:\/\//.test(u)) imageSet.add(u); });
      }
      const media = Array.from(imageSet).map(u => ({ originalSource: u, mediaContentType: "IMAGE" as const }));

      const input: any = { handle, title, descriptionHtml, vendor, tags, options, variants, status: "ACTIVE" };
      await adminGraphQL({ shop, token, query: CREATE, variables: { input, media } });
    }
  }

  // 5) Thème : upload & publication (role: main)
  if (process.env.THEME_ZIP_URL) {
    await adminREST({
      shop, token,
      path: "/themes.json",
      method: "POST",
      json: { theme: { name: "Client Theme", src: process.env.THEME_ZIP_URL, role: "main" } }
    });
  }
}
