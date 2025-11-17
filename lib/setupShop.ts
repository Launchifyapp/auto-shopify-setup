            }
            await attachImageToProduct(shop, token, productId, cdnUrl ?? "", imageAltText);
            console.log(`Image rattachée au produit: ${handle} → ${productId}`);
          } catch (err) {
            console.error("Erreur upload/attach image produit", handle, err);
          }
        }

        // Création/gestion variants et attachement images des variantes
        const createdVariantsArr: VariantNode[] = productData?.variants?.edges?.map((edge: { node: VariantNode }) => edge.node) ?? [];
        for (const v of createdVariantsArr) {
          const variantKey = handle + ":" +
            (v.selectedOptions ?? []).map(opt => opt.value).join(":");
          const variantCsvRow = group.find(row =>
            [row["Option1 Value"], row["Option2 Value"], row["Option3 Value"]]
            .filter(Boolean)
            .join(":") === (v.selectedOptions ?? []).map(opt => opt.value).join(":")
          );
          if (
            variantCsvRow &&
            v.id &&
            variantCsvRow["Variant Image"] &&
            !variantCsvRow["Variant Image"].startsWith("https://cdn.shopify.com")
          ) {
            let variantImageUrl = variantCsvRow["Variant Image"];
            let variantAltText = variantCsvRow["Image Alt Text"] ?? "";
            try {
              let cdnUrl = await uploadImageToShopifyUniversal(shop, token, variantImageUrl, variantImageUrl.split('/').pop() ?? 'variant.jpg');
              if (!cdnUrl) {
                console.warn(`CDN url not available for variante [${variantKey}]`);
              }
              await attachImageToVariant(shop, token, v.id, cdnUrl ?? "", variantAltText);
              console.log(`Image rattachée à variante: ${variantKey} → ${v.id}`);
            } catch (err) {
              console.error("Erreur upload/attach image variante", variantKey, err);
            }
          }
        }
        await new Promise(res => setTimeout(res, 300));
      } catch (err) {
        console.log('Erreur création produit GraphQL', handleUnique, err);
      }
    }
  } catch (err) {
    console.log("Erreur globale setupShop:", err);
  }
}
