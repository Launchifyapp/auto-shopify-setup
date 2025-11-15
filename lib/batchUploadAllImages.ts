import fs from "fs";
import path from "path";

const IMAGES_DIR = "./public/products_images/";
const EXTRA_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image4.jpg",
  "./public/image4.webp"
];
const PUBLIC_BASE = "https://supreme-umbrella-7vjq5w6ww4442wqpp-3000.app.github.dev"; // Ton URL Codespaces
const UPLOAD_API_ENDPOINT = `${PUBLIC_BASE}/api/upload-file`;

/**
 * Récupère toutes les images du dossier, ignore les non-images
 */
function getAllImageFiles(): string[] {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f) && fs.statSync(path.join(IMAGES_DIR, f)).size > 0 && !fs.lstatSync(path.join(IMAGES_DIR, f)).isDirectory())
    .map(f => f); // on veut juste le nom du fichier
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

async function uploadViaStagedApi(filename: string): Promise<string> {
  // Attention, url HTTP, pas chemin local !
  let url;
  if (fs.existsSync(path.join(IMAGES_DIR, filename))) {
    url = `${PUBLIC_BASE}/products_images/${filename}`;
  } else {
    url = `${PUBLIC_BASE}/${filename}`;
  }

  const mimeType = getMimeType(filename);
  const payload = { url, filename, mimeType };
  const res = await fetch(UPLOAD_API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (json.ok && json.uploads?.[0]?.result?.data?.fileCreate?.files?.[0]?.preview?.image?.url) {
    return json.uploads[0].result.data.fileCreate.files[0].preview.image.url;
  } else {
    throw new Error(`Staged upload error for ${filename}: ${JSON.stringify(json)}`);
  }
}

(async () => {
  // Liste des fichiers du dossier + extra images existantes
  const extraFilenames = EXTRA_IMAGES
    .map(f => path.basename(f))
    .filter(f => fs.existsSync(path.join("public", f)) || fs.existsSync(path.join(IMAGES_DIR, f)));

  const allFiles = [...getAllImageFiles(), ...extraFilenames];

  let countSuccess = 0, countFail = 0, failedFiles: string[] = [];
  for (const filename of allFiles) {
    try {
      const cdnUrl = await uploadViaStagedApi(filename);
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
