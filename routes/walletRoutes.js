// walletRoutes.js
import express from "express";
import { verifyUser } from "../middleware/auth.js"; // your JWT middleware

const router = express.Router();

// mock or real DB import
import db from "../db.js";

router.get("/history", verifyUser, async (req, res) => {
  try {
    const userId = req.user.id;

    const rows = await db.all(
      "SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC",
      [userId]
    );

    res.json(rows);
  } catch (err) {
    console.error("History fetch error:", err);
    res.status(500).json({ error: "Failed to load transaction history" });
  }
});

export default router;
