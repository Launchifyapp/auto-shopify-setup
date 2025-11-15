import fs from "fs";
import path from "path";
const IMAGES_DIR = "./public/products_images/";
const EXTRA_IMAGES = [
  "./public/image1.jpg",
  "./public/image2.jpg",
  "./public/image4.jpg",
  "./public/image4.webp"
];
const UPLOAD_API_ENDPOINT = "http://localhost:3000/api/upload-file"; // endpoint Next.js qui télécharge de http://localhost:3000/public/...

function getAllFiles(): string[] {
  return fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
    .map(f => f); // f = filename only
}

function mimeType(filename: string): string {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

(async () => {
  const allFiles = [...getAllFiles(), ...EXTRA_IMAGES.map(f => path.basename(f))];
  for (const fname of allFiles) {
    // Images dans public → accessibles via URL HTTP sur Next.js local…
    const url = `http://localhost:3000/products_images/${fname}`;
    // Pour les extras : adapte la racine si nécessaire
    let imgUrl = url;
    if (!fs.existsSync(path.join(IMAGES_DIR, fname)))
      imgUrl = `http://localhost:3000/${fname}`;
    const payload = { url: imgUrl, filename: fname, mimeType: mimeType(fname) };
    try {
      const res = await fetch(UPLOAD_API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (result.ok && result.uploads?.[0]) {
        console.log(`UPLOAD OK: ${fname} → ${result.uploads[0].result.data.fileCreate.files[0].preview.image.url}`);
      } else {
        console.error("UPLOAD FAIL:", fname, result);
      }
    } catch (err) {
      console.error("UPLOAD ERR", fname, err);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log("Upload batch terminé !");
})();
