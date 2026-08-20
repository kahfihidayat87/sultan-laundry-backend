const express = require("express");
const { pool } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const { notifyUser } = require("../utils/notify");

const router = express.Router();

// GET /api/admin/customers — daftar semua pelanggan, ringkas
// query: ?search=nama_atau_nomor (opsional)
router.get("/", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { search } = req.query;
  try {
    const params = [];
    let where = `WHERE role = 'pelanggan'`;
    if (search) {
      params.push(`%${search}%`);
      where += ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    const result = await pool.query(
      `SELECT u.id, u.name, u.phone, u.email, u.membership_tier, u.deposit_balance, u.loyalty_points, u.created_at,
              (SELECT COUNT(*) FROM orders o WHERE o.customer_id = u.id) AS total_orders
       FROM users u
       ${where}
       ORDER BY u.created_at DESC`,
      params
    );
    res.json({ customers: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil daftar pelanggan." });
  }
});

// GET /api/admin/customers/:id — detail 1 pelanggan + histori deposit & loyalty
router.get("/:id", authenticate, requireRole("admin", "owner"), async (req, res) => {
  try {
    const userResult = await pool.query(
      `SELECT id, name, phone, email, membership_tier, deposit_balance, loyalty_points, created_at
       FROM users WHERE id = $1 AND role = 'pelanggan'`,
      [req.params.id]
    );
    const customer = userResult.rows[0];
    if (!customer) return res.status(404).json({ error: "Pelanggan tidak ditemukan." });

    const [depositHistory, loyaltyHistory, orderHistory] = await Promise.all([
      pool.query(
        `SELECT id, amount, type, reference_order_id, timestamp FROM deposit_transactions
         WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 20`,
        [customer.id]
      ),
      pool.query(
        `SELECT id, points, type, reference_order_id, timestamp FROM loyalty_transactions
         WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 20`,
        [customer.id]
      ),
      pool.query(
        `SELECT id, status, final_total_price, estimated_total_price, payment_status, created_at
         FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 10`,
        [customer.id]
      ),
    ]);

    res.json({
      customer,
      depositHistory: depositHistory.rows,
      loyaltyHistory: loyaltyHistory.rows,
      recentOrders: orderHistory.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil detail pelanggan." });
  }
});

// POST /api/admin/customers/:id/deposit — topup atau kurangi saldo deposit manual
// body: { amount (positif), type: 'topup' | 'deduction', notes? }
router.post("/:id/deposit", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { amount, type, notes } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Nominal harus lebih dari 0." });
  if (!["topup", "deduction"].includes(type)) return res.status(400).json({ error: "Tipe harus 'topup' atau 'deduction'." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      `SELECT id, deposit_balance FROM users WHERE id = $1 AND role = 'pelanggan' FOR UPDATE`,
      [req.params.id]
    );
    const customer = userResult.rows[0];
    if (!customer) throw new Error("Pelanggan tidak ditemukan.");

    const currentBalance = Number(customer.deposit_balance);
    const delta = type === "topup" ? Number(amount) : -Number(amount);
    const newBalance = currentBalance + delta;

    if (newBalance < 0) throw new Error(`Saldo tidak cukup. Saldo saat ini: Rp ${currentBalance.toLocaleString("id-ID")}.`);

    await client.query(`UPDATE users SET deposit_balance = $1 WHERE id = $2`, [newBalance, customer.id]);
    await client.query(
      `INSERT INTO deposit_transactions (user_id, amount, type) VALUES ($1, $2, $3)`,
      [customer.id, amount, type]
    );

    await client.query("COMMIT");

    await notifyUser(customer.id, {
      title: type === "topup" ? "Deposit Bertambah" : "Deposit Berkurang",
      body: `Saldo deposit Anda ${type === "topup" ? "bertambah" : "berkurang"} Rp ${Number(amount).toLocaleString("id-ID")}. Saldo sekarang: Rp ${newBalance.toLocaleString("id-ID")}.`,
      data: { type: "deposit_update" },
    });

    res.json({ message: "Saldo deposit berhasil diperbarui.", newBalance });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(400).json({ error: err.message || "Gagal memperbarui deposit." });
  } finally {
    client.release();
  }
});

// PATCH /api/admin/customers/:id/membership — ubah tier membership manual
// body: { membershipTier }
router.patch("/:id/membership", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { membershipTier } = req.body;
  if (!membershipTier || !membershipTier.trim()) return res.status(400).json({ error: "Tier membership wajib diisi." });
  try {
    const result = await pool.query(
      `UPDATE users SET membership_tier = $1 WHERE id = $2 AND role = 'pelanggan' RETURNING id, membership_tier`,
      [membershipTier.trim(), req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Pelanggan tidak ditemukan." });
    res.json({ message: "Membership diperbarui.", membershipTier: result.rows[0].membership_tier });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengubah membership." });
  }
});

module.exports = router;
