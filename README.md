# Nusa Safety — HAZID Assessment Tool

Aplikasi web untuk **Identifikasi Bahaya (HAZID)** dan penilaian risiko terstruktur,
berbasis **CCPS – Guidelines for Hazard Evaluation Procedures (3rd Edition)**.
Dikembangkan untuk **PT. Nusa Rendra Jayatama (Nusa Safety)**.

Aplikasi ini adalah Single Page Application (React + Vite) satu file komponen,
mengikuti konfigurasi yang sama dengan AIRA: lapisan penyimpanan ber-interface
async dengan *in-memory fallback*, hook konfirmasi, dan ekspor data.

---

## ✨ Fitur

- **Dua peran**: Administrator & Pengguna.
  - *Administrator*: kelola pengguna (tambah/edit/hapus) dan melihat seluruh proyek lintas pengguna.
  - *Pengguna*: membuat & mengelola proyek HAZID miliknya sendiri.
- **Editor HAZID 7 tab** mengikuti struktur Excel CCPS:
  1. Informasi Proyek (Cover) + Tim Studi
  2. Kriteria Risiko (matriks 5×5, likelihood, consequence, toleransi)
  3. Node HAZID (dengan kolom "Dipakai" yang menautkan ke lembar kerja)
  4. Lembar Kerja HAZID (RPN = L × C otomatis, badge risiko berwarna)
  5. Daftar Tindakan (otomatis dari rekomendasi)
  6. Ringkasan (grafik distribusi risiko awal vs sisa)
  7. **Laporan Akhir** (komprehensif, bisa diurutkan per tingkat risiko, siap cetak/PDF)
- **Kolom saling terhubung**: field Node, Guideword, dan Penanggung Jawab pada
  lembar kerja memakai pencarian (combobox) yang mereferensikan bagian lain —
  Node merujuk ke daftar Node, Penanggung Jawab merujuk ke Tim Studi. Node yang
  sudah dihapus otomatis ditandai sebagai tidak valid (⚠) agar mudah diperbaiki.
- **Ekspor Excel** (.xlsx) dengan 6 sheet identik dengan template asli.
- **Cetak / Simpan PDF** dari tab Laporan Akhir (via dialog cetak browser).
- **Contoh PLTB** siap muat (50 MW Jeneponto) untuk demonstrasi cepat.

---

## 🔑 Akun demo (otomatis dibuat saat pertama kali dibuka)

| Peran | Username | Kata sandi |
|-------|----------|------------|
| Administrator | `admin` | `admin123` |
| Pengguna | `pengguna` | `user123` |

> Ganti kata sandi default sebelum digunakan untuk data nyata
> (Panel Admin → Pengguna → Edit).

---

## 🚀 Menjalankan secara lokal

Prasyarat: **Node.js 18+**.

```bash
npm install      # pasang dependensi
npm run dev      # jalankan di http://localhost:5173
```

Untuk membuat build produksi:

```bash
npm run build    # hasil di folder dist/
npm run preview  # pratinjau hasil build
```

---

## ☁️ Deploy ke Vercel (sama seperti AIRA)

**Cara 1 — lewat GitHub (disarankan):**
1. Buat repository baru di GitHub, unggah seluruh isi folder ini.
2. Di [vercel.com](https://vercel.com) → **Add New… → Project** → pilih repo.
3. Vercel mendeteksi Vite otomatis. Biarkan setelan default:
   - Build Command: `npm run build`
   - Output Directory: `dist`
4. Klik **Deploy**. Selesai.

**Cara 2 — lewat Vercel CLI:**
```bash
npm i -g vercel
vercel            # ikuti prompt; deploy preview
vercel --prod     # deploy produksi
```

File `vercel.json` sudah menyertakan *rewrite* SPA agar refresh halaman tetap berfungsi.

> **Custom domain** (mis. `hazid.nusasafety.co.id`): di dashboard Vercel →
> Project → **Settings → Domains** → tambahkan domain dan ikuti petunjuk DNS.

---

## 🗄️ Tentang penyimpanan data

Versi ini menyimpan data di **`localStorage` browser**. Artinya:
- Data tersimpan **per-perangkat & per-browser** (tidak otomatis tersinkron antar
  perangkat atau antar pengguna pada perangkat berbeda).
- Cocok untuk penggunaan satu tim pada satu perangkat, demo, atau pilot.

Lapisan penyimpanan diisolasi pada objek `store` di `src/App.jsx`
(fungsi `get`/`set` async). Seluruh aplikasi memakai `loadJSON`/`saveJSON`,
jadi mengganti backend **tidak menyentuh** kode lainnya.

### Upgrade ke backend KV (multi-perangkat, seperti AIRA)

Agar data tersinkron antar perangkat/pengguna, ganti isi `store.get`/`store.set`
dengan panggilan ke backend KV/REST. Pola yang sama seperti AIRA (Upstash Redis):

```js
// contoh: src/App.jsx — ganti isi objek `store`
const BASE = import.meta.env.VITE_API_BASE; // mis. /api atau URL backend
const store = {
  async get(key) {
    try {
      const r = await fetch(`${BASE}/kv/${encodeURIComponent(key)}`);
      if (r.ok) { const j = await r.json(); return j.value ?? null; }
    } catch (e) {}
    return Object.prototype.hasOwnProperty.call(_mem, key) ? _mem[key] : null;
  },
  async set(key, value) {
    _mem[key] = value;
    try {
      await fetch(`${BASE}/kv/${encodeURIComponent(key)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
    } catch (e) {}
    return true;
  },
};
```

Sediakan endpoint `GET/PUT /api/kv/:key` di backend (mis. Vercel Serverless +
Upstash Redis). Untuk produksi sungguhan, tambahkan juga **autentikasi server-side**
(hashing kata sandi, sesi/token) — saat ini autentikasi bersifat sisi-klien untuk
prototipe, sebagaimana AIRA pada tahap awal.

---

## 📁 Struktur proyek

```
nusa-hazid/
├── index.html              # entry HTML
├── package.json
├── vite.config.js
├── vercel.json             # konfigurasi deploy + SPA rewrite
├── tailwind.config.js
├── postcss.config.js
├── .gitignore
├── README.md
└── src/
    ├── main.jsx            # bootstrap React
    ├── index.css          # Tailwind + aturan cetak
    └── App.jsx            # seluruh aplikasi HAZID (komponen tunggal)
```

---

## 🛠️ Teknologi

React 18 · Vite 5 · Tailwind CSS 3 · Recharts · SheetJS (xlsx) · lucide-react

---

© PT. Nusa Rendra Jayatama (Nusa Safety). Untuk penggunaan internal & klien.
Penilaian berbasis CCPS; aplikasi ini alat bantu, bukan pengganti kewajiban
kepatuhan regulasi yang berlaku (UU No. 1/1970, PP No. 50/2012, dan peraturan terkait).
