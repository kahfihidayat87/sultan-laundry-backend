const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" }
  );
}

// POST /api/auth/register
// Pendaftaran pelanggan baru. Role admin/kurir/owner dibuat manual oleh owner (lihat README).
router.post("/register", async (req, res) => {
  const { name, phone, email, password } = req.body;
  if (!name || !password || (!phone && !email)) {
    return res.status(400).json({ error: "Nama, password, dan (nomor WA atau email) wajib diisi." });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, phone, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'pelanggan')
       RETURNING id, name, phone, email, role, membership_tier, loyalty_points`,
      [name, phone || null, email || null, hash]
    );
    const user = result.rows[0];
    res.status(201).json({ user, token: signToken(user) });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Nomor WA atau email sudah terdaftar." });
    }
    console.error(err);
    res.status(500).json({ error: "Gagal mendaftar." });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body; // identifier = email atau nomor WA
  if (!identifier || !password) {
    return res.status(400).json({ error: "Identifier dan password wajib diisi." });
  }
  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE (phone = $1 OR email = $1) AND is_active = TRUE`,
      [identifier]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: "Akun tidak ditemukan." });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Password salah." });

    delete user.password_hash;
    res.json({ user, token: signToken(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal login." });
  }
});

// ---- OTP (kerangka — sambungkan ke Fonnte di sini) ----
// POST /api/auth/otp/request  { phone }
router.post("/otp/request", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Nomor WA wajib diisi." });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await pool.query(
    `INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, $3)`,
    [phone, code, expiresAt]
  );

  // TODO: kirim `code` via Fonnte API pakai FONNTE_TOKEN dari .env, contoh:
  // await fetch("https://api.fonnte.com/send", {
  //   method: "POST",
  //   headers: { Authorization: process.env.FONNTE_TOKEN },
  //   body: new URLSearchParams({ target: phone, message: `Kode OTP The Sultan Laundry: ${code}` }),
  // });

  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV ONLY] OTP untuk ${phone}: ${code}`);
  }

  res.json({ message: "Kode OTP telah dikirim." });
});

// POST /api/auth/otp/verify  { phone, code }
router.post("/otp/verify", async (req, res) => {
  const { phone, code } = req.body;
  const result = await pool.query(
    `SELECT * FROM otp_codes WHERE phone = $1 AND code = $2 AND consumed = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, code]
  );
  if (result.rows.length === 0) {
    return res.status(400).json({ error: "Kode OTP salah atau kadaluarsa." });
  }
  await pool.query(`UPDATE otp_codes SET consumed = TRUE WHERE id = $1`, [result.rows[0].id]);

  let userResult = await pool.query(`SELECT * FROM users WHERE phone = $1`, [phone]);
  let user = userResult.rows[0];
  if (!user) {
    const hash = await bcrypt.hash(Math.random().toString(36), 10);
    const created = await pool.query(
      `INSERT INTO users (name, phone, password_hash, role) VALUES ($1, $2, $3, 'pelanggan') RETURNING *`,
      [`Pelanggan ${phone.slice(-4)}`, phone, hash]
    );
    user = created.rows[0];
  }
  delete user.password_hash;
  res.json({ user, token: signToken(user) });
});

module.exports = router;
