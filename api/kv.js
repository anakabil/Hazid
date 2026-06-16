import { Redis } from "@upstash/redis";

/* ===========================================================================
   Nusa Safety — Hazard Study App  ·  Endpoint database serverless  (/api/kv)
   ---------------------------------------------------------------------------
   Sinkronisasi multi-pengguna real-time (anti-bentrok). Data proyek disimpan
   GRANULAR (per-item), bukan satu blob:
     pidx              HASH  id -> updatedAt (indeks ringan utk deteksi ubahan)
     p:<id>:m          objek  "cangkang" proyek (tanpa scenarios & nodes)
     p:<id>:s          HASH  scnId  -> objek skenario
     p:<id>:n          HASH  nodeId -> objek node
     gv                int   penghitung versi global (INCR tiap ada perubahan)
     hazid_users       string blob (legacy, dipertahankan)

   Operasi via POST { op }: get/set/del/incr/hset/hdel/hgetall.
   Jalur legacy (GET ?key= , POST {key,value}) tetap didukung utk hazid_users
   & migrasi dari data lama (hazid_projects).
=========================================================================== */

const NS = "nusa-hazid:";
const APP_TOKEN = process.env.APP_API_TOKEN || "";

function keyAllowed(k) {
  if (k === "hazid_users" || k === "hazid_projects" || k === "pidx" || k === "gv") return true;
  return /^p:[A-Za-z0-9_-]{1,80}:[msn]$/.test(k);
}

function makeRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url: url, token: token });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-token");
  if (req.method === "OPTIONS") return res.status(204).end();

  const redis = makeRedis();
  if (!redis) {
    return res.status(500).json({ error: "Database belum dikonfigurasi. Set KV_REST_API_URL & KV_REST_API_TOKEN di Vercel." });
  }
  if (APP_TOKEN) {
    const t = req.headers["x-api-token"];
    if (t !== APP_TOKEN) return res.status(401).json({ error: "unauthorized" });
  }

  try {
    // ---- Legacy GET ?key= (string, untuk hazid_users & migrasi hazid_projects) ----
    if (req.method === "GET") {
      const key = String((req.query && req.query.key) || "");
      if (!keyAllowed(key)) return res.status(400).json({ error: "key tidak diizinkan" });
      const wrapped = await redis.get(NS + key);
      let value = null;
      if (wrapped != null) value = (typeof wrapped === "object" && "s" in wrapped) ? wrapped.s : wrapped;
      return res.status(200).json({ value: value == null ? null : value });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const op = body.op;

      // ---- Jalur baru: operasi granular ----
      if (op) {
        const key = String(body.key || "");
        if (op !== "mdel" && !keyAllowed(key)) return res.status(400).json({ error: "key tidak diizinkan" });

        if (op === "get") {
          return res.status(200).json({ value: await redis.get(NS + key) });
        }
        if (op === "set") {
          await redis.set(NS + key, body.value);
          return res.status(200).json({ ok: true });
        }
        if (op === "del") {
          await redis.del(NS + key);
          return res.status(200).json({ ok: true });
        }
        if (op === "mdel") {
          const keys = Array.isArray(body.keys) ? body.keys.filter(keyAllowed) : [];
          if (keys.length) await redis.del.apply(redis, keys.map(function (k) { return NS + k; }));
          return res.status(200).json({ ok: true });
        }
        if (op === "incr") {
          return res.status(200).json({ value: await redis.incr(NS + key) });
        }
        if (op === "hset") {
          const field = String(body.field || "");
          if (!field) return res.status(400).json({ error: "field kosong" });
          const obj = {}; obj[field] = body.value;
          await redis.hset(NS + key, obj);
          return res.status(200).json({ ok: true });
        }
        if (op === "hdel") {
          const field = String(body.field || "");
          if (field) await redis.hdel(NS + key, field);
          return res.status(200).json({ ok: true });
        }
        if (op === "hgetall") {
          const all = await redis.hgetall(NS + key);
          return res.status(200).json({ value: all || {} });
        }
        return res.status(400).json({ error: "op tidak dikenal" });
      }

      // ---- Legacy POST {key,value} (string set, untuk hazid_users) ----
      const key = String(body.key || "");
      if (!keyAllowed(key)) return res.status(400).json({ error: "key tidak diizinkan" });
      const value = String(body.value == null ? "" : body.value);
      await redis.set(NS + key, { s: value });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method tidak didukung" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
