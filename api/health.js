export default async function handler(_req, res) {
  res.status(200).json({ ok: true, env: process.env.VERCEL_ENV || "local" });
}
