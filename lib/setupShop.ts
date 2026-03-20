import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";
import { Language, t } from "@/lib/i18n";
import { getProductLimit } from "@/lib/utils/licenseStore";

// Search for main collection ID
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
    return title === "produits" || title === "products" || title === "all" || title === "tous les produits" || title === "all products";
  });
  if (!coll && edges.length > 0) coll = edges[0];
  if (coll) return coll.node.id;
  return null;
}

// Search for page ID by handle
async function getPageIdByHandle(session: Session, handle: string): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query Pages {
      pages(first: 10) {
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

// Debug: list all pages
async function debugListAllPages(session: Session) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query {
      pages(first: 30) {
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
  console.log("Existing pages:");
  edges.forEach((e: any) => {
    console.log(e.node.title, e.node.handle, e.node.id);
  });
}

// Get main menu ID and title
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

// Update main menu with language-specific labels
async function updateMainMenu(
  session: Session,
  menuId: string,
  menuTitle: string,
  shippingPageId: string | null,
  collectionId: string | null,
  contactPageId: string | null,
  lang: Language
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
            url
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
      title: t(lang, "menuHome"),
      type: "FRONTPAGE",
      url: "/"
    },
    collectionId && {
      title: t(lang, "menuProducts"),
      type: "COLLECTION",
      resourceId: collectionId
    },
    shippingPageId && {
      title: t(lang, "menuShipping"),
      type: "PAGE",
      resourceId: shippingPageId
    },
    contactPageId
      ? {
          title: t(lang, "menuContact"),
          type: "PAGE",
          resourceId: contactPageId
        }
      : {
          title: t(lang, "menuContact"),
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
    console.error("Menu update error:", response.data.menuUpdate.userErrors);
    if (
      response.data.menuUpdate.userErrors.some((err: any) => (err.message || "").toLowerCase().includes("page not found"))
    ) {
      await debugListAllPages(session);
    }
  } else {
    console.log("[Main menu] Updated:", response.data.menuUpdate.menu);
  }
}

// Create shipping page with language-specific content
async function createShippingPageWithSDK(session: Session, lang: Language): Promise<string | null> {
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
      title: t(lang, "shippingPageTitle"),
      handle: t(lang, "shippingPageHandle"),
      body: t(lang, "shippingPageBody"),
      isPublished: true,
      templateSuffix: "custom"
    }
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.pageCreate?.userErrors?.length) {
    console.error("Shipping page creation error:", response.data.pageCreate.userErrors);
    return null;
  }
  const pageId = response?.data?.pageCreate?.page?.id ?? null;
  if (pageId) console.log("Shipping page created:", response.data.pageCreate.page);
  return pageId;
}

function normalizeImageUrl(url: string): string {
  // Images are hosted in /public/products_images/ on Vercel
  const appUrl = process.env.SHOPIFY_APP_URL || "https://auto-shopify-setup.vercel.app";

  // Rewrite old Shopify CDN URLs → our Vercel-hosted images
  const cdnMatch = url.match(/cdn\.shopify\.com\/.*\/files\/([^?]+)/);
  if (cdnMatch) {
    return `${appUrl}/products_images/${cdnMatch[1]}`;
  }

  return url
    .replace("auto-shopify-setup-launchifyapp.vercel.app", "auto-shopify-setup.vercel.app");
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

// Upload images to Shopify Files
async function uploadImagesToShopifyFiles(session: Session, imageUrls: string[]): Promise<void> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on GenericFile {
            id
            url
            alt
            createdAt
          }
          ... on MediaImage {
            id
            image {
              url
              altText
            }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const files = imageUrls.map(url => ({
    alt: "",
    originalSource: url,
    contentType: "IMAGE"
  }));
  const variables = { files };
  const response: any = await client.request(query, { variables });
  if (response?.data?.fileCreate?.userErrors?.length) {
    console.error("Files upload error:", response.data.fileCreate.userErrors);
  }
  ((response?.data?.fileCreate?.files || []) as any[]).forEach((file: any) => {
    if(file.image?.url){
      console.log("Shopify Image File:", file.id, file.image.url);
    } else if(file.url) {
      console.log("Shopify File:", file.id, file.url);
    }
  });
}

// Create automated collection by tag
async function createAutomatedCollection(session: Session, title: string, handle: string, tag: string): Promise<{id: string, title: string} | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation collectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection {
          id
          title
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    input: {
      title: title,
      handle: handle,
      ruleSet: {
        appliedDisjunctively: false,
        rules: [
          {
            column: "TAG",
            relation: "EQUALS",
            condition: tag
          }
        ]
      }
    }
  };
  const response: any = await client.request(query, { variables });
  if (response?.data?.collectionCreate?.userErrors?.length) {
    console.error(`Collection "${title}" creation error:`, response.data.collectionCreate.userErrors);
    return null;
  }
  const collection = response?.data?.collectionCreate?.collection;
  if (collection) {
    console.log(`Collection created: "${collection.title}" (ID: ${collection.id})`);
    return { id: collection.id, title: collection.title };
  }
  return null;
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
  const result = response?.data?.productCreateMedia;
  if (result?.mediaUserErrors?.length) {
    console.error(`[createProductMedia] errors for product ${productId}:`, JSON.stringify(result.mediaUserErrors));
  }
  return result?.media?.[0]?.id;
}

/** Get all media for a product (id, status, url) */
async function getAllProductMedia(session: Session, productId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query getProductMedia($id: ID!) {
      product(id: $id) {
        media(first: 50) {
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
  return (response?.data?.product?.media?.edges ?? []).map((e: any) => e.node).filter(Boolean);
}

/** Get all variant IDs for a product */
async function getAllProductVariants(session: Session, productId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query getProductVariants($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          edges {
            node {
              id
              title
              selectedOptions { name value }
            }
          }
        }
      }
    }
  `;
  const response: any = await client.request(query, { variables: { id: productId } });
  return (response?.data?.product?.variants?.edges ?? []).map((e: any) => e.node);
}

/** Extract filename from a URL (ignoring query params) */
function getFilenameFromUrl(url: string): string {
  try {
    return new URL(url).pathname.split("/").pop() || "";
  } catch {
    return url.split("/").pop()?.split("?")[0] || "";
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
    console.error("Media attachment to variant error:", response.data.productVariantAppendMedia.userErrors);
  }
  return response?.data?.productVariantAppendMedia?.productVariants;
}

// Set inventory quantity for a variant
async function disableInventoryTracking(session: Session, inventoryItemId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    mutation inventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
      inventoryItemUpdate(id: $id, input: $input) {
        inventoryItem { id tracked }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    id: inventoryItemId,
    input: {
      tracked: false,
    },
  };
  try {
    const response: any = await client.request(query, { variables });
    if (response?.data?.inventoryItemUpdate?.userErrors?.length) {
      console.error("[Inventory] userErrors:", JSON.stringify(response.data.inventoryItemUpdate.userErrors));
    } else {
      console.log(`[Inventory] Tracking disabled for ${inventoryItemId}`);
    }
  } catch (err: any) {
    console.error(`[Inventory] Failed to disable tracking for ${inventoryItemId}: ${err?.message}`);
  }
}

// Get the shop's primary location ID
async function getPrimaryLocationId(session: Session): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query {
      locations(first: 1) {
        edges {
          node { id name }
        }
      }
    }
  `;
  try {
    const response: any = await client.request(query);
    const loc = response?.data?.locations?.edges?.[0]?.node;
    if (loc) {
      console.log(`[Location] Primary: ${loc.name} (${loc.id})`);
      return loc.id;
    }
  } catch (err: any) {
    console.warn(`[Location] Cannot access locations (missing scope?): ${err?.message}`);
  }
  return null;
}

// Get variant inventory item IDs for a product
async function getVariantInventoryItems(session: Session, productId: string) {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query getProductVariants($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          edges {
            node {
              id
              inventoryItem { id }
              selectedOptions { name value }
            }
          }
        }
      }
    }
  `;
  const response: any = await client.request(query, { variables: { id: productId } });
  return (response?.data?.product?.variants?.edges ?? []).map((e: any) => e.node);
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
  // Filter out invalid fields for ProductVariantsBulkInput
  const cleanedVariant: any = {};
  const validFields = ['id', 'sku', 'price', 'compareAtPrice', 'barcode', 'optionValues', 'taxable', 'weight', 'weightUnit'];
  for (const field of validFields) {
    if (field in variant) {
      cleanedVariant[field] = variant[field];
    }
  }
  const variables = {
    productId,
    variants: [cleanedVariant],
  };
  const response: any = await client.request(query, { variables });
  const data = response?.data?.productVariantsBulkUpdate;
  if (data?.userErrors?.length) {
    console.error("Variant update error (bulkUpdate):", data.userErrors);
  } else {
    console.log("Variant updated (bulkUpdate):", data.productVariants?.[0]);
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
  // Filter out invalid fields for ProductVariantsBulkInput
  const cleanedVariants = variants.map(v => {
    const cleaned: any = {};
    const validFields = ['id', 'sku', 'price', 'compareAtPrice', 'barcode', 'optionValues', 'taxable', 'weight', 'weightUnit'];
    for (const field of validFields) {
      if (field in v) {
        cleaned[field] = v[field];
      }
    }
    return cleaned;
  });
  const variables = {
    productId,
    variants: cleanedVariants,
  };
  const response: any = await client.request(query, { variables });
  const result = response?.data?.productVariantsBulkCreate;
  if (result?.userErrors?.length) {
    console.error(`[bulkCreateVariants] userErrors for product ${productId}:`, JSON.stringify(result.userErrors));
  }
  return result;
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
  const result = response?.data?.productCreate;
  if (result?.userErrors?.length) {
    console.error(`[productCreate] userErrors for "${product.title}":`, JSON.stringify(result.userErrors));
  }
  return result;
}

// Get Online Store publication ID
async function getOnlineStorePublicationId(session: Session): Promise<string | null> {
  const client = new shopify.clients.Graphql({ session });
  const query = `
    query GetPublications {
      publications(first: 10) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `;
  try {
    const response: any = await client.request(query);
    const edges = response?.data?.publications?.edges ?? [];
    const onlineStorePub = edges.find((e: any) => e?.node?.name === "Online Store");
    if (onlineStorePub) {
      console.log(`"Online Store" publication found with ID: ${onlineStorePub.node.id}`);
      return onlineStorePub.node.id;
    } else {
      console.error('"Online Store" publication not found.');
      return null;
    }
  } catch (error) {
    console.error("Error fetching publications:", error);
    return null;
  }
}

// Publish a resource to a sales channel
async function publishResource(session: Session, resourceId: string, publicationId: string): Promise<void> {
  const client = new shopify.clients.Graphql({ session });
  const mutation = `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    id: resourceId,
    input: [{
      publicationId: publicationId,
    }],
  };
  try {
    const response: any = await client.request(mutation, { variables });
    if (response?.data?.publishablePublish?.userErrors?.length > 0) {
      console.error(`Error publishing resource ${resourceId}:`, response.data.publishablePublish.userErrors);
    } else {
      console.log(`Resource ${resourceId} published successfully on ${publicationId}.`);
    }
  } catch (error) {
    console.error(`Exception publishing resource ${resourceId}:`, error);
  }
}


// ─── Redis helpers for multi-phase state ───
import { Redis } from "@upstash/redis";

const SETUP_PREFIX = "setup:";
const SETUP_TTL = 3600; // 1 hour

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? new Redis({ url, token }) : null;
}

interface SetupState {
  lang: Language;
  shop: string;
  idsToPublish: string[];
  productHandles: string[];
  productsByHandle: Record<string, any[]>;
  deferredVariantImages: { productId: string; variantRows: any[]; main: any }[];
  productsCreated: number;
}

async function saveSetupState(setupId: string, state: SetupState) {
  const redis = getRedis();
  if (!redis) throw new Error("Redis not configured");
  await redis.set(SETUP_PREFIX + setupId, JSON.stringify(state), { ex: SETUP_TTL });
}

async function loadSetupState(setupId: string): Promise<SetupState | null> {
  const redis = getRedis();
  if (!redis) return null;
  const data = await redis.get(SETUP_PREFIX + setupId);
  if (!data) return null;
  return typeof data === "string" ? JSON.parse(data) : data as SetupState;
}

async function deleteSetupState(setupId: string) {
  const redis = getRedis();
  if (redis) await redis.del(SETUP_PREFIX + setupId);
}

// ─── PHASE 1: Init (collections, pages, menu, parse CSV) ───
export async function setupPhaseInit({ session, lang = "fr" }: { session: Session; lang?: Language }): Promise<{ setupId: string; totalBatches: number; totalProducts: number }> {
  const idsToPublish: string[] = [];
  const baseUrl = process.env.SHOPIFY_APP_URL || "https://auto-shopify-setup.vercel.app";

  // Upload generic images
  const imagesUrls = [
    `${baseUrl}/image1.jpg`,
    `${baseUrl}/image2.jpg`,
    `${baseUrl}/image3.jpg`,
    `${baseUrl}/image4.webp`
  ];
  await uploadImagesToShopifyFiles(session, imagesUrls);

  // Create collections
  const beautyCollection = await createAutomatedCollection(
    session, t(lang, "collectionBeauty"), t(lang, "collectionBeautyHandle"), t(lang, "collectionBeautyTag")
  );
  if (beautyCollection?.id) idsToPublish.push(beautyCollection.id);

  const homeCollection = await createAutomatedCollection(
    session, t(lang, "collectionHome"), t(lang, "collectionHomeHandle"), t(lang, "collectionHomeTag")
  );
  if (homeCollection?.id) idsToPublish.push(homeCollection.id);

  // Shipping page
  const shippingPageId = await createShippingPageWithSDK(session, lang)
    || await getPageIdByHandle(session, t(lang, "shippingPageHandle"));

  // Main collection & menu
  const mainCollectionId = await getAllProductsCollectionId(session);
  const mainMenuResult = await getMainMenuIdAndTitle(session);
  const contactPageId = await getPageIdByHandle(session, "contact");

  if (mainMenuResult) {
    await updateMainMenu(session, mainMenuResult.id, mainMenuResult.title, shippingPageId, mainCollectionId, contactPageId, lang);
  }

  // Parse CSV
  const csvUrl = lang === "en" ? `${baseUrl}/products-en.csv` : `${baseUrl}/products.csv`;
  const csvResponse = await fetch(csvUrl);
  if (!csvResponse.ok) throw new Error(`Failed to fetch product CSV: ${csvResponse.status}`);
  const csvText = await csvResponse.text();
  const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: ";" });

  const productsByHandle: Record<string, any[]> = {};
  for (const row of records) {
    if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
    productsByHandle[row.Handle].push(row);
  }

  const productLimit = await getProductLimit(session.shop);
  const allHandles = Object.keys(productsByHandle);
  const productHandles = allHandles.slice(0, productLimit);
  console.log(`[setupInit] Plan allows ${productLimit} products. CSV has ${allHandles.length}. Will import ${productHandles.length}.`);

  // Save state to Redis
  const setupId = `${session.shop}_${Date.now()}`;
  const BATCH_SIZE = 4;
  const totalBatches = Math.ceil(productHandles.length / BATCH_SIZE);

  await saveSetupState(setupId, {
    lang,
    shop: session.shop,
    idsToPublish,
    productHandles,
    productsByHandle,
    deferredVariantImages: [],
    productsCreated: 0,
  });

  return { setupId, totalBatches, totalProducts: productHandles.length };
}

// ─── PHASE 2: Create a batch of products ───
const BATCH_SIZE = 4;

export async function setupPhaseProducts({ session, setupId, batch }: { session: Session; setupId: string; batch: number }): Promise<{ ok: boolean; created: number; total: number }> {
  const state = await loadSetupState(setupId);
  if (!state) throw new Error("Setup state not found. Did you run phase init?");

  const startIdx = batch * BATCH_SIZE;
  const endIdx = Math.min(startIdx + BATCH_SIZE, state.productHandles.length);
  const batchHandles = state.productHandles.slice(startIdx, endIdx);

  console.log(`[setupProducts] Batch ${batch}: products ${startIdx}-${endIdx - 1} (${batchHandles.length} products)`);

  let batchCreated = 0;

  for (const handle of batchHandles) {
    const group = state.productsByHandle[handle];
    if (!group || !group.length) continue;

    const main = group[0];
    type ProductOption = { name: string, values: { name: string }[] };
    const productOptions: ProductOption[] = [];
    for (let i = 1; i <= 3; i++) {
      const optionName = main[`Option${i} Name`] ? main[`Option${i} Name`].trim() : "";
      if (optionName) {
        const optionValues = [
          ...new Set(
            group
              .map((row) => (row[`Option${i} Value`] ? row[`Option${i} Value`].trim() : ""))
              .filter((v) => !!v && v !== "Default Title")
          ),
        ].map((v) => ({ name: v }));
        if (optionValues.length) productOptions.push({ name: optionName, values: optionValues });
      }
    }
    const productOptionsOrUndefined = productOptions.length ? productOptions : undefined;
    const handleUnique = handle + "-" + Math.random().toString(16).slice(2, 7);
    const productMetafields = extractCheckboxMetafields(main);

    const product: any = {
      title: main.Title,
      descriptionHtml: main["Body (HTML)"] || "",
      handle: handleUnique,
      vendor: main.Vendor,
      productType: main.Type,
      tags: main.Tags?.split(",").map((t: string) => t.trim()),
      productOptions: productOptionsOrUndefined,
      metafields: productMetafields.length > 0 ? productMetafields : undefined,
    };

    try {
      const productCreateData = await createProductWithSDK(session, product);
      const productData = productCreateData?.product;
      const productId = productData?.id;
      if (!productId) {
        console.error("No productId generated.", JSON.stringify(productCreateData, null, 2));
        continue;
      }
      console.log("Product created:", productId);
      state.idsToPublish.push(productId);

      // Upload product images
      const allImages = [...new Set(group.map((row) => row["Image Src"]).filter(Boolean))];
      for (const imgUrl of allImages) {
        await createProductMedia(session, productId, normalizeImageUrl(imgUrl), "");
      }

      const variantEdges = productData?.variants?.edges;

      // Create variants
      if (productOptionsOrUndefined && productOptionsOrUndefined.length > 0) {
        const seen = new Set<string>();
        const variants = group
          .map((row) => {
            const optionValues: { name: string; optionName: string }[] = [];
            productOptions.forEach((opt, optIdx) => {
              const value = row[`Option${optIdx + 1} Value`]?.trim();
              if (value && value !== "Default Title") {
                optionValues.push({ name: value, optionName: opt.name });
              }
            });
            const key = optionValues.map((ov) => ov.name).join("|");
            if (seen.has(key)) return undefined;
            seen.add(key);
            if (!optionValues.length) return undefined;
            const variant: any = { price: row["Variant Price"] || main["Variant Price"] || "0", optionValues };
            if (row["Variant SKU"]) variant.sku = row["Variant SKU"];
            if (row["Variant Barcode"]) variant.barcode = row["Variant Barcode"];
            if (row["Variant Compare At Price"]) variant.compareAtPrice = row["Variant Compare At Price"];
            return variant;
          })
          .filter((v) => v && v.optionValues && v.optionValues.length);

        if (variants.length > 1) {
          await bulkCreateVariantsWithSDK(session, productId, variants.slice(1));
        }
      }

      // Update default variant
      if (variantEdges?.length) {
        await updateDefaultVariantWithSDK(session, productId, variantEdges[0].node.id, main);
      }

      // Disable inventory tracking
      const variantsWithInventory = await getVariantInventoryItems(session, productId);
      for (const v of variantsWithInventory) {
        if (v.inventoryItem?.id) await disableInventoryTracking(session, v.inventoryItem.id);
      }

      // Collect variant image info
      const variantRows = group.filter(row => {
        const vi = row["Variant Image"];
        return vi && vi.trim() && vi !== "nan" && vi !== "null" && vi !== "undefined";
      });
      if (variantRows.length > 0) {
        state.deferredVariantImages.push({ productId, variantRows, main });
      }

      batchCreated++;
      state.productsCreated++;
    } catch (err) {
      console.error("GraphQL product creation error", handleUnique, err);
    }
  }

  // Save updated state back to Redis
  await saveSetupState(setupId, state);

  console.log(`[setupProducts] Batch ${batch} done: ${batchCreated} created. Total: ${state.productsCreated}/${state.productHandles.length}`);
  return { ok: true, created: state.productsCreated, total: state.productHandles.length };
}

// ─── PHASE 3: Finalize (variant images + publish) ───
export async function setupPhaseFinalize({ session, setupId }: { session: Session; setupId: string }): Promise<{ ok: boolean; published: number }> {
  const state = await loadSetupState(setupId);
  if (!state) throw new Error("Setup state not found.");

  // Attach variant images
  if (state.deferredVariantImages.length > 0) {
    console.log(`[setupFinalize] Attaching variant images for ${state.deferredVariantImages.length} products...`);
    for (const { productId, variantRows, main } of state.deferredVariantImages) {
      try {
        const allMedia = await getAllProductMedia(session, productId);
        const readyMedia = allMedia.filter((m: any) => m.status === "READY");
        if (readyMedia.length === 0) continue;
        const allVariants = await getAllProductVariants(session, productId);

        for (const row of variantRows) {
          const variantImageFilename = getFilenameFromUrl(normalizeImageUrl(row["Variant Image"]));
          const filenameBase = variantImageFilename.replace(/\.[^.]+$/, "");
          const matchedMedia = readyMedia.find((m: any) =>
            m.image?.url && getFilenameFromUrl(m.image.url).includes(filenameBase)
          );
          if (!matchedMedia) continue;
          const matchedVariant = allVariants.find((v: any) =>
            v.selectedOptions?.every((opt: any) => {
              for (let i = 1; i <= 3; i++) {
                const csvOptName = main[`Option${i} Name`]?.trim();
                const csvOptValue = row[`Option${i} Value`]?.trim();
                if (csvOptName === opt.name && csvOptValue === opt.value) return true;
              }
              return false;
            })
          );
          if (matchedVariant) {
            await appendMediaToVariant(session, productId, matchedVariant.id, matchedMedia.id);
          }
        }
      } catch (err) {
        console.error(`[VariantImages] Error for product ${productId}:`, err);
      }
    }
  }

  // Publish all resources
  const onlineStorePublicationId = await getOnlineStorePublicationId(session);
  let published = 0;
  if (onlineStorePublicationId && state.idsToPublish.length > 0) {
    for (const resourceId of state.idsToPublish) {
      await publishResource(session, resourceId, onlineStorePublicationId);
      published++;
    }
    console.log(`[setupFinalize] Published ${published} resources.`);
  }

  // Clean up Redis state
  await deleteSetupState(setupId);

  return { ok: true, published };
}

// ─── Legacy wrapper (kept for compatibility) ───
export async function setupShop({ session, lang = "fr" }: { session: Session; lang?: Language }) {
  const { setupId, totalBatches } = await setupPhaseInit({ session, lang });
  for (let i = 0; i < totalBatches; i++) {
    await setupPhaseProducts({ session, setupId, batch: i });
  }
  await setupPhaseFinalize({ session, setupId });
}
