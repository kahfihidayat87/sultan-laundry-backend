-- ============================================================
-- The Sultan Laundry — Skema Database (PostgreSQL)
-- Status order: 1 Menunggu Konfirmasi, 2 Dijemput Kurir, 3 Tiba di Outlet,
-- 4 Verifikasi & Penimbangan, 5 Proses Cuci, 6 QC, 7 Siap Diantar, 8 Selesai
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(150) NOT NULL,
  phone           VARCHAR(20) UNIQUE,
  email           VARCHAR(150) UNIQUE,
  password_hash   TEXT NOT NULL,
  role            VARCHAR(20) NOT NULL CHECK (role IN ('owner','admin','kurir','pelanggan')),
  membership_tier VARCHAR(30) DEFAULT 'Reguler',
  deposit_balance NUMERIC(12,2) DEFAULT 0,
  loyalty_points  INTEGER DEFAULT 0,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS master_items (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50) UNIQUE NOT NULL,
  name        VARCHAR(150) NOT NULL,
  base_price  NUMERIC(10,2) NOT NULL,
  is_active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS master_kiloan_services (
  id             SERIAL PRIMARY KEY,
  code           VARCHAR(50) UNIQUE NOT NULL,
  name           VARCHAR(150) NOT NULL,
  price_per_kg   NUMERIC(10,2) NOT NULL,
  is_active      BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS master_perfumes (
  id      SERIAL PRIMARY KEY,
  name    VARCHAR(100) UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS duration_multipliers (
  id                SERIAL PRIMARY KEY,
  code              VARCHAR(30) UNIQUE NOT NULL, -- reguler / ekspress / kilat / prioritas / darurat
  name              VARCHAR(50) NOT NULL,
  time_label        VARCHAR(50) NOT NULL,
  multiplier        NUMERIC(4,2) NOT NULL DEFAULT 1,  -- dipakai untuk KILOAN (harga/kg x multiplier)
  satuan_surcharge  NUMERIC(10,2) NOT NULL DEFAULT 0  -- dipakai untuk SATUAN (tambahan Rp flat per pcs)
);

CREATE TABLE IF NOT EXISTS orders (
  id                    SERIAL PRIMARY KEY,
  customer_id           INTEGER NOT NULL REFERENCES users(id),
  kurir_pickup_id       INTEGER REFERENCES users(id),
  kurir_delivery_id     INTEGER REFERENCES users(id),
  status                SMALLINT NOT NULL DEFAULT 1 CHECK (status BETWEEN 1 AND 8),
  pickup_address        TEXT NOT NULL,
  pickup_location_pin   TEXT,             -- link Google Maps titik lokasi pickup (opsional)
  scheduled_pickup_time VARCHAR(100) NOT NULL,
  estimated_total_price NUMERIC(12,2) DEFAULT 0,
  final_total_price     NUMERIC(12,2),
  price_deviation_pct   NUMERIC(6,2),
  customer_confirmed_deviation BOOLEAN DEFAULT FALSE,
  payment_status        VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid')),
  payment_method        VARCHAR(30),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id              SERIAL PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_type       VARCHAR(10) NOT NULL CHECK (item_type IN ('satuan','kiloan')),
  item_name       VARCHAR(150) NOT NULL,
  duration_code   VARCHAR(30) NOT NULL REFERENCES duration_multipliers(code),
  perfume         VARCHAR(100),
  notes           TEXT,

  -- input pelanggan saat checkout
  qty_input       NUMERIC(10,2),   -- pcs (satuan) atau estimasi kg (kiloan, boleh null)
  unit_price      NUMERIC(10,2),   -- harga/pcs (satuan) atau harga/kg (kiloan)
  duration_extra  NUMERIC(10,2) DEFAULT 0, -- SATUAN saja: tambahan Rp per pcs sesuai durasi, dikunci saat order dibuat

  -- diisi admin saat verifikasi di outlet
  qty_verified    NUMERIC(10,2),   -- pcs riil (satuan) atau berat riil kg (kiloan)
  line_total      NUMERIC(12,2),   -- dihitung setelah verifikasi

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      SMALLINT NOT NULL,
  changed_by  INTEGER REFERENCES users(id),
  photo_url   TEXT,
  notes       TEXT,
  timestamp   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qc_checklist (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  passed      BOOLEAN NOT NULL,
  notes       TEXT,
  checked_by  INTEGER REFERENCES users(id),
  timestamp   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  points            INTEGER NOT NULL,
  type              VARCHAR(10) NOT NULL CHECK (type IN ('earn','redeem')),
  reference_order_id INTEGER REFERENCES orders(id),
  timestamp         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deposit_transactions (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  amount            NUMERIC(12,2) NOT NULL,
  type              VARCHAR(15) NOT NULL CHECK (type IN ('topup','deduction')),
  reference_order_id INTEGER REFERENCES orders(id),
  timestamp         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          SERIAL PRIMARY KEY,
  phone       VARCHAR(20),
  email       VARCHAR(150),
  code        VARCHAR(6) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed    BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Pembayaran manual (transfer / QRIS) + push notification
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_settings (
  id                SERIAL PRIMARY KEY,
  method            VARCHAR(20) NOT NULL CHECK (method IN ('bank_transfer','qris')),
  bank_name         VARCHAR(100),
  account_number    VARCHAR(50),
  account_holder    VARCHAR(150),
  qris_image_base64 TEXT,
  is_active         BOOLEAN DEFAULT TRUE,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_proofs (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method        VARCHAR(20) NOT NULL CHECK (method IN ('bank_transfer','qris')),
  image_base64  TEXT NOT NULL,
  uploaded_by   INTEGER REFERENCES users(id),
  status        VARCHAR(15) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  platform    VARCHAR(20) DEFAULT 'web',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_order ON payment_proofs(order_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ============================================================
-- Seed data — master item, layanan kiloan, parfum, durasi
-- ============================================================

INSERT INTO duration_multipliers (code, name, time_label, multiplier, satuan_surcharge) VALUES
  ('reguler',   'Reguler',   '48–72 jam', 1.0, 0),
  ('ekspress',  'Ekspress',  '24–48 jam', 1.3, 5000),
  ('kilat',     'Kilat',     '12–24 jam', 1.6, 10000),
  ('prioritas', 'Prioritas', '6–12 jam',  2.0, 15000),
  ('darurat',   'Darurat',   '3–6 jam',   2.5, 20000)
ON CONFLICT (code) DO NOTHING;

INSERT INTO master_perfumes (name) VALUES
  ('Aqua Fresh'), ('Junjung Buih'), ('Madinah'), ('Lavender')
ON CONFLICT (name) DO NOTHING;

INSERT INTO master_kiloan_services (code, name, price_per_kg) VALUES
  ('cuci_lipat',   'Cuci Lipat',   6000),
  ('cuci_setrika', 'Cuci Setrika', 8000),
  ('setrika',      'Setrika Saja', 5000)
ON CONFLICT (code) DO NOTHING;

INSERT INTO payment_settings (method, bank_name, account_number, account_holder, is_active) VALUES
  ('bank_transfer', 'Bank Syariah Indonesia', '7123456789', 'The Sultan Laundry', TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO payment_settings (method, is_active) VALUES
  ('qris', TRUE)
ON CONFLICT DO NOTHING;
-- Catatan: isi qris_image_base64 lewat dashboard Admin (upload gambar QRIS statis merchant Anda).

INSERT INTO master_items (code, name, base_price) VALUES
  ('selimut_single', 'Selimut Single', 15000),
  ('selimut_double', 'Selimut Double', 20000),
  ('jaket_tebal', 'Jaket Tebal / Berbulu', 18000),
  ('gorden', 'Gorden', 25000),
  ('tas', 'Tas', 15000),
  ('ransel_gunung', 'Ransel Gunung', 20000),
  ('bantal_guling', 'Bantal Guling', 10000),
  ('sepatu_anak', 'Sepatu Anak', 12000),
  ('sepatu_dewasa', 'Sepatu Dewasa', 15000),
  ('boneka_kecil', 'Boneka Kecil', 8000),
  ('boneka_sedang', 'Boneka Sedang', 15000),
  ('boneka_besar', 'Boneka Besar', 25000),
  ('bedcover_single', 'Bed Cover Single', 18000),
  ('bedcover_double', 'Bed Cover Double', 25000),
  ('bedcover_king', 'Bed Cover Kingsize', 30000),
  ('sprei_single', 'Sprei Single', 10000),
  ('sprei_double', 'Sprei Double', 15000)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- MIGRASI (aman dijalankan ulang kapan saja, tidak akan menghapus data)
-- Jalankan blok ini di Neon SQL Editor kalau database Anda dibuat
-- SEBELUM kolom-kolom berikut ditambahkan.
-- ============================================================

-- Kolom baru: surcharge Satuan per durasi, pin lokasi pickup, duration_extra per item
ALTER TABLE duration_multipliers ADD COLUMN IF NOT EXISTS satuan_surcharge NUMERIC(10,2) NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_location_pin TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS duration_extra NUMERIC(10,2) DEFAULT 0;

-- Isi nilai surcharge Satuan: kelipatan Rp5.000 per tingkat durasi
UPDATE duration_multipliers SET satuan_surcharge = 0     WHERE code = 'reguler';
UPDATE duration_multipliers SET satuan_surcharge = 5000  WHERE code = 'ekspress';
UPDATE duration_multipliers SET satuan_surcharge = 10000 WHERE code = 'kilat';
UPDATE duration_multipliers SET satuan_surcharge = 15000 WHERE code = 'prioritas';
UPDATE duration_multipliers SET satuan_surcharge = 20000 WHERE code = 'darurat';
