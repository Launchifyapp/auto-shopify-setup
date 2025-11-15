import fs from "fs";
import path from "path";
import { fileTypeFromBuffer } from "file-type";

// CONFIGS
const IMAGES_DIR = "./public/products_images/";
const EXTRA_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image4.jpg",
  "./public/image4.webp"
];
const UPLOAD_API_ENDPOINT = "http://localhost:3000/api/upload-file"; // Next.js endpoint, adapte si remote

// List all files in products_images
function getAllImageFiles(): string[] {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => path.join(IMAGES_DIR, f));
}

function getMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

// Upload a single image via staged endpoint
async function uploadViaStagedApi(localPath: string) {
  const filename = path.basename(localPath);
  const mimeType = getMimeType(localPath);
  const payload = { url: `file://${localPath}`, filename, mimeType };
  const res = await fetch(UPLOAD_API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok && json.uploads?.[0]?.result?.data?.fileCreate?.files?.[0]?.preview?.image?.url) {
    return json.uploads[0].result.data.fileCreate.files[0].preview.image.url;
  } else {
    throw new Error(`Staged upload error for ${filename}: ${JSON.stringify(json)}`);
  }
}

(async () => {
  // Images du dossier + images spéciales
  const allFiles = [...getAllImageFiles(), ...EXTRA_IMAGES];
  for (const imgPath of allFiles) {
    if (!fs.existsSync(imgPath)) {
      console.warn(`[UPLOAD] File not found ${imgPath}`);
      continue;
    }
    try {
      const cdnUrl = await uploadViaStagedApi(imgPath);
      console.log(`[UPLOAD SUCCESS] ${imgPath} → ${cdnUrl}`);
      // Optionnel : ici tu peux ajouter la logique pour rattacher cdnUrl à un produit/variant
    } catch (err) {
      console.error(`[UPLOAD ERROR] ${imgPath}`, err);
    }
    await new Promise(r => setTimeout(r, 250)); // anti-throttle
  }
  console.log("Batch upload TERMINÉ!");
})();
