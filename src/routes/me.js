const express = require("express");
const { pool } = require("../config/db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// GET /api/me — profil pelanggan yang sedang login (saldo terbaru, dsb.)
router.get("/", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, phone, email, role, membership_tier, deposit_balance, loyalty_points, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "User tidak ditemukan." });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil profil." });
  }
});

// GET /api/me/deposit-history — histori transaksi deposit milik sendiri
router.get("/deposit-history", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, amount, type, reference_order_id, timestamp FROM deposit_transactions
       WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 30`,
      [req.user.id]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil histori deposit." });
  }
});

// GET /api/me/loyalty-history — histori transaksi loyalty point milik sendiri
router.get("/loyalty-history", authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, points, type, reference_order_id, timestamp FROM loyalty_transactions
       WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 30`,
      [req.user.id]
    );
    res.json({ history: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil histori loyalty point." });
  }
});

module.exports = router;
