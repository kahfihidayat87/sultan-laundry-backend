# The Sultan Laundry — Backend API

Backend Node.js/Express + PostgreSQL untuk order, cart (Satuan + Kiloan), verifikasi & penimbangan di outlet, dan role Owner/Admin/Kurir/Pelanggan. Dirancang untuk disambungkan ke frontend web app (GitHub Pages) yang sudah dibuat sebelumnya.

## Fitur yang Sudah Diimplementasi

- Auth: register/login (email/WA + password), kerangka OTP via WhatsApp (tinggal isi token Fonnte)
- Master data dinamis: item Satuan, layanan Kiloan, parfum, multiplier durasi — semua bisa diubah Admin tanpa deploy ulang
- Order dari cart campuran Satuan + Kiloan
- **Alur 8 tahap status** dengan validasi role & urutan (tidak bisa lompat tahap)
- **Verifikasi & Penimbangan di outlet**: Admin input qty/berat riil → sistem hitung ulang harga final otomatis
- Deteksi selisih harga signifikan (default >20%, bisa diatur di `.env`) → order berhenti dulu menunggu konfirmasi pelanggan sebelum lanjut cuci
- Pembayaran dirancang **setelah verifikasi** (field `payment_status` baru relevan setelah `final_total_price` terisi)

## Setup Lokal (opsional, untuk development)

```bash
npm install
cp .env.example .env   # lalu isi DATABASE_URL, JWT_SECRET, dst.
npm run migrate         # membuat semua tabel + seed data master
npm run dev
```

## Deploy: Database di Neon.tech + Aplikasi di Vercel

Neon.tech hanya menyediakan database PostgreSQL — aplikasi Node.js-nya tetap perlu tempat jalan terpisah. Vercel adalah platform **serverless**: bukan server yang menyala terus, tapi function yang dijalankan per-request. Backend ini sudah disiapkan untuk pola ini (lihat `api/index.js` dan `vercel.json`).

### A. Buat Database di Neon.tech

1. Daftar/login di [neon.tech](https://neon.tech) (ada free tier).
2. **Create a project** → beri nama mis. `sultan-laundry`, pilih region terdekat (Singapore/`ap-southeast-1` paling dekat ke Indonesia).
3. Buka **Connection Details**. Neon biasanya kasih 2 connection string — **pilih yang "Pooled connection"** (bukan "Direct connection"), bentuknya ada `-pooler` di hostname:
   ```
   postgresql://USER:PASSWORD@ep-xxxx-xxxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
   **Kenapa harus yang pooled:** Vercel serverless bisa menjalankan banyak function secara paralel, masing-masing bisa buka koneksi database sendiri-sendiri. Connection langsung (direct) gampang kehabisan slot koneksi Postgres kalau trafik naik; pooled connection (lewat PgBouncer bawaan Neon) menangani ini secara otomatis.
4. **Jalankan schema.sql** — buka tab **SQL Editor** di Neon Console, copy-paste seluruh isi `schema.sql` dari folder ini, klik **Run**. Semua tabel + data awal langsung terbuat.
5. Simpan connection string (yang pooled) — ini nilai `DATABASE_URL` untuk langkah berikutnya.

### B. Deploy ke Vercel

1. Push folder `sultan-laundry-backend` ini ke repo GitHub (kalau belum).
2. Daftar/login di [vercel.com](https://vercel.com) pakai akun GitHub.
3. **Add New → Project** → pilih repo `sultan-laundry-backend`.
4. Di layar konfigurasi:
   - **Framework Preset**: pilih **Other** (bukan Next.js — proyek ini Express biasa)
   - **Root Directory**: biarkan default (root repo)
   - Build Command & Output Directory: **kosongkan saja** — Vercel otomatis mendeteksi `api/index.js` sebagai serverless function lewat `vercel.json`
5. Sebelum klik Deploy, buka **Environment Variables**, isi:
   - `DATABASE_URL` = connection string **pooled** dari Neon (langkah A.3)
   - `DB_SSL` = `true`
   - `JWT_SECRET` = random string panjang
   - `NODE_ENV` = `production`
   - `FRONTEND_ORIGIN` = URL GitHub Pages Anda (boleh 2, dipisah koma — app pelanggan & dashboard admin)
   - `PRICE_DEVIATION_THRESHOLD` = `20`
   - `FONNTE_TOKEN`, `FIREBASE_ENABLED` = isi sesuai kebutuhan

   Tidak ada isu karakter `$` di sini seperti waktu di cPanel — environment variable Vercel diinput langsung lewat form web, bukan lewat shell, jadi aman.
6. Klik **Deploy**. Setelah selesai (biasanya <1 menit), Vercel kasih URL, mis. `https://sultan-laundry-backend.vercel.app`.
7. Buka URL itu di browser — kalau muncul `{"status":"ok","service":"The Sultan Laundry API"}`, backend sudah jalan. Coba juga `https://sultan-laundry-backend.vercel.app/api/master-data` untuk pastikan koneksi ke database Neon juga jalan.
8. SSL otomatis aktif di semua domain `*.vercel.app` — tidak perlu setup manual.

### Batasan Penting Vercel (Wajib Tahu)

- **Ukuran request maksimal 4.5MB, tidak bisa diubah** (ini batasan infrastruktur Vercel, bukan setting yang bisa dinaikkan). Ini kenapa foto bukti pembayaran/QRIS **wajib dikompres dulu di frontend** sebelum dikirim — sudah saya terapkan lewat fungsi `compressImage()` di kedua frontend (app pelanggan & dashboard admin), jadi foto otomatis dikecilkan ke ~1280px & JPEG 70-85% sebelum diunggah.
- **Function timeout**: 10 detik di paket Hobby (gratis), 60 detik di Pro. Semua endpoint di backend ini query-nya ringan (harusnya di bawah 1 detik), jadi aman di paket gratis.
- **Cold start**: request pertama setelah idle lama bisa terasa lebih lambat (~1-2 detik) karena function baru "dibangunkan". Request berikutnya normal.
- Kalau nanti butuh cron job (misal reminder H-1 seperti sistem WA Imtiyaz Tour), Vercel punya fitur **Cron Jobs** bawaan (`vercel.json` bagian `crons`) — beri tahu saya kalau mau ditambahkan.

### Update Kode Setelah Deploy Pertama

Setiap kali push ke branch `main` di GitHub, Vercel otomatis re-deploy — tidak perlu langkah manual lagi.


### Alternatif Lain (Kalau Nanti Ingin Pindah dari Vercel)

Kalau nanti butuh koneksi tersambung terus-menerus (bukan serverless) — misalnya untuk WebSocket realtime yang lebih canggih, atau merasa batas 4.5MB/10 detik Vercel mengganggu — opsi hosting Node.js lain yang tetap bisa dipasangkan dengan database Neon tanpa migrasi data:
- **Qwords cPanel Node.js Selector** — sama seperti yang dipakai sepatumu.id, kalau ingin semua infra jadi satu penyedia
- **Render.com** — ada free tier, deploy langsung dari GitHub repo, server-nya menyala terus (bukan serverless)
- **Railway** — mirip Render, juga deploy dari GitHub repo

Ganti hosting cuma mengganti *tempat aplikasi jalan* — `DATABASE_URL` dari Neon tetap sama, tidak perlu migrasi data ulang. File `api/index.js` & `vercel.json` di folder ini spesifik untuk Vercel; kalau pindah ke hosting yang bukan serverless, tinggal pakai `src/server.js` sebagai entry point (`npm start`) seperti biasa dan file `api/`/`vercel.json` bisa diabaikan.

## Menyambungkan ke Frontend (GitHub Pages)

Kedua frontend (`sultan-laundry-webapp` dan `sultan-laundry-admin`) sudah lengkap memanggil API ini — Anda tinggal isi `CONFIG.API_BASE_URL` di masing-masing `app.js` dengan URL Vercel dari langkah B di atas (mis. `https://sultan-laundry-backend.vercel.app`). Tidak perlu tulis kode fetch manual lagi.

## Cara Buat Akun Owner/Admin/Kurir Pertama

Belum ada endpoint publik untuk ini (sengaja, demi keamanan — role staff tidak boleh self-register). Buat manual lewat query database setelah migrasi:

```sql
-- Contoh: promosikan user yang sudah register jadi admin
UPDATE users SET role = 'admin' WHERE phone = '0811xxxxxxx';

-- Atau insert langsung (password perlu di-hash dulu, sesuaikan lewat script Node bcrypt)
```

Saran: buat endpoint `POST /api/admin/create-staff` yang hanya bisa diakses role `owner`, untuk fase berikutnya.

## Pembayaran Manual (Transfer / QRIS)

Tidak pakai payment gateway — alurnya:
1. Setelah order diverifikasi di outlet (`final_total_price` terisi), frontend menampilkan info rekening/QRIS dari `GET /api/payment-settings`.
2. Pelanggan transfer manual, lalu foto bukti dan `POST /api/orders/:id/payment-proof`.
3. Muncul di dashboard Admin (`GET /api/payment-proofs/pending`) untuk direview.
4. Admin approve/reject via `POST /api/payment-proofs/:id/review` → `orders.payment_status` otomatis jadi `paid`, dan pelanggan dapat notifikasi.

**Setup gambar QRIS:** upload lewat dashboard Admin (menu Pengaturan Pembayaran) — gambar disimpan sebagai base64 di database, tidak perlu storage terpisah untuk skala kecil.

## Push Notification (Firebase Cloud Messaging)

Notifikasi otomatis terpicu saat: status order berubah, verifikasi selesai (termasuk saat butuh konfirmasi selisih harga), dan saat bukti pembayaran direview.

**Setup:**
1. Buat project di [Firebase Console](https://console.firebase.google.com) (gratis).
2. **Project Settings → Service Accounts → Generate new private key** → unduh file JSON.
3. Simpan file itu sebagai `serviceAccountKey.json` di root folder backend ini — **jangan commit ke repo publik** (tambahkan ke `.gitignore`).
4. Set `FIREBASE_ENABLED=true` dan `FIREBASE_SERVICE_ACCOUNT_JSON` di Environment Variables Vercel.
5. Di frontend, pakai Firebase JS SDK (Web Push) untuk minta izin notifikasi & dapatkan token, lalu kirim ke `POST /api/notifications/register-token`. Detail ada di README frontend.

Selama `FIREBASE_ENABLED` belum `true`, sistem tetap jalan normal — notifikasi hanya di-log ke console, tidak error.

## Struktur Endpoint

| Endpoint | Method | Role | Fungsi |
|---|---|---|---|
| `/api/auth/register` | POST | publik | Daftar pelanggan |
| `/api/auth/login` | POST | publik | Login |
| `/api/auth/otp/request` | POST | publik | Minta kode OTP |
| `/api/auth/otp/verify` | POST | publik | Verifikasi OTP → login/auto-register |
| `/api/master-data` | GET | publik | Ambil semua item/layanan/parfum/durasi |
| `/api/master-data/items/:id` | PATCH | admin/owner | Ubah harga item satuan |
| `/api/master-data/kiloan/:id` | PATCH | admin/owner | Ubah harga/kg |
| `/api/master-data/durations/:code` | PATCH | admin/owner | Ubah multiplier durasi |
| `/api/orders` | POST | pelanggan | Submit cart jadi order |
| `/api/orders` | GET | semua (terfilter) | List order |
| `/api/orders/:id` | GET | pemilik/staff | Detail order + histori |
| `/api/orders/:id/status` | PATCH | admin/owner/kurir | Transisi status biasa |
| `/api/orders/:id/verify` | POST | admin/owner | Verifikasi & penimbangan di outlet |
| `/api/orders/:id/confirm-deviation` | POST | pelanggan | Konfirmasi selisih harga besar |
| `/api/orders/:id/admin-confirm-deviation` | POST | admin/owner | Admin override konfirmasi selisih harga (mis. sudah dikonfirmasi via WA/telepon) |
| `/api/orders/:id/payment-proof` | POST | pelanggan | Upload bukti transfer/QRIS |
| `/api/orders/:id/payment-proof` | GET | pemilik/admin | Lihat bukti pembayaran order ini |
| `/api/payment-settings` | GET | publik | Info rekening/QRIS aktif |
| `/api/payment-settings/:id` | PATCH | admin/owner | Ubah rekening / upload QRIS |
| `/api/payment-proofs/pending` | GET | admin/owner | Daftar bukti bayar belum direview |
| `/api/payment-proofs/:id/review` | POST | admin/owner | Approve/reject bukti bayar |
| `/api/notifications/register-token` | POST | semua login | Daftarkan device token FCM |
| `/api/admin/summary` | GET | admin/owner | Ringkasan statistik dashboard |
| `/api/admin/customers` | GET | admin/owner | Daftar pelanggan (bisa filter `?search=`) |
| `/api/admin/customers/:id` | GET | admin/owner | Detail pelanggan + histori deposit/loyalty/order |
| `/api/admin/customers/:id/deposit` | POST | admin/owner | Topup/kurangi saldo deposit manual |
| `/api/admin/customers/:id/membership` | PATCH | admin/owner | Ubah tier membership manual |

## Yang Masih Perlu Ditambahkan (Fase Berikutnya)

- Endpoint khusus untuk app Kurir (daftar tugas hari ini, upload foto bukti)
- Integrasi payment gateway (iPaymu) setelah `final_total_price` terisi
- Push notification (FCM) tiap perubahan status
- Dashboard Admin (bisa web terpisah atau perluasan dari sistem GAS/Sheets yang sudah ada)
- Rate limiting & validasi input lebih ketat sebelum production
