// Menjalankan schema.sql ke database yang terhubung via DATABASE_URL.
// Jalankan: npm run migrate
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("./db");

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "..", "schema.sql"), "utf8");
  try {
    await pool.query(sql);
    console.log("Migrasi berhasil — semua tabel & seed data sudah dibuat.");
  } catch (err) {
    console.error("Migrasi gagal:", err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
