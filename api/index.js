// Vercel otomatis mengubah file di folder /api menjadi serverless function.
// Express app adalah function (req, res) => {...}, jadi bisa langsung
// di-export dan Vercel akan memanggilnya untuk setiap request.
module.exports = require("../src/app");
