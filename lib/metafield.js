// lib/metafields.js
export async function upsertProductMetafieldDefinitions({ shop, accessToken, definitions }) {
  const endpoint = `https://${shop}/admin/api/2024-10/graphql.json`;

  const mutation = `
    mutation metafieldDefinitionUpsert($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionUpsert(definition: $definition) {
        createdDefinition { id name namespace key type }
        updatedDefinition { id name namespace key type }
        userErrors { field message }
      }
    }
  `;

  for (const def of definitions) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          definition: {
            name: def.name,
            namespace: def.namespace,
            key: def.key,
            type: def.type,
            ownerType: "PRODUCT",
            visibleToStorefront: true
          }
        }
      })
    });

    const json = await res.json();
    if (json.errors?.length) throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
    const errs = json.data?.metafieldDefinitionUpsert?.userErrors;
    if (errs?.length) {
      const msg = errs.map(e => e.message).join("; ");
      throw new Error(`Metafield upsert error for ${def.namespace}.${def.key}: ${msg}`);
    }
  }
}
