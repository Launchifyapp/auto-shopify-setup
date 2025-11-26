import { parse } from "csv-parse/sync";
import { shopify } from "@/lib/shopify";
import { Session } from "@shopify/shopify-api";
import { Language, t } from "@/lib/i18n";

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
    console.error("Media attachment to variant error:", response.data.productVariantAppendMedia.userErrors);
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


export async function setupShop({ session, lang = "fr" }: { session: Session; lang?: Language }) {
  try {
    const idsToPublish: string[] = [];

    // --- UPLOAD GENERIC IMAGES TO SHOPIFY FILES ---
    const imagesUrls = [
      "https://auto-shopify-setup.vercel.app/image1.jpg",
      "https://auto-shopify-setup.vercel.app/image2.jpg",
      "https://auto-shopify-setup.vercel.app/image3.jpg",
      "https://auto-shopify-setup.vercel.app/image4.webp"
    ];
    await uploadImagesToShopifyFiles(session, imagesUrls);

    // --- Create automated collections by TAG with language-specific names ---
    const beautyCollection = await createAutomatedCollection(
      session, 
      t(lang, "collectionBeauty"), 
      t(lang, "collectionBeautyHandle"), 
      t(lang, "collectionBeautyTag")
    );
    if (beautyCollection?.id) idsToPublish.push(beautyCollection.id);

    const homeCollection = await createAutomatedCollection(
      session, 
      t(lang, "collectionHome"), 
      t(lang, "collectionHomeHandle"), 
      t(lang, "collectionHomeTag")
    );
    if (homeCollection?.id) idsToPublish.push(homeCollection.id);

    // 1. Create Shipping page
    const shippingPageId = await createShippingPageWithSDK(session, lang)
      || await getPageIdByHandle(session, t(lang, "shippingPageHandle"));

    // 2. Get main collection ("all")
    const mainCollectionId = await getAllProductsCollectionId(session);

    // 3. Get main menu ID & title
    const mainMenuResult = await getMainMenuIdAndTitle(session);

    // 4. Find contact page ID
    const contactPageId = await getPageIdByHandle(session, "contact");

    // 5. Update main menu with language-specific labels
    if (mainMenuResult) {
      await updateMainMenu(
        session,
        mainMenuResult.id,
        mainMenuResult.title,
        shippingPageId,
        mainCollectionId,
        contactPageId,
        lang
      );
    } else {
      console.error("Main menu not found!");
    }

    // --- Products setup ---
    // Select CSV based on language
    // Note: For English, once products-en.csv is added to public/, it will be used
    const csvUrl = lang === "en"
      ? "https://auto-shopify-setup.vercel.app/products-en.csv"
      : "https://auto-shopify-setup.vercel.app/products.csv";
    
    // Both CSV files use semicolon delimiter
    const csvDelimiter = ";";
    
    const response = await fetch(csvUrl);
    const csvText = await response.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, delimiter: csvDelimiter });

    const productsByHandle: Record<string, any[]> = {};
    for (const row of records) {
      if (!productsByHandle[row.Handle]) productsByHandle[row.Handle] = [];
      productsByHandle[row.Handle].push(row);
    }

    for (const [handle, group] of Object.entries(productsByHandle)) {
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
          if (optionValues.length) {
            productOptions.push({ name: optionName, values: optionValues });
          }
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
          console.error(
            "No productId generated.",
            JSON.stringify(productCreateData, null, 2)
          );
          continue;
        }
        console.log("Product created with id:", productId);
        idsToPublish.push(productId);

        // Upload product images
        const allImagesToAttach = [
          ...new Set([
            ...group.map((row) => row["Image Src"]).filter(Boolean),
          ]),
        ];
        for (const imgUrl of allImagesToAttach) {
          const normalizedUrl = normalizeImageUrl(imgUrl);
          await createProductMedia(session, productId, normalizedUrl, "");
        }

        const variantEdges = productData?.variants?.edges;

        // Product with variants (options)
        if (productOptionsOrUndefined && productOptionsOrUndefined.length > 0) {
          const seen = new Set<string>();
          const variants = group
            .map((row, idx) => {
              const optionValues: { name: string; optionName: string }[] = [];
              productOptions.forEach((opt, optIdx) => {
                const value =
                  row[`Option${optIdx + 1} Value`] &&
                  row[`Option${optIdx + 1} Value`].trim();
                if (value && value !== "Default Title") {
                  optionValues.push({ name: value, optionName: opt.name });
                }
              });
              const key = optionValues.map((ov) => ov.name).join("|");
              if (seen.has(key)) return undefined;
              seen.add(key);
              if (!optionValues.length) return undefined;

              const variant: any = {
                price: row["Variant Price"] || main["Variant Price"] || "0",
                optionValues,
              };
              if (row["Variant SKU"]) variant.sku = row["Variant SKU"];
              if (row["Variant Barcode"]) variant.barcode = row["Variant Barcode"];
              if (row["Variant Compare At Price"]) variant.compareAtPrice = row["Variant Compare At Price"];
              return variant;
            })
            .filter((v) => v && v.optionValues && v.optionValues.length);

          if (variants.length > 1) {
            await bulkCreateVariantsWithSDK(
              session,
              productId,
              variants.slice(1)
            );
          }
        }

        // Update the default/first variant with price and compareAtPrice
        if (variantEdges && variantEdges.length) {
          const firstVariantId = variantEdges[0].node.id;
          await updateDefaultVariantWithSDK(session, productId, firstVariantId, main);
        }

        // Attach variant images
        if (variantEdges && variantEdges.length) {
          for (const edge of variantEdges) {
            const variantId = edge.node.id;
            const matchingRow = group.find(row =>
              edge.node.selectedOptions.every((opt: any) =>
                row[`Option${opt.index + 1} Value`] === opt.value
              )
            ) || group[0];
            const variantImageUrl = matchingRow["Variant Image"];
            if (variantImageUrl && variantImageUrl.trim() &&
                variantImageUrl !== "nan" && variantImageUrl !== "null" && variantImageUrl !== "undefined") {
              const normalizedUrl = normalizeImageUrl(variantImageUrl);
              const mediaId = await createProductMedia(session, productId, normalizedUrl, "");
              if (mediaId) {
                const ready = await waitForMediaReady(session, productId, mediaId, 20000);
                if (ready) {
                  await appendMediaToVariant(session, productId, variantId, mediaId);
                } else {
                  console.error("Media not READY after upload: not attaching", mediaId);
                }
              }
            }
          }
        }
        await new Promise((res) => setTimeout(res, 300));
      } catch (err) {
        console.error("GraphQL product creation error", handleUnique, err);
      }
    }
    
    // --- PUBLISH PRODUCTS AND COLLECTIONS TO "ONLINE STORE" ---
    console.log("Resource creation complete. Starting publication...");

    const onlineStorePublicationId = await getOnlineStorePublicationId(session);

    if (onlineStorePublicationId && idsToPublish.length > 0) {
      for (const resourceId of idsToPublish) {
        await publishResource(session, resourceId, onlineStorePublicationId);
        await new Promise((res) => setTimeout(res, 300));
      }
      console.log("All resources have been processed for publication.");
    } else if (!onlineStorePublicationId) {
      console.error("Unable to publish resources because 'Online Store' ID was not found.");
    } else {
      console.log("No resources to publish.");
    }

  } catch (err) {
    console.error("Global setupShop error:", err);
  }
}
