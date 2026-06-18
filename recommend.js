/* ===========================================================================
   Nusa Safety — Hazard Study App  ·  Endpoint analisis laporan  (/api/analyze)
   ---------------------------------------------------------------------------
   Menghasilkan ANALISIS KOMPREHENSIF atas keseluruhan studi HAZID/HAZOP
   menggunakan Anthropic API (Claude). Mengembalikan JSON terstruktur:
     - overview                 : narasi posisi risiko menyeluruh
     - controlConsiderations[]  : pertimbangan pengendalian (hierarki kontrol)
     - priorityRanking[]        : skala prioritas tindakan (tier, skor, alasan)
     - effectiveness            : kajian efisiensi & efektivitas rencana kontrol
     - strategicRecommendations : rekomendasi strategis untuk manajemen

   Variabel lingkungan (Vercel → Settings → Environment Variables):
     ANTHROPIC_API_KEY     wajib — kunci API Anthropic
     ANTHROPIC_MODEL       opsional — default "claude-sonnet-4-6"
     APP_API_TOKEN         opsional — gerbang; harus sama dengan VITE_API_TOKEN
=========================================================================== */

const APP_TOKEN = process.env.APP_API_TOKEN || "";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

function rpn(l, c) { l = parseInt(l, 10); c = parseInt(c, 10); if (!l || !c) return 0; return l * c; }
function level(r) { if (!r) return ""; if (r <= 2) return "Acceptable"; if (r <= 6) return "Low"; if (r <= 12) return "Medium"; if (r <= 20) return "High"; return "Critical"; }

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
    const info = body.info || {};
    const studyType = String(body.studyType || "HAZID").toUpperCase() === "HAZOP" ? "HAZOP" : "HAZID";
    const isHazop = studyType === "HAZOP";
    const scenarios = Array.isArray(body.scenarios) ? body.scenarios : [];
    if (!scenarios.length) return res.status(400).json({ error: "Belum ada skenario untuk dianalisis." });

    // Ringkasan padat tiap skenario (hemat token)
    const counts = { Acceptable: 0, Low: 0, Medium: 0, High: 0, Critical: 0 };
    const digest = scenarios.map(function (s, i) {
      const r1 = rpn(s.L1, s.C1), r2 = rpn(s.L2, s.C2);
      const lv1 = level(r1);
      if (lv1) counts[lv1] += 1;
      const parts = [];
      parts.push("#" + (i + 1));
      parts.push("Ref=" + (s.nodeCode || "-") + (s.guideword ? "/" + s.guideword : ""));
      if (isHazop && s.parameter) parts.push("Param=" + s.parameter);
      if (s.deviation) parts.push("Deviasi=" + s.deviation);
      if (s.hazard) parts.push("Bahaya=" + s.hazard);
      if (s.causes) parts.push("Penyebab=" + s.causes);
      if (s.consequences) parts.push("Konsekuensi=" + s.consequences);
      if (s.safeguards) parts.push("Pengaman=" + s.safeguards);
      if (s.recommendation) parts.push("RekomendasiSaatIni=" + s.recommendation);
      parts.push("RisikoAwal=" + (lv1 || "-") + "(L" + (s.L1 || "?") + "×C" + (s.C1 || "?") + "=" + (r1 || "?") + ")");
      parts.push("RisikoSisa=" + (level(r2) || "-") + "(RPN " + (r2 || "?") + ")");
      if (s.party) parts.push("PJ=" + s.party);
      if (s.status) parts.push("Status=" + s.status);
      return parts.join(" | ");
    }).join("\n");

    const ctx =
`KONTEKS STUDI:
- Jenis studi: ${studyType} (${isHazop ? "Hazard & Operability" : "Hazard Identification"})
- Judul: ${info.title || "(tanpa judul)"}
- Fasilitas: ${info.facility || "(umum)"}
- Klien: ${info.client || "-"}
- Jumlah skenario: ${scenarios.length}
- Distribusi risiko awal: Critical=${counts.Critical}, High=${counts.High}, Medium=${counts.Medium}, Low=${counts.Low}, Acceptable=${counts.Acceptable}

MATRIKS RISIKO (RPN = L × C; 5×5):
Acceptable 1–2 · Low 3–6 · Medium 7–12 · High 13–20 · Critical 21–25

DAFTAR SKENARIO (gunakan nomor #referensi & kode node persis seperti tertera):
${digest}`;

    const prompt =
`Anda adalah konsultan SENIOR manajemen risiko proses & process safety (mengacu CCPS, hierarki pengendalian, dan prinsip ALARP). Tugas Anda menelaah keseluruhan studi ${studyType} di bawah ini dan menyusun ANALISIS KOMPREHENSIF tingkat manajemen yang tajam, spesifik, dan dapat ditindaklanjuti — bukan kalimat umum.

${ctx}

Hasilkan analisis dengan ketentuan:

1) overview — 3–5 kalimat: posisi risiko keseluruhan, pendorong risiko utama, dan implikasi strategis bagi manajemen.

2) controlConsiderations — pertimbangan rekomendasi pengendalian untuk skenario PALING SIGNIFIKAN (utamakan Critical lalu High; jika tak ada, ambil RPN awal tertinggi). Maksimal 8 item. Tiap item:
   - ref: "#<nomor> <kodeNode>/<guideword>" sesuai daftar
   - hazard: ringkas bahayanya
   - hierarchy: objek berisi opsi pengendalian per tingkat HIRARKI KONTROL, spesifik & teknis untuk bahaya tsb (boleh "—" bila tidak relevan): { "eliminasi": "...", "substitusi": "...", "rekayasa": "...", "administratif": "...", "apd": "..." }
   - considerations: pertimbangan penerapan — kelayakan teknis, biaya/effort relatif (Rendah/Sedang/Tinggi), saling-ketergantungan antar kontrol, dampak operasional, dan catatan ALARP
   - expectedResidual: perkiraan tingkat risiko SISA bila rekomendasi diterapkan (Acceptable/Low/Medium/High/Critical)

3) priorityRanking — SKALA PRIORITAS untuk daftar tindakan. Beri peringkat skenario yang punya rekomendasi atau berisiko High/Critical. Maksimal 12 item, urut dari prioritas tertinggi. Pertimbangkan: tingkat risiko inheren, urgensi/paparan, kemudahan & efektivitas pengendalian. Tiap item:
   - rank: integer mulai 1
   - ref: "#<nomor> <kodeNode>/<guideword>"
   - tier: "P1" (segera) | "P2" (jangka menengah) | "P3" (terjadwal)
   - score: 0–100 (skor prioritas komposit)
   - rationale: 1–2 kalimat alasan prioritas
   - timeline: rentang waktu yang disarankan (mis. "Segera (0–1 bln)", "1–3 bln", "3–6 bln")

4) effectiveness — kajian EFISIENSI & EFEKTIVITAS rencana pengendalian secara keseluruhan:
   - narrative: 3–5 kalimat menilai seberapa efektif & efisien rencana kontrol yang ada
   - expectedRiskReduction: perkiraan dampak agregat (mis. "menurunkan mayoritas temuan High menjadi Medium/Low; sisa X butuh kontrol tambahan")
   - costBenefit: penilaian kualitatif manfaat vs biaya/effort (sebut quick win berbiaya rendah berdampak tinggi)
   - gaps: array string — celah/kelemahan rencana pengendalian saat ini (maks 6)
   - quickWins: array string — tindakan berdampak tinggi & berbiaya rendah yang bisa segera dijalankan (maks 6)
   - score: 0–100 (skor kematangan/efektivitas rencana pengendalian keseluruhan)

5) strategicRecommendations — array 4–7 string rekomendasi strategis tingkat manajemen.

ATURAN OUTPUT:
- Jawab HANYA dengan SATU objek JSON valid. Tanpa teks pembuka/penutup, tanpa markdown, tanpa backtick.
- Bahasa Indonesia, profesional, ringkas-padat. Hindari kalimat klise.
- Patuhi skema persis di bawah.

Skema:
{
 "overview":"...",
 "controlConsiderations":[{"ref":"...","hazard":"...","hierarchy":{"eliminasi":"...","substitusi":"...","rekayasa":"...","administratif":"...","apd":"..."},"considerations":"...","expectedResidual":"Medium"}],
 "priorityRanking":[{"rank":1,"ref":"...","tier":"P1","score":92,"rationale":"...","timeline":"Segera (0–1 bln)"}],
 "effectiveness":{"narrative":"...","expectedRiskReduction":"...","costBenefit":"...","gaps":["..."],"quickWins":["..."],"score":70},
 "strategicRecommendations":["...","..."]
}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
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
    let parsed = null;
    try {
      const m = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : text);
    } catch (e) {
      return res.status(502).json({ error: "Gagal membaca jawaban AI", raw: text.slice(0, 400) });
    }

    // Normalisasi & batasi defensif
    const S = function (v) { return v == null ? "" : String(v); };
    const arrS = function (a, max) { return Array.isArray(a) ? a.slice(0, max || 8).map(S).filter(Boolean) : []; };
    const clampScore = function (n) { n = parseInt(n, 10); if (isNaN(n)) return null; if (n < 0) return 0; if (n > 100) return 100; return n; };
    const validLevel = function (v) { v = S(v); return ["Acceptable", "Low", "Medium", "High", "Critical"].indexOf(v) >= 0 ? v : ""; };
    const validTier = function (v) { v = S(v).toUpperCase(); return ["P1", "P2", "P3"].indexOf(v) >= 0 ? v : "P2"; };

    const out = {
      overview: S(parsed.overview),
      controlConsiderations: (Array.isArray(parsed.controlConsiderations) ? parsed.controlConsiderations : []).slice(0, 8).map(function (c) {
        const h = c && c.hierarchy ? c.hierarchy : {};
        return {
          ref: S(c && c.ref), hazard: S(c && c.hazard),
          hierarchy: { eliminasi: S(h.eliminasi), substitusi: S(h.substitusi), rekayasa: S(h.rekayasa), administratif: S(h.administratif), apd: S(h.apd) },
          considerations: S(c && c.considerations),
          expectedResidual: validLevel(c && c.expectedResidual),
        };
      }),
      priorityRanking: (Array.isArray(parsed.priorityRanking) ? parsed.priorityRanking : []).slice(0, 12).map(function (p, i) {
        return {
          rank: parseInt(p && p.rank, 10) || (i + 1),
          ref: S(p && p.ref), tier: validTier(p && p.tier),
          score: clampScore(p && p.score), rationale: S(p && p.rationale), timeline: S(p && p.timeline),
        };
      }),
      effectiveness: {
        narrative: S(parsed.effectiveness && parsed.effectiveness.narrative),
        expectedRiskReduction: S(parsed.effectiveness && parsed.effectiveness.expectedRiskReduction),
        costBenefit: S(parsed.effectiveness && parsed.effectiveness.costBenefit),
        gaps: arrS(parsed.effectiveness && parsed.effectiveness.gaps, 6),
        quickWins: arrS(parsed.effectiveness && parsed.effectiveness.quickWins, 6),
        score: clampScore(parsed.effectiveness && parsed.effectiveness.score),
      },
      strategicRecommendations: arrS(parsed.strategicRecommendations, 7),
      model: MODEL,
    };

    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
