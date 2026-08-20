const express = require("express");
const { pool } = require("../config/db");
const { authenticate, requireRole } = require("../middleware/auth");
const { canTransition, computeLineTotal, STAGES } = require("../utils/orderLogic");
const { notifyUser } = require("../utils/notify");

const router = express.Router();

// ---------------------------------------------------------
// POST /api/orders — Pelanggan submit cart jadi order baru
// body: { pickupAddress, scheduledPickupTime, items: [
//   { type: 'satuan', name, code, qty, durationCode, notes } |
//   { type: 'kiloan', name, code, durationCode, perfume, estimatedKg }
// ]}
// ---------------------------------------------------------
router.post("/", authenticate, requireRole("pelanggan"), async (req, res) => {
  const { pickupAddress, pickupLocationPin, scheduledPickupTime, items } = req.body;
  if (!pickupAddress || !scheduledPickupTime || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Alamat, jadwal pickup, dan minimal 1 item wajib diisi." });
  }
  const ALLOWED_SCHEDULES = ["Pagi (08.00-10.00)", "Sore (14.00-16.00)"];
  if (!ALLOWED_SCHEDULES.includes(scheduledPickupTime)) {
    return res.status(400).json({ error: "Jadwal pickup harus salah satu dari: " + ALLOWED_SCHEDULES.join(", ") });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const durationsResult = await client.query(`SELECT code, multiplier, satuan_surcharge FROM duration_multipliers`);
    const durationByCode = Object.fromEntries(
      durationsResult.rows.map((d) => [d.code, { multiplier: Number(d.multiplier), surcharge: Number(d.satuan_surcharge) }])
    );

    let estimatedTotal = 0;
    const preparedItems = [];

    for (const it of items) {
      const durationInfo = durationByCode[it.durationCode];
      if (!durationInfo) throw new Error(`Durasi tidak valid: ${it.durationCode}`);

      if (it.type === "satuan") {
        const masterResult = await client.query(
          `SELECT base_price FROM master_items WHERE code = $1 AND is_active = TRUE`,
          [it.code]
        );
        if (masterResult.rows.length === 0) throw new Error(`Item satuan tidak dikenal: ${it.code}`);
        const unitPrice = Number(masterResult.rows[0].base_price);
        const qty = Number(it.qty || 0);
        const extra = durationInfo.surcharge; // tambahan flat Rp5.000/tingkat, BUKAN dikali
        const lineEstimate = Math.round((unitPrice + extra) * qty);
        estimatedTotal += lineEstimate;
        preparedItems.push({
          item_type: "satuan",
          item_name: it.name,
          duration_code: it.durationCode,
          perfume: null,
          notes: it.notes || null,
          qty_input: qty,
          unit_price: unitPrice,
          duration_extra: extra,
        });
      } else if (it.type === "kiloan") {
        const masterResult = await client.query(
          `SELECT price_per_kg FROM master_kiloan_services WHERE code = $1 AND is_active = TRUE`,
          [it.code]
        );
        if (masterResult.rows.length === 0) throw new Error(`Layanan kiloan tidak dikenal: ${it.code}`);
        const unitPrice = Number(masterResult.rows[0].price_per_kg);
        preparedItems.push({
          item_type: "kiloan",
          item_name: it.name,
          duration_code: it.durationCode,
          perfume: it.perfume || null,
          notes: it.notes || null,
          qty_input: it.estimatedKg || null, // hanya estimasi tampilan, TIDAK dipakai untuk harga final
          unit_price: unitPrice,
          duration_extra: 0,
        });
        // Baris kiloan sengaja TIDAK ditambahkan ke estimatedTotal — harga final baru ada
        // setelah penimbangan riil di outlet (lihat endpoint /verify). Multiplier durasi
        // tetap dipakai untuk Kiloan (bukan surcharge flat seperti Satuan).
      } else {
        throw new Error(`Tipe item tidak dikenal: ${it.type}`);
      }
    }

    const orderResult = await client.query(
      `INSERT INTO orders (customer_id, status, pickup_address, pickup_location_pin, scheduled_pickup_time, estimated_total_price)
       VALUES ($1, 1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, pickupAddress, pickupLocationPin || null, scheduledPickupTime, estimatedTotal]
    );
    const order = orderResult.rows[0];

    for (const item of preparedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, item_type, item_name, duration_code, perfume, notes, qty_input, unit_price, duration_extra)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [order.id, item.item_type, item.item_name, item.duration_code, item.perfume, item.notes, item.qty_input, item.unit_price, item.duration_extra]
      );
    }

    await client.query(
      `INSERT INTO order_status_history (order_id, status, changed_by, notes) VALUES ($1, 1, $2, 'Order dibuat pelanggan')`,
      [order.id, req.user.id]
    );

    await client.query("COMMIT");
    res.status(201).json({ order, message: "Order berhasil dikirim, menunggu konfirmasi outlet." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(400).json({ error: err.message || "Gagal membuat order." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------
// GET /api/orders/:id — detail order + item + histori status
// ---------------------------------------------------------
router.get("/:id", authenticate, async (req, res) => {
  try {
    const orderResult = await pool.query(
      `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone
       FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = $1`,
      [req.params.id]
    );
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });

    const isOwnerOfOrder = order.customer_id === req.user.id;
    const isStaff = ["admin", "owner", "kurir"].includes(req.user.role);
    if (!isOwnerOfOrder && !isStaff) return res.status(403).json({ error: "Tidak berwenang melihat order ini." });

    const [items, history] = await Promise.all([
      pool.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id`, [order.id]),
      pool.query(`SELECT * FROM order_status_history WHERE order_id = $1 ORDER BY timestamp`, [order.id]),
    ]);

    res.json({ order: { ...order, status_label: STAGES[order.status] }, items: items.rows, history: history.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil order." });
  }
});

// ---------------------------------------------------------
// GET /api/orders — list order milik pelanggan (atau semua, untuk admin/kurir)
// query: ?status=1
// ---------------------------------------------------------
router.get("/", authenticate, async (req, res) => {
  const { status } = req.query;
  const isStaff = ["admin", "owner", "kurir"].includes(req.user.role);
  try {
    const conditions = [];
    const params = [];
    if (!isStaff) {
      params.push(req.user.id);
      conditions.push(`o.customer_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT o.*, u.name AS customer_name, u.phone AS customer_phone
       FROM orders o JOIN users u ON u.id = o.customer_id
       ${where} ORDER BY o.created_at DESC`,
      params
    );
    res.json({ orders: result.rows.map((o) => ({ ...o, status_label: STAGES[o.status] })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil daftar order." });
  }
});

// ---------------------------------------------------------
// PATCH /api/orders/:id/status — transisi status biasa (bukan tahap 4)
// body: { photoUrl?, notes? }
// ---------------------------------------------------------
router.patch("/:id/status", authenticate, requireRole("admin", "owner", "kurir"), async (req, res) => {
  const { photoUrl, notes } = req.body;
  try {
    const orderResult = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });

    const check = canTransition(order.status, req.user.role);
    if (!check.ok) return res.status(400).json({ error: check.reason });

    await pool.query(`UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`, [check.next, order.id]);
    await pool.query(
      `INSERT INTO order_status_history (order_id, status, changed_by, photo_url, notes) VALUES ($1, $2, $3, $4, $5)`,
      [order.id, check.next, req.user.id, photoUrl || null, notes || null]
    );

    await notifyUser(order.customer_id, {
      title: "Update Pesanan",
      body: `Order #${order.id} sekarang: ${STAGES[check.next]}`,
      data: { orderId: order.id, status: check.next, type: "status_update" },
    });

    res.json({ message: `Status diperbarui ke "${STAGES[check.next]}"`, status: check.next });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal memperbarui status." });
  }
});

// ---------------------------------------------------------
// POST /api/orders/:id/verify — Admin verifikasi & timbang di outlet (status 3 -> 4 -> 5)
// body: { items: [{ id (order_item id), qtyVerified }] }
// Menghitung ulang harga final, deteksi selisih > threshold.
// ---------------------------------------------------------
router.post("/:id/verify", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Data verifikasi item wajib diisi." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderResult = await client.query(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const order = orderResult.rows[0];
    if (!order) throw new Error("Order tidak ditemukan.");
    if (![3, 4].includes(order.status)) {
      throw new Error(`Order harus berstatus "Tiba di Outlet" untuk diverifikasi (saat ini: ${STAGES[order.status]}).`);
    }

    const durationsResult = await client.query(`SELECT code, multiplier FROM duration_multipliers`);
    const multByCode = Object.fromEntries(durationsResult.rows.map((d) => [d.code, Number(d.multiplier)]));

    let finalTotal = 0;
    for (const it of items) {
      const itemResult = await client.query(`SELECT * FROM order_items WHERE id = $1 AND order_id = $2`, [it.id, order.id]);
      const dbItem = itemResult.rows[0];
      if (!dbItem) continue;

      const mult = multByCode[dbItem.duration_code] || 1;
      const lineTotal = computeLineTotal({ ...dbItem, qty_verified: it.qtyVerified }, mult);
      finalTotal += lineTotal;

      await client.query(`UPDATE order_items SET qty_verified = $1, line_total = $2 WHERE id = $3`, [
        it.qtyVerified,
        lineTotal,
        dbItem.id,
      ]);
    }

    const threshold = Number(process.env.PRICE_DEVIATION_THRESHOLD || 20);
    const estimate = Number(order.estimated_total_price) || 0;
    const deviationPct = estimate > 0 ? Math.round(((finalTotal - estimate) / estimate) * 1000) / 10 : 0;
    const needsConfirmation = Math.abs(deviationPct) > threshold;

    // Status 4 dulu (Verifikasi), lalu langsung 5 (Proses Cuci) kecuali selisih besar & perlu konfirmasi pelanggan
    const newStatus = needsConfirmation ? 4 : 5;

    await client.query(
      `UPDATE orders SET status = $1, final_total_price = $2, price_deviation_pct = $3, updated_at = NOW() WHERE id = $4`,
      [newStatus, finalTotal, deviationPct, order.id]
    );
    await client.query(
      `INSERT INTO order_status_history (order_id, status, changed_by, notes) VALUES ($1, $2, $3, $4)`,
      [order.id, newStatus, req.user.id, `Verifikasi selesai. Total final: ${finalTotal}. Selisih: ${deviationPct}%`]
    );

    await client.query("COMMIT");

    await notifyUser(order.customer_id, needsConfirmation
      ? {
          title: "Konfirmasi Selisih Harga Diperlukan",
          body: `Order #${order.id}: harga final berbeda ${deviationPct}% dari estimasi. Buka app untuk konfirmasi.`,
          data: { orderId: order.id, type: "deviation_confirmation" },
        }
      : {
          title: "Pesanan Diverifikasi",
          body: `Order #${order.id} siap dicuci. Total tagihan: Rp ${finalTotal.toLocaleString("id-ID")}.`,
          data: { orderId: order.id, type: "verified" },
        }
    );

    res.json({
      message: needsConfirmation
        ? `Selisih harga ${deviationPct}% melebihi ambang batas — menunggu konfirmasi pelanggan sebelum lanjut cuci.`
        : "Verifikasi selesai, order lanjut ke Proses Cuci.",
      finalTotal,
      deviationPct,
      needsConfirmation,
      status: newStatus,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(400).json({ error: err.message || "Gagal memverifikasi order." });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------
// POST /api/orders/:id/confirm-deviation — pelanggan konfirmasi selisih harga besar
// ---------------------------------------------------------
router.post("/:id/confirm-deviation", authenticate, requireRole("pelanggan"), async (req, res) => {
  try {
    const orderResult = await pool.query(`SELECT * FROM orders WHERE id = $1 AND customer_id = $2`, [
      req.params.id,
      req.user.id,
    ]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });
    if (order.status !== 4) return res.status(400).json({ error: "Order ini tidak sedang menunggu konfirmasi Anda." });

    await pool.query(
      `UPDATE orders SET status = 5, customer_confirmed_deviation = TRUE, updated_at = NOW() WHERE id = $1`,
      [order.id]
    );
    await pool.query(
      `INSERT INTO order_status_history (order_id, status, changed_by, notes) VALUES ($1, 5, $2, 'Pelanggan konfirmasi selisih harga')`,
      [order.id, req.user.id]
    );
    res.json({ message: "Konfirmasi diterima, order lanjut ke Proses Cuci." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal konfirmasi." });
  }
});

// ---------------------------------------------------------
// POST /api/orders/:id/admin-confirm-deviation — Admin konfirmasi selisih harga
// atas nama pelanggan (mis. sudah dikonfirmasi via telepon/WA langsung).
// body: { notes } — WAJIB diisi, untuk jejak audit siapa/kapan konfirmasi dilakukan.
// ---------------------------------------------------------
router.post("/:id/admin-confirm-deviation", authenticate, requireRole("admin", "owner"), async (req, res) => {
  const { notes } = req.body;
  if (!notes || !notes.trim()) {
    return res.status(400).json({ error: "Catatan wajib diisi (mis. cara & waktu konfirmasi ke pelanggan)." });
  }
  try {
    const orderResult = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });
    if (order.status !== 4) return res.status(400).json({ error: "Order ini tidak sedang menunggu konfirmasi selisih harga." });

    await pool.query(
      `UPDATE orders SET status = 5, customer_confirmed_deviation = TRUE, updated_at = NOW() WHERE id = $1`,
      [order.id]
    );
    await pool.query(
      `INSERT INTO order_status_history (order_id, status, changed_by, notes) VALUES ($1, 5, $2, $3)`,
      [order.id, req.user.id, `Dikonfirmasi Admin atas nama pelanggan: ${notes.trim()}`]
    );

    await notifyUser(order.customer_id, {
      title: "Pesanan Dilanjutkan",
      body: `Order #${order.id} lanjut ke Proses Cuci setelah dikonfirmasi Admin.`,
      data: { orderId: order.id, type: "status_update" },
    });

    res.json({ message: "Order lanjut ke Proses Cuci." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal konfirmasi." });
  }
});

// ---------------------------------------------------------
// POST /api/orders/:id/payment-proof — pelanggan upload bukti transfer/QRIS
// body: { method: 'bank_transfer'|'qris', imageBase64 }
// Hanya bisa dilakukan setelah order diverifikasi (final_total_price sudah ada).
// ---------------------------------------------------------
router.post("/:id/payment-proof", authenticate, requireRole("pelanggan"), async (req, res) => {
  const { method, imageBase64 } = req.body;
  if (!method || !imageBase64) return res.status(400).json({ error: "Metode dan gambar bukti wajib diisi." });
  if (!["bank_transfer", "qris"].includes(method)) return res.status(400).json({ error: "Metode tidak valid." });

  try {
    const orderResult = await pool.query(`SELECT * FROM orders WHERE id = $1 AND customer_id = $2`, [
      req.params.id,
      req.user.id,
    ]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });
    if (order.final_total_price === null) {
      return res.status(400).json({ error: "Order belum diverifikasi outlet, belum ada tagihan final." });
    }

    const result = await pool.query(
      `INSERT INTO payment_proofs (order_id, method, image_base64, uploaded_by)
       VALUES ($1, $2, $3, $4) RETURNING id, order_id, method, status, created_at`,
      [order.id, method, imageBase64, req.user.id]
    );

    res.status(201).json({ message: "Bukti pembayaran terkirim, menunggu verifikasi Admin.", proof: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengunggah bukti pembayaran." });
  }
});

// GET /api/orders/:id/payment-proof — pemilik order atau staff lihat semua bukti untuk order ini
router.get("/:id/payment-proof", authenticate, async (req, res) => {
  try {
    const orderResult = await pool.query(`SELECT * FROM orders WHERE id = $1`, [req.params.id]);
    const order = orderResult.rows[0];
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });

    const isOwnerOfOrder = order.customer_id === req.user.id;
    const isStaff = ["admin", "owner"].includes(req.user.role);
    if (!isOwnerOfOrder && !isStaff) return res.status(403).json({ error: "Tidak berwenang." });

    const result = await pool.query(
      `SELECT id, method, status, notes, created_at, reviewed_at,
              CASE WHEN $2 THEN image_base64 ELSE NULL END AS image_base64
       FROM payment_proofs WHERE order_id = $1 ORDER BY created_at DESC`,
      [order.id, true] // gambar selalu diikutkan untuk pemilik/staff yang lolos guard di atas
    );
    res.json({ proofs: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal mengambil bukti pembayaran." });
  }
});

module.exports = router;
