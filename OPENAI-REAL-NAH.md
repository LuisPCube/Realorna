# Realorna — OpenAI + Real / Nah

Pembaruan 19 Oktober 2026. Gunakan proyek lengkap ini untuk mengganti versi sebelumnya di Vercel.

## Yang berubah

- Hasil menjadi **Real**, **Nah (Hoax)**, atau **Belum cukup bukti**. Skor 0–100 dihapus dari tampilan, riwayat, salinan, dan pesan bagikan.
- Isi artikel/transkrip diperiksa per klaim: ✓ benar, ✕ salah, ~ perlu koreksi, ? belum terbukti. Ada alasan singkat, koreksi yang didukung bukti, konteks waktu, dan tautan pembanding per klaim.
- Nama CNN/Kompas/Tempo dan HTTPS tidak menentukan kebenaran isi. Peringatan keamanan alamat dilaporkan terpisah.
- Mesin aktif berganti ke **OpenAI Responses API** dengan pencarian web wajib. Tidak ada fallback otomatis ke Gemini, Grok, atau pengetahuan model tanpa pencarian.
- Jeda request lintas instance, retry terbatas, dan countdown 429 tetap berjalan. Retry memakai pesanan/kesempatan yang sama.
- Tombol contoh langsung membuka ilustrasi Real / Nah / koreksi kecil, tanpa login, pembayaran, kesempatan, atau panggilan API. Semua angka IHSG di contoh adalah simulasi.

## Pengaturan Vercel

Di **Project → Settings → Environment Variables**, isi nilai server berikut, lalu redeploy seluruh proyek:

| Nama | Nilai |
| --- | --- |
| `OPENAI_API_KEY` | API key OpenAI milikmu. |
| `OPENAI_MODEL` | Model yang tersedia untuk project-mu dan mendukung Responses, web search, serta Structured Outputs; misalnya `gpt-4.1-mini` bila tersedia. |
| `OPENAI_TRANSCRIBE_MODEL` | Opsional untuk MP4/audio yang dapat diunduh: model transkripsi yang tersedia, misalnya `gpt-transcribe`. |

Pilih environment Production, dan Preview bila dipakai. Jangan memakai awalan `VITE_` untuk key. Key tidak disertakan dalam ZIP atau HTML. Jika memakai banyak key yang diizinkan, `OPENAI_API_KEYS` tetap mendukung daftar berurutan. Mengganti key tidak menambah batas kuota project.

Pertahankan `DATABASE_URL`, pengaturan Better Auth, rekening transfer, dan kredensial admin yang sudah ada. Build Command tetap **`npm run build`**; migrasi yang dibutuhkan dijalankan otomatis. Konfigurasi Gemini lama tidak lagi dipakai. Akun, pembayaran manual, fitur admin, dan kesempatan cek tetap tersedia.

Aplikasi memerlukan API OpenAI aktif dengan akses ke model dan pencarian web. Penggunaan model, search, dan transkripsi dapat memakai biaya/kuota API. Kode tidak otomatis memilih model lain. Lihat `SETUP.md` untuk pilihan jeda dan penjelasan lengkap.

## Membaca hasil

**Nah (Hoax)** untuk contoh ilustratif "IHSG turun ke 3.500":
- ✓ IHSG turun.
- ✕ IHSG = 3.500.
- ✓ Koreksi: IHSG = 4.900 pada sesi simulasi tersebut.

Dalam pemeriksaan asli, angka koreksi harus berasal dari bukti untuk tanggal/sesi yang relevan. Angka 4.900 tidak dimasukkan sebagai jawaban tetap. Klaim sebab-akibat seperti "karena MSCI" diperiksa terpisah; kejadian bersamaan tidak otomatis membuktikan sebabnya.

**Real** berarti klaim utama didukung bukti. Kekeliruan detail ditandai ~ beserta koreksi. Jika klaim utama belum terbukti, hasilnya **Belum cukup bukti**; ketiadaan bukti tidak otomatis berarti hoaks.

## Batas yang perlu diketahui

Isi yang privat, diblokir, berada di balik login, atau tidak dapat ditranskrip tidak diberi vonis karangan. TikTok/Instagram masih memerlukan media yang dapat diakses langsung; belum ada downloader universal. Pemeriksaan video menilai ucapan yang terbaca, bukan autentisitas visual/deepfake. Bagian konten yang terpotong membuat hasil keseluruhan tetap belum terverifikasi.

Bukti ditautkan ke tiap klaim, tetapi penilaian hubungan bukti dengan klaim tetap dilakukan model; ini bukan jaminan akurasi mutlak. Pengujian memakai respons OpenAI simulasi dan database lokal terisolasi. API key milikmu dan deployment Vercel langsung belum diuji.

`realorna-real-nah.html` adalah preview mandiri untuk meninjau contoh tampilan; HTML itu tidak melakukan pengecekan tautan langsung. Aplikasi penuh untuk Vercel berada dalam ZIP.
