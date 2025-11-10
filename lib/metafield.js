// lib/metafields.js

export async function upsertProductMetafieldDefinitions({ shop, accessToken, definitions }) {
  const endpoint = `https://${shop}/admin/api/2024-10/graphql.json`;

  const mutation = `
    mutation metafieldDefinitionUpsert($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionUpsert(definition: $definition) {
        userErrors { message }
      }
    }
  `;

  for (const def of definitions) {
    await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: mutation,
        variables: { definition: { ...def, ownerType: "PRODUCT" } }
      })
    });
  }
}
