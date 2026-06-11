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

## 🗄️ Database (Upstash Redis) — sudah terhubung

Aplikasi ini **menyimpan data bersama ke database sungguhan** melalui endpoint
serverless `api/kv.js` yang didukung **Upstash Redis**:

- **Daftar pengguna** (`hazid_users`) dan **seluruh proyek HAZID** (`hazid_projects`)
  disimpan terpusat di database → **tersinkron antar-perangkat & antar-pengguna**.
- **Status sesi login** disimpan lokal di tiap perangkat (tidak dikirim ke database),
  sehingga login di satu perangkat tidak memengaruhi perangkat lain.
- `localStorage` dipakai sebagai **cache offline**: bila koneksi ke database
  sementara terputus, aplikasi tetap berjalan dengan data terakhir dan menyinkron
  kembali pada penyimpanan berikutnya.

Lapisan penyimpanan tetap terisolasi pada objek `store` di `src/App.jsx`
(fungsi `get`/`set` async), jadi seluruh kode aplikasi lainnya **tidak berubah**.

### Langkah menghubungkan (cukup sekali, ~5 menit)

**1. Buat database Upstash Redis (gratis).**
   - *Termudah:* di dashboard Vercel → tab **Storage** (atau **Integrations →
     Marketplace → Upstash**) → **Create Database → Redis**. Vercel akan
     **otomatis mengisi** `KV_REST_API_URL` dan `KV_REST_API_TOKEN` ke project Anda.
   - *Manual:* daftar di [upstash.com](https://upstash.com) → buat database Redis →
     buka bagian **REST API** → salin `UPSTASH_REDIS_REST_URL` dan
     `UPSTASH_REDIS_REST_TOKEN`.

**2. Set Environment Variables di Vercel** (Project → **Settings → Environment
   Variables**) untuk environment *Production*, *Preview*, dan *Development*:

   | Nama | Nilai |
   |------|-------|
   | `KV_REST_API_URL` | dari Upstash/Vercel (otomatis bila pakai integrasi) |
   | `KV_REST_API_TOKEN` | dari Upstash/Vercel (otomatis bila pakai integrasi) |
   | `APP_API_TOKEN` | string acak rahasia (mis. hasil `openssl rand -hex 24`) |
   | `VITE_API_TOKEN` | **sama persis** dengan `APP_API_TOKEN` |

**3. Deploy ulang** (Vercel → Deployments → **Redeploy**, atau push commit baru).
   Saat pertama kali dibuka, akun demo otomatis dibuat **di database**.

> Uji lokal: salin `.env.example` → `.env`, isi nilainya, lalu `npm run dev`.
> Tanpa variabel database, endpoint `/api/kv` mengembalikan pesan bahwa database
> belum dikonfigurasi dan aplikasi otomatis memakai cache lokal.

### ⚠️ Catatan keamanan (penting)

Tahap ini menghubungkan **lapisan data** ke database. Autentikasi masih bersifat
sisi-klien dan **kata sandi tersimpan apa adanya** di database. Untuk deployment
publik sungguhan, disarankan **hardening lanjutan**:

- **Hash kata sandi** (mis. bcrypt) dan pindahkan verifikasi login ke server.
- **Sesi/token yang divalidasi server**, bukan sekadar nama pengguna.
- `VITE_API_TOKEN` ikut ter-bundle di sisi client sehingga **bukan rahasia mutlak** —
  ia hanya gerbang dasar. Pertimbangkan endpoint per-fungsi (`/api/login`,
  `/api/projects`, dst.) dengan otorisasi berbasis peran.

Tim Nusa Safety dapat meminta penambahan lapisan keamanan ini kapan saja.

---

## 📁 Struktur proyek

```
nusa-hazid/
├── index.html              # entry HTML
├── package.json
├── vite.config.js
├── vercel.json             # konfigurasi deploy + rewrite SPA (kecuali /api)
├── .env.example            # contoh variabel lingkungan (database & token)
├── tailwind.config.js
├── postcss.config.js
├── .gitignore
├── README.md
├── api/
│   └── kv.js               # endpoint serverless ke database (Upstash Redis)
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
