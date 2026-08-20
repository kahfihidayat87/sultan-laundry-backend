const express = require("express");
const { pool } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const { notifyUser } = require("../utils/notify");

const router = express.Router();

// GET /api/payment-proofs/pending — daftar semua bukti yang belum direview (dashboard admin)
router.get("/pending", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pp.*, o.customer_id, o.final_total_price, u.name AS customer_name
       FROM payment_proofs pp
       JOIN orders o ON o.id = pp.order_id
       JOIN users u ON u.id = o.customer_id
       WHERE pp.status = 'pending'
       ORDER BY pp.created_at ASC`
    );
    res.json({ proofs: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil daftar bukti pembayaran." });
  }
});

// POST /api/payment-proofs/:id/review — admin approve/reject bukti pembayaran
// body: { decision: 'approved' | 'rejected', notes? }
router.post("/:id/review", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { decision, notes } = req.body;
  if (!["approved", "rejected"].includes(decision)) {
    return res.status(400).json({ error: "Keputusan harus 'approved' atau 'rejected'." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const proofResult = await client.query(`SELECT * FROM payment_proofs WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const proof = proofResult.rows[0];
    if (!proof) throw new Error("Bukti pembayaran tidak ditemukan.");
    if (proof.status !== "pending") throw new Error("Bukti pembayaran ini sudah direview sebelumnya.");

    await client.query(
      `UPDATE payment_proofs SET status = $1, reviewed_by = $2, reviewed_at = NOW(), notes = $3 WHERE id = $4`,
      [decision, req.user.id, notes || null, proof.id]
    );

    const orderResult = await client.query(`SELECT * FROM orders WHERE id = $1`, [proof.order_id]);
    const order = orderResult.rows[0];

    if (decision === "approved") {
      await client.query(
        `UPDATE orders SET payment_status = 'paid', payment_method = $1, updated_at = NOW() WHERE id = $2`,
        [proof.method, order.id]
      );
    }

    await client.query("COMMIT");

    await notifyUser(order.customer_id, {
      title: decision === "approved" ? "Pembayaran Dikonfirmasi" : "Bukti Pembayaran Ditolak",
      body:
        decision === "approved"
          ? `Pembayaran order #${order.id} sudah dikonfirmasi. Terima kasih!`
          : `Bukti pembayaran order #${order.id} ditolak. ${notes || "Silakan unggah ulang."}`,
      data: { orderId: order.id, type: "payment_review" },
    });

    res.json({ message: `Bukti pembayaran ${decision === "approved" ? "disetujui" : "ditolak"}.` });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(400).json({ error: err.message || "Gagal mereview bukti pembayaran." });
  } finally {
    client.release();
  }
});

module.exports = router;
