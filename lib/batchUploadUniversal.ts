  const stagedTarget = await getStagedUploadUrl(shop, token, filename, mimeType);
  const fileBuffer = fs.readFileSync(filePath);
  const resourceUrl = await uploadToStagedUrl(stagedTarget, fileBuffer, mimeType, filename);
  const urlOrObj = await fileCreateFromStaged(shop, token, resourceUrl, filename, mimeType);

  // ---- POLLING ici si besoin ----
  if (typeof urlOrObj === 'string') {
    return urlOrObj; // L'URL CDN immédiat existe !
  } else if (pollCDN && urlOrObj.status === "UPLOADED" && urlOrObj.id) {
    // Poll jusqu'à obtenir le CDN
    console.log(`[Shopify] Polling CDN for MediaImage ${urlOrObj.id}`);
    const cdnUrl = await pollShopifyImageCDNUrl(shop, token, urlOrObj.id);
    if (cdnUrl) {
      console.log(`[Shopify] CDN URL ready: ${cdnUrl}`);
      return cdnUrl;
    } else {
      console.warn(`[Shopify] CDN URL not ready after polling for ${urlOrObj.id}.`);
      // On retourne l'objet et la resource url, le frontend peut re-poller si besoin.
      return urlOrObj;
    }
  } else {
    return urlOrObj;
  }
}

// Batch upload utility
export async function batchUploadLocalImages(dir: string) {
  const files = fs.readdirSync(dir).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
  for (const fname of files) {
    const filePath = path.resolve(dir, fname);
    try {
      const urlOrObj = await stagedUploadShopifyFile(SHOP, TOKEN, filePath, true);
      if (typeof urlOrObj === 'string') {
        console.log(`[UPLOAD] ${fname} → ${urlOrObj}`);
      } else {
        if (urlOrObj.previewReady === false) {
          console.log(`[UPLOAD] ${fname} UPLOADED (preview pending), MediaImage ID: ${urlOrObj.id}. Resource URL: ${urlOrObj.resourceUrl}`);
        } else {
          console.log(`[UPLOAD] ${fname} → (result)`, urlOrObj);
        }
      }
    } catch (err) {
      console.error(`[FAIL] ${fname}: ${err}`);
    }
  }
}
// Pour exécuter : batchUploadLocalImages('./products_images');
