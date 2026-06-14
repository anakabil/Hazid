/* ===========================================================================
   Nusa Safety — HAZID  ·  Endpoint rekomendasi AI  (/api/recommend)
   ---------------------------------------------------------------------------
   Melengkapi skenario HAZID secara otomatis berdasarkan guideword & deviation
   menggunakan Anthropic API (Claude). Mengembalikan JSON terstruktur yang
   langsung mengisi field pada lembar kerja.

   Variabel lingkungan (Vercel → Settings → Environment Variables):
     ANTHROPIC_API_KEY     wajib — kunci API Anthropic
     ANTHROPIC_MODEL       opsional — default "claude-sonnet-4-6"
     APP_API_TOKEN         opsional — gerbang; harus sama dengan VITE_API_TOKEN
=========================================================================== */

const APP_TOKEN = process.env.APP_API_TOKEN || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const RUBRIK = `
SKALA KEMUNGKINAN (L), 1-5:
1 Rare — < 1 kali per 1.000.000 tahun (belum pernah terjadi di industri)
2 Unlikely — ± 1 kali per 10.000–1.000.000 tahun (sangat jarang)
3 Possible — ± 1 kali per 100–10.000 tahun (pernah di industri sejenis)
4 Likely — ± 1 kali per 10–100 tahun (pernah di fasilitas ini)
5 Frequent — > 1 kali per 10 tahun (sering)

SKALA KONSEKUENSI (C), 1-5 (ambil yang TERPARAH lintas dimensi K3/Lingkungan/Aset):
1 Negligible — P3K; dampak lingkungan tak terdeteksi; aset < Rp150 juta
2 Minor — perawatan medis tanpa LTI; pencemaran minor di lokasi; Rp150 jt–1,5 M
3 Moderate — LTI/restricted duty; pencemaran signifikan di lokasi; Rp1,5–15 M
4 Severe — fatality/cacat permanen; pencemaran mayor sebagian keluar; Rp15–150 M
5 Catastrophic — multiple fatality; pencemaran masif lintas batas; > Rp150 M`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-api-token");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method tidak didukung" });

  if (APP_TOKEN) {
    const t = req.headers["x-api-token"];
    if (t !== APP_TOKEN) return res.status(401).json({ error: "unauthorized" });
  }
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY belum di-set di Vercel." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const studyType = String(body.studyType || "HAZID").toUpperCase() === "HAZOP" ? "HAZOP" : "HAZID";
    const isHazop = studyType === "HAZOP";
    const guideword = String(body.guideword || "").trim();
    const parameter = String(body.parameter || "").trim();
    const deviation = String(body.deviation || "").trim();
    const nodeName = String(body.node || "").trim();
    const facility = String(body.facility || "").trim();
    const existingHazard = String(body.hazard || "").trim();
    if (!guideword && !deviation && !parameter) {
      return res.status(400).json({ error: "Isi guideword/parameter dan/atau penyimpangan terlebih dahulu." });
    }

    const intro = isHazop
      ? `Anda adalah fasilitator senior HAZOP & process safety (mengacu CCPS & IEC 61882). Lengkapi SATU baris kajian HAZOP untuk sebuah node proses. Fokus pada penyimpangan PARAMETER PROSES (Guideword diterapkan pada parameter) serta dampak keselamatan & operability.`
      : `Anda adalah fasilitator senior HAZID & process safety (mengacu CCPS). Lengkapi SATU skenario bahaya untuk lembar kerja HAZID. Fokus pada identifikasi bahaya tingkat tinggi termasuk bahaya eksternal.`;

    const prompt =
`${intro}

KONTEKS:
- Jenis studi: ${studyType}
- Fasilitas/industri: ${facility || "(umum)"}
- Node/sistem yang dikaji: ${nodeName || "(tidak disebutkan)"}
${isHazop ? "- Parameter proses: " + (parameter || "(tidak disebutkan)") : ""}
- Guideword / kata panduan: ${guideword || "(tidak ada)"}
- Penyimpangan / deviation: ${deviation || (isHazop && guideword && parameter ? (guideword + " " + parameter) : "(tidak ada)")}
${existingHazard ? "- Catatan bahaya awal dari pengguna: " + existingHazard : ""}

TUGAS: Susun deskripsi bahaya, penyebab, konsekuensi (pertimbangkan dimensi K3, lingkungan, keamanan/security, dan teknis${isHazop ? "; sertakan dampak operability bila relevan" : ""}), pengaman eksisting yang lazim, serta rekomendasi tindakan. Lalu beri saran nilai Kemungkinan (L) dan Konsekuensi (C) awal sesuai rubrik.

${RUBRIK}

ATURAN OUTPUT:
- Jawab HANYA dengan satu objek JSON valid, tanpa teks lain, tanpa markdown/backtick.
- Bahasa Indonesia, ringkas, poin dipisah dengan "; " atau baris baru.
- Field WAJIB: hazard, causes, consequences, safeguards, recommendation, L, C, note.
- L dan C berupa angka bulat 1-5.

Format:
{"hazard":"...","causes":"...","consequences":"...","safeguards":"...","recommendation":"...","L":3,"C":4,"note":"asumsi singkat"}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: "Anthropic API " + r.status + ": " + errText.slice(0, 200) });
    }
    const data = await r.json();
    let text = "";
    if (Array.isArray(data.content)) {
      text = data.content.filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
    }
    // Ambil objek JSON pertama dari teks
    let parsed = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : text);
    } catch (e) {
      return res.status(502).json({ error: "Gagal membaca jawaban AI", raw: text.slice(0, 400) });
    }
    const clamp = function (n) { n = parseInt(n, 10); if (!n || n < 1) return ""; if (n > 5) return 5; return n; };
    return res.status(200).json({
      hazard: String(parsed.hazard || ""),
      causes: String(parsed.causes || ""),
      consequences: String(parsed.consequences || ""),
      safeguards: String(parsed.safeguards || ""),
      recommendation: String(parsed.recommendation || ""),
      L: clamp(parsed.L),
      C: clamp(parsed.C),
      note: String(parsed.note || ""),
    });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
