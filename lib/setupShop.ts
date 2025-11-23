import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";
import fs from "fs";
import path from "path";
import { request } from "undici";
import { FormData } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { Readable } from "stream";

// ========== UPLOAD IMAGE LOCAL USING SHOPIFY STAGED UPLOAD PATCHED (undici + formdata-node + form-data-encoder) ==========
async function uploadImageStaged(session: Session, localPath: string, filename: string, mimeType: string, resource: string,) {
  // CALCUL FILE SIZE
  const stat = fs.statSync(localPath);
  const fileSize = stat.size.toString();

  // 1. Get staged upload target (resource: IMAGE, fileSize required)
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters {
            name
            value
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    input: [
      {
        filename,
        mimeType,
        resource,
        fileSize
      }
    ]
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.stagedUploadsCreate?.userErrors?.length) {
    console.error("Erreur stagedUploadsCreate:", response.data.stagedUploadsCreate.userErrors);
    return null;
  }
  const target = response?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    console.error("No staged target for upload.");
    return null;
  }

  // Log debug
  console.log("[StagedUpload] URL:", target.url);
  console.log("[StagedUpload] fileSize:", fileSize);
  console.log("[StagedUpload] Parameters:", target.parameters);
  console.log("[StagedUpload] File:", localPath, filename, mimeType);

  // 2. Compose form-data with all parameters first, then file last
  const form = new FormData();
  for (const param of target.parameters) {
    form.append(param.name, param.value);
  }
  form.append("file", fs.createReadStream(localPath));
  const encoder = new FormDataEncoder(form);
  const stream = Readable.from(encoder.encode());

  // 3. POST to S3 staged upload URL
  const { statusCode, body } = await request(target.url, {
    method: "POST",
    body: stream,
    headers: encoder.headers
  });
  if (statusCode < 200 || statusCode >= 300) {
    const buf = [];
    for await (const chunk of body) buf.push(chunk);
    const errorPayload = Buffer.concat(buf).toString();
    console.error("Erreur S3 response:", errorPayload);
    throw new Error(`Erreur upload S3 via undici: status ${statusCode}`);
  }

  // 4. fileCreate mutation (resource: IMAGE)
  const mutation = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          id
          alt
          createdAt
          __typename
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const createVars = {
    files: [{
      originalSource: target.resourceUrl,
      contentType: "IMAGE",
      alt: filename
    }]
  };
  const fileResp: any = await client.request(mutation, { variables: createVars });
  if (fileResp?.data?.fileCreate?.userErrors?.length) {
    console.error("Erreur fileCreate:", fileResp.data.fileCreate.userErrors);
    return null;
  }
  console.log(`[StagedFile] Uploadé :`, fileResp.data.fileCreate.files);
  return fileResp?.data?.fileCreate?.files?.[0]?.id ?? null;
}
// ========== END Staged upload image ==========

// Recherche l'id de la collection principale ("all" ou titre "Produits" ou "All" ou "Tous les produits")
async function getAllProductsCollectionId(session: Session): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query Collections {
      collections(first: 10) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const response: any = await client.request(query);
  const edges = response?.data?.collections?.edges ?? [];
  let coll = edges.find((e: any) => e?.node?.handle === "all");
  if (!coll) coll = edges.find((e: any) => {
    const title = e?.node?.title?.toLowerCase();
    return title === "produits" || title === "all" || title === "tous les produits";
  });
  if (!coll && edges.length > 0) coll = edges[0];
  if (coll) return coll.node.id;
  return null;
}

async function getPageIdByHandle(session: Session, handle: string): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query Pages {
      pages(first: 50) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const response: any = await client.request(query);
  const edges = response?.data?.pages?.edges ?? [];
  const found = edges.find((e: any) => e.node.handle === handle);
  return found ? found.node.id : null;
}

async function debugListAllPages(session: Session) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query {
      pages(first: 50) {
        edges {
          node {
            id
            handle
            title
          }
        }
      }
    }
  `;
  const response: any = await client.request(query);
  const edges = response?.data?.pages?.edges ?? [];
  console.log("Pages existantes:");
  edges.forEach((e: any) => {
    console.log(e.node.title, e.node.handle, e.node.id);
  });
}

async function getMainMenuIdAndTitle(session: Session): Promise<{id: string, title: string} | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query GetMenus {
      menus(first: 10) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  `;
  const response: any = await client.request(query);
  const edges = response?.data?.menus?.edges ?? [];
  const mainMenu = edges.find((e: any) => e.node.handle === "main-menu");
  if (mainMenu) return {id: mainMenu.node.id, title: mainMenu.node.title};
  if (edges.length) return {id: edges[0].node.id, title: edges[0].node.title};
  return null;
}

async function updateMainMenu(
  session: Session,
  menuId: string,
  menuTitle: string,
  livraisonPageId: string | null,
  collectionId: string | null,
  contactPageId: string | null
) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation UpdateMenu($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(
        id: $id,
        title: $title,
        items: $items
      ) {
        menu {
          id
          title
          items {
            id
            title
            resourceId
            type
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const items = [
    {
      title: "Accueil",
      type: "FRONTPAGE"
    },
    collectionId && {
      title: "Nos Produits",
      type: "COLLECTION",
      resourceId: collectionId
    },
    livraisonPageId && {
      title: "Livraison",
      type: "PAGE",
      resourceId: livraisonPageId
    },
    contactPageId
      ? {
        title: "Contact",
        type: "PAGE",
        resourceId: contactPageId
      }
      : {
        title: "Contact",
        type: "HTTP",
        url: "/pages/contact"
      }
  ].filter(Boolean);
  const variables = {
    id: menuId,
    title: menuTitle,
    items
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.menuUpdate?.userErrors?.length) {
    console.error("Erreur menuUpdate:", response.data.menuUpdate.userErrors);
    if (
      response.data.menuUpdate.userErrors.some((err: any) => (err.message || "").toLowerCase().includes("page not found"))
    ) {
      await debugListAllPages(session);
    }
  } else {
    console.log("[Menu principal] Mis à jour :", response.data.menuUpdate.menu);
  }
}

async function createLivraisonPageWithSDK(session: Session): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation CreatePage($input: PageCreateInput!) {
      pageCreate(page: $input) {
        page {
          id
          title
          handle
        }
        userErrors { code field message }
      }
    }
  `;
  const variables = {
    input: {
      title: "Livraison",
      handle: "livraison",
      body: `Livraison GRATUITE
Le traitement des commandes prend de 1 à 3 jours ouvrables avant l'expédition. Une fois l'article expédié, le délai de livraison estimé est le suivant:

France : 4-10 jours ouvrables
Belgique: 4-10 jours ouvrables
Suisse : 7-12 jours ouvrables
Canada : 7-12 jours ouvrables
Reste du monde : 7-14 jours
`,
      isPublished: true,
      templateSuffix: "custom"
    }
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.pageCreate?.userErrors?.length) {
    console.error("Erreur création page Livraison:", response.data.pageCreate.userErrors);
    return null;
  }
  const pageId = response?.data?.pageCreate?.page?.id ?? null;
  if (pageId) console.log("Page Livraison créée :", response.data.pageCreate.page);
  return pageId;
}

function normalizeImageUrl(url: string): string {
  return url.replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
}

function extractCheckboxMetafields(row: any): any[] {
  const metafields: any[] = [];
  if (row["Checkbox 1 (product.metafields.custom.checkbox_1)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_1",
      type: "single_line_text_field",
      value: row["Checkbox 1 (product.metafields.custom.checkbox_1)"].toString()
    });
  }
  if (row["Checkbox 2 (product.metafields.custom.checkbox_2)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_2",
      type: "single_line_text_field",
      value: row["Checkbox 2 (product.metafields.custom.checkbox_2)"].toString()
    });
  }
  if (row["Checkbox 3 (product.metafields.custom.checkbox_3)"] !== undefined) {
    metafields.push({
      namespace: "custom",
      key: "checkbox_3",
      type: "single_line_text_field",
      value: row["Checkbox 3 (product.metafields.custom.checkbox_3)"].toString()
    });
  }
  return metafields;
}

async function createProductMedia(session: Session, productId: string, imageUrl: string, altText: string = ""): Promise<string | undefined> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on MediaImage { id image { url } status }
        }
        mediaUserErrors { field message }
      }
    }
  `;
  const variables = { productId, media: [{
    originalSource: imageUrl,
    mediaContentType: "IMAGE",
    alt: altText
  }]};
  const response: any = await client.request(query, { variables });
  return response?.data?.productCreateMedia?.media?.[0]?.id;
}

async function getProductMediaStatus(session: Session, productId: string, mediaId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query getProductMedia($id: ID!) {
      product(id: $id) {
        media(first: 20) {
          edges {
            node {
              ... on MediaImage {
                id
                status
                image { url }
              }
            }
          }
        }
      }
    }
  `;
  const response: any = await client.request(query, { variables: { id: productId } });
  const edges = response?.data?.product?.media?.edges ?? [];
  const node = edges.find((e: any) => e?.node?.id === mediaId)?.node;
  return node ? node.status : undefined;
}

async function waitForMediaReady(session: Session, productId: string, mediaId: string, timeoutMs = 15000) {
  const start = Date.now();
  while (true) {
    const status = await getProductMediaStatus(session, productId, mediaId);
    if (status === "READY") return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise(res => setTimeout(res, 1500));
  }
}

async function appendMediaToVariant(session: Session, productId: string, variantId: string, mediaId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
      productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
        product { id }
        productVariants {
          id
          media(first: 10) {
            edges {
              node {
                mediaContentType
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
        userErrors { code field message }
      }
    }
  `;
  const variables = {
    productId,
    variantMedia: [
      {
        variantId,
        mediaIds: [mediaId]
      }
    ],
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.productVariantAppendMedia?.userErrors?.length) {
    console.error("Erreur rattachement media à variante :", response.data.productVariantAppendMedia.userErrors);
  }
  return response?.data?.productVariantAppendMedia?.productVariants;
}

async function updateDefaultVariantWithSDK(
  session: Session,
  productId: string,
  variantId: string,
  main: any
) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price compareAtPrice sku barcode }
        userErrors { field message }
      }
    }
  `;
  const variant: any = {
    id: variantId,
    price: main["Variant Price"] ?? "0",
    ...(main["Variant Compare At Price"] ? { compareAtPrice: main["Variant Compare At Price"] } : {}),
    ...(main["Variant SKU"] ? { sku: main["Variant SKU"] } : {}),
    ...(main["Variant Barcode"] ? { barcode: main["Variant Barcode"] } : {}),
  };
  const variables = {
    productId,
    variants: [variant],
  };
  const response: any = await client.request(query, { variables });
  const data = response?.data?.productVariantsBulkUpdate;
  if (data?.userErrors?.length) {
    console.error("Erreur maj variante (bulkUpdate):", data.userErrors);
  } else {
    console.log("Variante maj (bulkUpdate):", data.productVariants?.[0]);
  }
  return data?.productVariants?.[0]?.id;
}

async function bulkCreateVariantsWithSDK(
  session: Session,
  productId: string,
  variants: any[]
) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id price sku barcode compareAtPrice }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    productId,
    variants,
  };
  const response: any = await client.request(query, { variables });
  const data = response;
  return data?.data?.productVariantsBulkCreate;
}

async function createProductWithSDK(session: Session, product: any) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation productCreate($input: ProductCreateInput!) {
      productCreate(product: $input) {
        product {
          id
          handle
          variants(first: 50) {
            edges { node { id sku title selectedOptions { name value } price compareAtPrice barcode }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const variables = { input: product };
  const response: any = await client.request(query, { variables });
  const data = response;
  return data?.data?.productCreate;
}

export async function setupShop({ session }: { session: Session }) {
  try {
    const imagesToUpload = [
      { file: "image1.jpg", mime: "image/jpeg", resource: "IMAGE" },
      { file: "image2.jpg", mime: "image/jpeg", resource: "IMAGE" },
      { file: "image3.jpg", mime: "image/jpeg", resource: "IMAGE" },
      { file: "image4.webp", mime: "image/webp", resource: "IMAGE" }
    ];
    for (const img of imagesToUpload) {
      const localPath = path.join(process.cwd(), "public", img.file);
      await uploadImageStaged(session, localPath, img.file, img.mime, img.resource);
    }
    // ... le reste de setupShop (pages, menus, produits ...)
  } catch (err) {
    console.error("Erreur globale setupShop:", err);
  }
}
