const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./data.db");

db.all("SELECT id, email FROM users", (err, rows) => {
  if (err) return console.error("❌ Error:", err.message);
  if (rows.length === 0) {
    console.log("⚠️ No users found in the database.");
  } else {
    console.log("🧑‍💻 Users:");
    rows.forEach(row => console.log(`ID: ${row.id} | Email: ${row.email}`));
  }
  db.close();
});
