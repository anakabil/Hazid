import { Redis } from "@upstash/redis";

/* ===========================================================================
   Nusa Safety — HAZID  ·  Endpoint database serverless  (/api/kv)
   ---------------------------------------------------------------------------
   Menyimpan DATA BERSAMA aplikasi (daftar pengguna & proyek) ke database
   sungguhan: Upstash Redis. Status sesi login TIDAK pernah dikirim ke sini —
   sesi tetap lokal di tiap perangkat.

   Variabel lingkungan (set di Vercel → Settings → Environment Variables):
     KV_REST_API_URL      atau  UPSTASH_REDIS_REST_URL
     KV_REST_API_TOKEN    atau  UPSTASH_REDIS_REST_TOKEN
     APP_API_TOKEN        token gerbang sederhana; HARUS sama dengan
                          VITE_API_TOKEN pada sisi aplikasi (client)

   Kontrak data: nilai disimpan/diambil sebagai STRING apa adanya (aplikasi
   melakukan JSON.stringify/parse sendiri). Untuk menghindari Upstash mem-parse
   string JSON menjadi objek, nilai dibungkus sebagai { s: "<string>" }.
=========================================================================== */

const NS = "nusa-hazid:";
const ALLOWED = new Set(["hazid_users", "hazid_projects"]);
const APP_TOKEN = process.env.APP_API_TOKEN || "";

function makeRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url: url, token: token });
}

export default async function handler(req, res) {
  // CORS (umumnya same-origin di Vercel; diizinkan agar aman bila diakses lain origin)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-token");
  if (req.method === "OPTIONS") return res.status(204).end();

  const redis = makeRedis();
  if (!redis) {
    return res.status(500).json({
      error: "Database belum dikonfigurasi. Set KV_REST_API_URL & KV_REST_API_TOKEN di Vercel.",
    });
  }

  // Gerbang token sederhana (opsional namun disarankan)
  if (APP_TOKEN) {
    const t = req.headers["x-api-token"];
    if (t !== APP_TOKEN) return res.status(401).json({ error: "unauthorized" });
  }

  try {
    if (req.method === "GET") {
      const key = String((req.query && req.query.key) || "");
      if (!ALLOWED.has(key)) return res.status(400).json({ error: "key tidak diizinkan" });
      const wrapped = await redis.get(NS + key);
      let value = null;
      if (wrapped != null) {
        value = (typeof wrapped === "object" && "s" in wrapped) ? wrapped.s : wrapped;
      }
      return res.status(200).json({ value: value == null ? null : value });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const key = String(body.key || "");
      if (!ALLOWED.has(key)) return res.status(400).json({ error: "key tidak diizinkan" });
      const value = String(body.value == null ? "" : body.value);
      await redis.set(NS + key, { s: value });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method tidak didukung" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
