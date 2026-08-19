const { Pool } = require("pg");

// Neon.tech (dan kebanyakan Postgres hosted lain) WAJIB koneksi via SSL,
// termasuk saat development lokal yang connect ke Neon. Deteksi otomatis
// dari connection string, atau paksa manual lewat DB_SSL=true di .env.
const isHostedPg =
  (process.env.DATABASE_URL || "").includes("neon.tech") ||
  process.env.DB_SSL === "true" ||
  process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isHostedPg ? { rejectUnauthorized: false } : false,
  // Di Vercel, tiap invocation serverless bisa jadi proses terpisah —
  // pool besar malah bikin koneksi ke database membludak. process.env.VERCEL
  // otomatis diisi "1" oleh Vercel saat runtime.
  max: process.env.VERCEL ? 1 : 10,
});

module.exports = { pool };
