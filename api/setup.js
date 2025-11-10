// api/setup.js
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  importProductsFromCsv,
  uploadAllImages,
  upsertPage,
  upsertMainMenuFR,
  createCollections // si tu as déjà quelque chose, on peut le laisser
} from "../lib/shopify.js";

// --------- util cookies ----------
function getCookieFromHeader(header, name) {
  if (!header) return null;
  const cookies = header.split(";").map(c => c.trim());
  for (const c of cookies) {
    const [k, ...rest] = c.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// --------- GraphQL helpers ----------
function adminGraphQLEndpoint(shop) {
  return `https://${shop}/admin/api/2024-10/graphql.json`;
}

async function gql(shop, accessToken, query, variables) {
  const r = await fetch(adminGraphQLEndpoint(shop), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await r.json();
  if (!r.ok || json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

// Vérifie si une metafield definition existe déjà
async function findDefinition(shop, accessToken, { namespace, key }) {
  const q = `
    query ($owner: MetafieldOwnerType!, $namespace: String!, $key: String!) {
      metafieldDefinitions(first: 1, ownerType: $owner, namespace: $namespace, key: $key) {
        edges { node { id namespace key name type } }
      }
    }
  `;
  const data = await gql(shop, accessToken, q, {
    owner: "PRODUCT",
    namespace,
    key
  });
  const edge = data.metafieldDefinitions.edges[0];
  return edge?.node || null;
}

// Crée ou met à jour une metafield definition (PRODUCT)
async function upsertProductDefinition(shop, accessToken, def) {
  const current = await findDefinition(shop, accessToken, def);

  if (!current) {
    const mutationCreate = `
      mutation ($def: MetafieldDefinitionCreateInput!) {
        metafieldDefinitionCreate(definition: $def) {
          createdDefinition { id namespace key type name }
          userErrors { field message }
        }
      }
    `;
    const res = await gql(shop, accessToken, mutationCreate, {
      def: {
        name: def.name,
        namespace: def.namespace,
        key: def.key,
        type: def.type,              // ex: "single_line_text_field"
        description: def.description || null,
        ownerType: "PRODUCT",
        validations: def.validations || []
      }
    });
    const errs = res.metafieldDefinitionCreate.userErrors;
    if (errs?.length) throw new Error(`Create metafield definition failed: ${JSON.stringify(errs)}`);
    return res.metafieldDefinitionCreate.createdDefinition;
  } else {
    const mutationUpdate = `
      mutation ($id: ID!, $upd: MetafieldDefinitionUpdateInput!) {
        metafieldDefinitionUpdate(id: $id, definition: $upd) {
          updatedDefinition { id namespace key type name }
          userErrors { field message }
        }
      }
    `;
    const res = await gql(shop, accessToken, mutationUpdate, {
      id: current.id,
      upd: {
        name: def.name,
