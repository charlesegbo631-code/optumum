// db.js
import sqlite3 from "sqlite3";
import { open } from "sqlite";

// Open a connection to the SQLite database
const dbPromise = open({
  filename: "./data.db",
  driver: sqlite3.Database
});

// Export the db connection
export default dbPromise;
