const express = require("express");
const { pool } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");

const router = express.Router();

// GET /api/master-data — publik, dipakai frontend untuk bangun form order secara dinamis
router.get("/", async (req, res) => {
  try {
    const [items, kiloan, perfumes, durations] = await Promise.all([
      pool.query(`SELECT id, code, name, base_price FROM master_items WHERE is_active = TRUE ORDER BY name`),
      pool.query(`SELECT id, code, name, price_per_kg FROM master_kiloan_services WHERE is_active = TRUE ORDER BY name`),
      pool.query(`SELECT id, name FROM master_perfumes WHERE is_active = TRUE ORDER BY name`),
      pool.query(`SELECT code, name, time_label, multiplier, satuan_surcharge FROM duration_multipliers ORDER BY multiplier`),
    ]);
    res.json({
      items: items.rows,
      kiloanServices: kiloan.rows,
      perfumes: perfumes.rows,
      durations: durations.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil master data." });
  }
});

// PATCH /api/master-data/items/:id — admin ubah harga item satuan (tanpa perlu developer)
router.patch("/items/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { base_price, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE master_items SET base_price = COALESCE($1, base_price), is_active = COALESCE($2, is_active)
       WHERE id = $3 RETURNING *`,
      [base_price, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Item tidak ditemukan." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengubah item." });
  }
});

// PATCH /api/master-data/kiloan/:id — admin ubah harga/kg
router.patch("/kiloan/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { price_per_kg, is_active } = req.body;
  try {
    const result = await pool.query(
      `UPDATE master_kiloan_services SET price_per_kg = COALESCE($1, price_per_kg), is_active = COALESCE($2, is_active)
       WHERE id = $3 RETURNING *`,
      [price_per_kg, is_active, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Layanan tidak ditemukan." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengubah layanan kiloan." });
  }
});

// PATCH /api/master-data/durations/:code — admin ubah multiplier (Kiloan) dan/atau surcharge (Satuan)
router.patch("/durations/:code", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { multiplier, satuanSurcharge } = req.body;
  try {
    const result = await pool.query(
      `UPDATE duration_multipliers SET
         multiplier = COALESCE($1, multiplier),
         satuan_surcharge = COALESCE($2, satuan_surcharge)
       WHERE code = $3 RETURNING *`,
      [multiplier, satuanSurcharge, req.params.code]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Durasi tidak ditemukan." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengubah durasi." });
  }
});

module.exports = router;
