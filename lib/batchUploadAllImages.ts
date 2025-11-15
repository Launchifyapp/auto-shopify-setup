import fs from "fs";
import path from "path";
// fetch est global sur Node >=18 ou Next.js, donc ne pas importer node-fetch !

const IMAGES_DIR = "./public/products_images/";
const EXTRA_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image4.jpg",
  "./public/image4.webp"
];
// Change selon ton setup local ! Utilise en local http://localhost:3000/api/upload-file
const UPLOAD_API_ENDPOINT = "http://localhost:3000/api/upload-file";

// Utilitaire pour récupérer les images du dossier
function getAllImageFiles(): string[] {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => path.join(IMAGES_DIR, f));
}

function getMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

// Upload une image locale via /api/upload-file (staged upload Shopify)
async function uploadViaStagedApi(localPath: string): Promise<string> {
  const filename = path.basename(localPath);
  const mimeType = getMimeType(localPath);
  // Envoie le fichier avec chemin file:// (tu adapteras si tu utilises buffer/binary sur l'endpoint Next.js !)
  // Pour une API Next.js, il vaut mieux utiliser multipart ou passer en public si tu lances en remote
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
  // Liste images à uploader
  const allFiles = [...getAllImageFiles(), ...EXTRA_IMAGES];
  let countSuccess = 0, countFail = 0, failedFiles: string[] = [];
  for (const imgPath of allFiles) {
    if (!fs.existsSync(imgPath)) {
      console.warn(`[UPLOAD] File not found: ${imgPath}`);
      countFail++;
      failedFiles.push(imgPath + " (not found)");
      continue;
    }
    try {
      const cdnUrl = await uploadViaStagedApi(imgPath);
      console.log(`[UPLOAD SUCCESS] ${imgPath} → ${cdnUrl}`);
      countSuccess++;
    } catch (err) {
      console.error(`[UPLOAD ERROR] ${imgPath}`, err);
      countFail++;
      failedFiles.push(imgPath + " (error)");
    }
    await new Promise(r => setTimeout(r, 250)); // anti-throttle Shopify
  }
  console.log(`✔️ ${countSuccess} images uploadées. ❌ ${countFail} erreurs.`);
  if (failedFiles.length) console.log("Images en erreur:", failedFiles);
  console.log("Batch upload TERMINÉ!");
})();
