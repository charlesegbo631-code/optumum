const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./data.db");

db.all("PRAGMA table_info(users)", (err, rows) => {
  if (err) return console.error("❌ Error:", err.message);
  console.log("🧩 Columns in 'users' table:");
  rows.forEach(row => console.log(`${row.name} (${row.type})`));
  db.close();
});
