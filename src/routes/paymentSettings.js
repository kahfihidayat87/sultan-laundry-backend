const express = require("express");
const { pool } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/payment-settings — publik, ditayangkan di frontend (rekening/QRIS aktif)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, method, bank_name, account_number, account_holder, qris_image_base64
       FROM payment_settings WHERE is_active = TRUE`
    );
    res.json({ paymentMethods: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil pengaturan pembayaran." });
  }
});

// PATCH /api/payment-settings/:id — admin ubah rekening / upload gambar QRIS
// body: { bankName?, accountNumber?, accountHolder?, qrisImageBase64?, isActive? }
router.patch("/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { bankName, accountNumber, accountHolder, qrisImageBase64, isActive } = req.body;
  try {
    const result = await pool.query(
      `UPDATE payment_settings SET
         bank_name = COALESCE($1, bank_name),
         account_number = COALESCE($2, account_number),
         account_holder = COALESCE($3, account_holder),
         qris_image_base64 = COALESCE($4, qris_image_base64),
         is_active = COALESCE($5, is_active),
         updated_at = NOW()
       WHERE id = $6 RETURNING id, method, bank_name, account_number, account_holder, is_active`,
      [bankName, accountNumber, accountHolder, qrisImageBase64, isActive, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Pengaturan tidak ditemukan." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengubah pengaturan pembayaran." });
  }
});

module.exports = router;
