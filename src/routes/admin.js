const express = require("express");
const { pool } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const { STAGES } = require("../utils/orderLogic");

const router = express.Router();

// GET /api/admin/summary — ringkasan untuk halaman utama dashboard
router.get("/summary", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const [byStatus, todayRevenue, pendingProofs, overdue] = await Promise.all([
      pool.query(`SELECT status, COUNT(*) AS count FROM orders GROUP BY status`),
      pool.query(
        `SELECT COALESCE(SUM(final_total_price), 0) AS total FROM orders
         WHERE payment_status = 'paid' AND updated_at::date = CURRENT_DATE`
      ),
      pool.query(`SELECT COUNT(*) AS count FROM payment_proofs WHERE status = 'pending'`),
      pool.query(
        `SELECT COUNT(*) AS count FROM orders
         WHERE status NOT IN (8) AND created_at < NOW() - INTERVAL '3 days'`
      ),
    ]);

    const statusCounts = {};
    for (const key of Object.keys(STAGES)) statusCounts[key] = 0;
    byStatus.rows.forEach((r) => (statusCounts[r.status] = Number(r.count)));

    res.json({
      statusCounts,
      statusLabels: STAGES,
      todayRevenue: Number(todayRevenue.rows[0].total),
      pendingPaymentProofs: Number(pendingProofs.rows[0].count),
      overdueOrders: Number(overdue.rows[0].count),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil ringkasan." });
  }
});

module.exports = router;
