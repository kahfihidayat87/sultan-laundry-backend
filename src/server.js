// Entry point ini HANYA dipakai untuk development lokal (npm run dev / npm start).
// Di Vercel, yang dipakai adalah /api/index.js (serverless function), file ini
// tidak dijalankan sama sekali di production Vercel.

const app = require("./app");

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`The Sultan Laundry API (local dev) jalan di http://localhost:${PORT}`);
});
