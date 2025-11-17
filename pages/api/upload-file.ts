        }
      `,
      variables: {
        files: [
          {
            originalSource: target.resourceUrl,
            alt: filename,
          }
        ]
      }
    }),
  });
  const fileCreateJson = await fileCreateRes.json() as any;
  console.log("fileCreate:", JSON.stringify(fileCreateJson));
  let fileObj = fileCreateJson?.data?.fileCreate?.files?.[0];
  let imageUrl = fileObj?.preview?.image?.url ?? null;
  
  // --- Ajout ici : Polling si l'URL CDN n'est pas disponible mais que l'image est UPLOADED ---
  if (!imageUrl && fileObj?.fileStatus === "UPLOADED" && fileObj?.id) {
    console.log(`[Shopify] Polling for CDN url for MediaImage id: ${fileObj.id}`);
    imageUrl = await pollShopifyImageCDNUrl(SHOPIFY_STORE, SHOPIFY_ADMIN_TOKEN, fileObj.id);
    if (imageUrl) {
      console.log(`[Shopify] CDN url ready: ${imageUrl}`);
    } else {
      console.warn(`[Shopify] CDN url still not ready after polling for id: ${fileObj.id}`);
    }
  }
  return { ok: true, result: fileCreateJson, imageUrl };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    // Accept either 1 object or {images: array} in req.body
    const images = req.body.images || [req.body];
    if (!Array.isArray(images) || !images[0]?.url)
      return res.status(400).json({ ok: false, error: "missing images array" });
    const results = [];
    for (const img of images) {
      results.push(await uploadOne(img));
    }
    res.status(200).json({ ok: true, uploads: results });
  } catch (error: any) {
    console.error("API 500 error:", error);
    res.status(500).json({ ok: false, error: error.message || "Unknown error" });
  }
}
