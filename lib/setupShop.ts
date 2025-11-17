        const imageAltText = main["Image Alt Text"] ?? "";
        if (productImageUrl) {
          try {
            let cdnUrl = await uploadImageToShopifyGuaranteedCDN(shop, token, productImageUrl, productImageUrl.split('/').pop() ?? 'image.jpg');
            await attachImageToProductCDN(shop, token, productId, cdnUrl, imageAltText);
            console.log(`Image CDN rattachée au produit: ${handle} → ${productId}`);
          } catch (err) {
            console.error("Erreur upload/attach image CDN produit", handle, err);
          }
        }

        // Création/gestion variants et attachement images des variantes (usage garanti CDN)
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
            variantCsvRow["Variant Image"]
          ) {
            let variantImageUrl = variantCsvRow["Variant Image"];
            let variantAltText = variantCsvRow["Image Alt Text"] ?? "";
            try {
              let cdnUrl = await uploadImageToShopifyGuaranteedCDN(shop, token, variantImageUrl, variantImageUrl.split('/').pop() ?? 'variant.jpg');
              await attachImageToProductCDN(shop, token, v.id, cdnUrl, variantAltText);
              console.log(`Image CDN rattachée à variante: ${variantKey} → ${v.id}`);
            } catch (err) {
              console.error("Erreur upload/attach image CDN variante", variantKey, err);
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
