require("dotenv").config();
const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const masterDataRoutes = require("./routes/masterData");
const orderRoutes = require("./routes/orders");
const paymentSettingsRoutes = require("./routes/paymentSettings");
const paymentProofsRoutes = require("./routes/paymentProofs");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const customersRoutes = require("./routes/customers");

const app = express();

// FRONTEND_ORIGIN boleh diisi lebih dari 1 domain, dipisah koma
// (mis. app pelanggan + dashboard admin beda GitHub Pages).
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
  })
);

// PENTING: Vercel Serverless Functions punya batas keras 4.5MB per request
// (tidak bisa dinaikkan lewat config apa pun). Limit di bawah ini sengaja
// di-set di bawah itu. Foto bukti pembayaran WAJIB dikompres dulu di
// frontend sebelum dikirim (lihat compressImage() di app.js frontend).
app.use(express.json({ limit: "4mb" }));

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "The Sultan Laundry API" });
});

app.use("/api/auth", authRoutes);
app.use("/api/master-data", masterDataRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment-settings", paymentSettingsRoutes);
app.use("/api/payment-proofs", paymentProofsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/customers", customersRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan." });
});

// Error handler terakhir (jaga-jaga)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Terjadi kesalahan pada server." });
});

module.exports = app;
