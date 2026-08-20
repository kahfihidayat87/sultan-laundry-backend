// Definisi 8 tahap siklus order + aturan transisi (siapa boleh pindahkan ke tahap apa).
// Status 4 (Verifikasi & Penimbangan) TIDAK dipindah lewat endpoint status biasa —
// harus lewat POST /api/orders/:id/verify karena harus menghitung ulang harga final.

const STAGES = {
  1: "Menunggu Konfirmasi",
  2: "Dijemput Kurir",
  3: "Tiba di Outlet",
  4: "Verifikasi & Penimbangan",
  5: "Proses Cuci",
  6: "QC",
  7: "Siap Diantar",
  8: "Selesai",
};

// key = status saat ini -> { next, roles: siapa yang boleh eksekusi transisi ini }
const TRANSITIONS = {
  1: { next: 2, roles: ["admin", "owner"] },   // admin konfirmasi & assign kurir pickup
  2: { next: 3, roles: ["admin", "owner", "kurir"] }, // kurir/admin tandai barang tiba di outlet
  3: { next: 4, roles: ["admin", "owner"] },   // admin mulai proses verifikasi (lalu commit via /verify)
  // 4 -> 5 hanya lewat endpoint /verify
  5: { next: 6, roles: ["admin", "owner"] },
  6: { next: 7, roles: ["admin", "owner"] },
  7: { next: 8, roles: ["admin", "owner", "kurir"] }, // kurir tandai selesai antar
};

function canTransition(currentStatus, role) {
  const rule = TRANSITIONS[currentStatus];
  if (!rule) return { ok: false, reason: "Tidak ada transisi manual dari status ini." };
  if (!rule.roles.includes(role)) return { ok: false, reason: "Role Anda tidak berwenang untuk transisi ini." };
  return { ok: true, next: rule.next };
}

// Hitung total baris order_item setelah qty_verified diisi admin di outlet.
//
// SATUAN: harga = (harga_dasar_per_pcs + surcharge_durasi) x qty
//   Surcharge FLAT per tingkat durasi (Rp5.000/tingkat), dikunci di order_items.duration_extra
//   saat order dibuat — bukan dikali multiplier.
// KILOAN: harga = harga_per_kg x qty(kg) x multiplier_durasi (tetap seperti semula).
function computeLineTotal(item, durationMultiplier) {
  const qty = Number(item.qty_verified ?? item.qty_input ?? 0);
  const unitPrice = Number(item.unit_price ?? 0);
  if (item.item_type === "satuan") {
    const extra = Number(item.duration_extra ?? 0);
    return Math.round(qty * (unitPrice + extra));
  }
  return Math.round(qty * unitPrice * durationMultiplier);
}

module.exports = { STAGES, TRANSITIONS, canTransition, computeLineTotal };
