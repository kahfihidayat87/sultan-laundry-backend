// Kirim push notification via Firebase Cloud Messaging.
// Kalau kredensial Firebase belum diisi, fungsi ini hanya log ke console (tidak crash),
// supaya backend tetap jalan normal sebelum FCM disetup.
//
// Cara setup (deploy di Vercel — env var, BUKAN file, karena repo kadang publik):
// 1. Buat project di https://console.firebase.google.com
// 2. Project Settings -> Service Accounts -> Generate new private key -> unduh JSON
// 3. Buka file JSON itu, copy SELURUH isinya (satu baris, minify dulu kalau perlu)
// 4. Di Vercel: Project Settings -> Environment Variables -> tambah
//    FIREBASE_SERVICE_ACCOUNT_JSON = <paste seluruh isi JSON di sini>
// 5. Set FIREBASE_ENABLED=true
//
// (Untuk dev lokal, boleh juga taruh file `serviceAccountKey.json` di root folder
// backend ini — sudah ada di .gitignore — sebagai fallback kalau env var kosong.)

const { pool } = require("../config/db");

let admin = null;
let initialized = false;

function initFirebase() {
  if (initialized) return;
  initialized = true;
  if (process.env.FIREBASE_ENABLED !== "true") return;
  try {
    admin = require("firebase-admin");
    let serviceAccount;
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } else {
      serviceAccount = require("../../serviceAccountKey.json"); // fallback untuk dev lokal
    }
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  } catch (err) {
    console.warn("[FCM] Gagal inisialisasi Firebase, notifikasi akan di-skip:", err.message);
    admin = null;
  }
}

async function getTokensForUser(userId) {
  const result = await pool.query(`SELECT token FROM device_tokens WHERE user_id = $1`, [userId]);
  return result.rows.map((r) => r.token);
}

// notifyUser(userId, { title, body, data })
async function notifyUser(userId, { title, body, data = {} }) {
  initFirebase();

  if (!admin) {
    console.log(`[FCM-SKIP] -> user ${userId}: ${title} — ${body}`);
    return { sent: false, reason: "Firebase belum dikonfigurasi." };
  }

  const tokens = await getTokensForUser(userId);
  if (tokens.length === 0) {
    console.log(`[FCM] User ${userId} tidak punya device token terdaftar.`);
    return { sent: false, reason: "Tidak ada device token." };
  }

  try {
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      webpush: { fcmOptions: { link: "/" } },
    });
    return { sent: true, successCount: response.successCount, failureCount: response.failureCount };
  } catch (err) {
    console.error("[FCM] Gagal kirim notifikasi:", err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { notifyUser };
