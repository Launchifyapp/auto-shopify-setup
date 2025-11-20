// ... autres imports et fonctions ...

// Utilitaire pour extraire tes 3 metafields checkbox du CSV
function extractProductMetafields(row: any): any[] {
  const metafields: any[] = [];
  if (row["Checkbox 1"] != null && row["Checkbox 1"].trim() !== "") {
    metafields.push({
      namespace: "custom",
      key: "checkbox_1",
      type: "boolean",
      value: ["1", "true", "TRUE", "oui", "yes", "vrai"].includes(row["Checkbox 1"].toLowerCase().trim())
        ? "true"
        : "false"
    });
  }
  if (row["Checkbox 2"] != null && row["Checkbox 2"].trim() !== "") {
    metafields.push({
      namespace: "custom",
      key: "checkbox_2",
      type: "boolean",
      value: ["1", "true", "TRUE", "oui", "yes", "vrai"].includes(row["Checkbox 2"].toLowerCase().trim())
        ? "true"
        : "false"
    });
  }
  if (row["Checkbox 3"] != null && row["Checkbox 3"].trim() !== "") {
    metafields.push({
      namespace: "custom",
      key: "checkbox_3",
      type: "boolean",
      value: ["1", "true", "TRUE", "oui", "yes", "vrai"].includes(row["Checkbox 3"].toLowerCase().trim())
        ? "true"
        : "false"
    });
  }
  return metafields;
}

// ...dans ta boucle principale, juste après la création du produit:
const productMetafields = extractProductMetafields(main);
if (productMetafields.length > 0) {
  await updateProductMetafields(shop, token, productId, productMetafields);
}
