// empty-wallet.js
const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./data.db");

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: node empty-wallet.js <user_id>");
  process.exit(1);
}

db.run("UPDATE wallet SET balance_cents = 0 WHERE user_id = ?", [userId], function (err) {
  if (err) {
    console.error("❌ Error:", err.message);
  } else {
    console.log(`✅ Wallet emptied for user ${userId}. Rows affected: ${this.changes}`);
  }
  db.close();
});
