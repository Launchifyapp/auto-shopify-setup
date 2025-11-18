import { FormData, File } from "formdata-node";
import { FormDataEncoder } from "form-data-encoder";
import { fetch } from "undici";
import fs from "fs";
import path from "path";

// ...
// La fonction universelle : upload via Buffer (recommandé pour images HTTP) ou chemin local
export async function stagedUploadShopifyFile(
  shop: string,
  token: string,
  file: Buffer | string,
  filename?: string,
  mimeType?: string
): Promise<string | null> {
  let fileBuffer: Buffer;
  let realFilename: string;
  let realMimeType: string;

  if (typeof file === "string") {
    // filePath local
    realFilename = path.basename(file);
    fileBuffer = fs.readFileSync(file);
    realMimeType =
      realFilename.endsWith('.png') ? "image/png"
      : realFilename.endsWith('.webp') ? "image/webp"
      : "image/jpeg";
  } else {
    // Buffer HTTP
    if (!filename) throw new Error("filename required for Buffer upload");
    if (!mimeType) throw new Error("mimeType required for Buffer upload");
    realFilename = filename;
    realMimeType = mimeType;
    fileBuffer = file;
  }

  console.log(`[Shopify] stagedUploadShopifyFile: ${realFilename} (${realMimeType}), buffer:${!!fileBuffer}`);
  // 1. Get staged upload target from Shopify
  const stagedTarget = await getStagedUploadUrl(shop, token, realFilename, realMimeType);

  // 2. Assemble form-data (parameters + file last)
  const formData = new FormData();
  for (const param of stagedTarget.parameters) formData.append(param.name, param.value);
  formData.append('file', new File([fileBuffer], realFilename, { type: realMimeType }));

  const encoder = new FormDataEncoder(formData);
  const res = await fetch(stagedTarget.url, {
    method: "POST",
    body: encoder.encode(),
    headers: encoder.headers, // NE PAS MODIFIER les headers !
    duplex: "half"
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`[Shopify] S3 upload failed for ${realFilename}: ${errText}`);
    throw new Error(`S3 upload failed: ${res.status} | ${errText}`);
  }

  // 3. Register/uploaded file in Shopify Files and poll CDN
  return await fileCreateFromStaged(shop, token, stagedTarget.resourceUrl, realFilename, realMimeType);
}
