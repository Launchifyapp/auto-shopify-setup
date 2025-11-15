import fs from "fs";
import path from "path";

// CONFIG
const IMAGES_DIR = "./public/products_images/";
const EXTRA_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image4.jpg",
  "./public/image4.webp"
];
const UPLOAD_API_ENDPOINT = "http://localhost:3000/api/upload-file"; // Adapte si ton serveur Next.js est ailleurs

/**
 * Récupère toutes les images du dossier, uniquement jpg/jpeg/png/webp, ignore les fichiers non-images
 */
function getAllImageFiles(): string[] {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && fs.statSync(path.join(IMAGES_DIR, f)).size > 0 && !fs.lstatSync(path.join(IMAGES_DIR, f)).isDirectory())
    .map(f => path.join(IMAGES_DIR, f));
}

/**
 * Détecte le mimeType à partir du nom de fichier
 */
function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

/**
 * Upload une image locale vers /api/upload-file (staged upload Shopify)
 */
async function uploadViaStagedApi(localPath: string): Promise<string> {
  const filename = path.basename(localPath);
  const mimeType = getMimeType(localPath);

  // Servez vos fichiers via Next.js : http://localhost:3000/products_images/... ou http://localhost:3000/imageX.jpg
  // Attention, ce script suppose que Next.js expose bien les fichiers statiques dans /public/
  let url;
  // Si dans IMAGES_DIR alors chemin relatif /products_images/
  if (localPath.startsWith(IMAGES_DIR)) {
    url = `http://localhost:3000/products_images/${filename}`;
  } else {
    url = `http://localhost:3000/${filename}`;
  }

  const payload = { url, filename, mimeType };

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
  // Regroupe toutes les images à uploader : celles du dossier + les extra
  const allFiles = [...getAllImageFiles(), ...EXTRA_IMAGES].filter(f => fs.existsSync(f) && fs.statSync(f).size > 0);

  let countSuccess = 0, countFail = 0, failedFiles: string[] = [];
  for (const imgPath of allFiles) {
    const filename = path.basename(imgPath);
    try {
      const cdnUrl = await uploadViaStagedApi(imgPath);
      console.log(`[UPLOAD SUCCESS] ${filename} → ${cdnUrl}`);
      countSuccess++;
    } catch (err) {
      console.error(`[UPLOAD ERROR] ${filename}`, err);
      countFail++;
      failedFiles.push(filename + " (error)");
    }
    await new Promise(r => setTimeout(r, 250)); // anti-throttle Shopify
  }
  console.log(`✔️ ${countSuccess} images uploadées. ❌ ${countFail} erreurs.`);
  if (failedFiles.length) console.log("Images en erreur:", failedFiles);
  console.log("Batch upload TERMINÉ!");
})();
