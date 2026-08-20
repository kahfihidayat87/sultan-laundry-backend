const express = require("express");
const { pool } = require("../config/db");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

// POST /api/notifications/register-token — simpan FCM token device setelah login
// body: { token, platform? }
router.post("/register-token", authenticate, async (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ error: "Token wajib diisi." });
  try {
    await pool.query(
      `INSERT INTO device_tokens (user_id, token, platform) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO NOTHING`,
      [req.user.id, token, platform || "web"]
    );
    res.json({ message: "Device token terdaftar." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mendaftarkan token." });
  }
});

// DELETE /api/notifications/register-token — hapus token (mis. saat logout)
router.delete("/register-token", authenticate, async (req, res) => {
  const { token } = req.body;
  try {
    await pool.query(`DELETE FROM device_tokens WHERE user_id = $1 AND token = $2`, [req.user.id, token]);
    res.json({ message: "Device token dihapus." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal menghapus token." });
  }
});

module.exports = router;
