import express from "express";
import axios from "axios";

const router = express.Router();

const BASE = "http://185.199.111.153/api/v1/";



const AXIOS = axios.create({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    Accept: "application/json",
  },
});

// --- VALID DOMAINS (1secmail)
const VALID_DOMAINS = [
  "1secmail.com",
  "1secmail.org",
  "1secmail.net",
  "wwjmp.com",
  "esiix.com",
  "xojxe.com",
  "vddaz.com",
];

// --- HELPER: validate domain ---
function safeDomain(domain) {
  if (VALID_DOMAINS.includes(domain)) return domain;
  return "1secmail.com";
}

// --- GET INBOX MESSAGES ---
router.get("/messages", async (req, res) => {
  let { login, domain } = req.query;

  if (!login)
    return res.status(400).json({ error: "login required" });

  domain = safeDomain(domain);

  const url = `${BASE}?action=getMessages&login=${login}&domain=${domain}`;

  try {
    const response = await AXIOS.get(url);
    res.json(response.data);
  } catch (err) {
    console.error("📩 EMAIL FETCH ERROR:");
    console.error("Status:", err.response?.status);
    console.error("Message:", err.response?.data || err.message);

    return res.status(500).json({
      error: "Failed to fetch messages",
      details: err.response?.data || null,
    });
  }
});

// --- READ MESSAGE ---
router.get("/read", async (req, res) => {
  let { login, domain, id } = req.query;

  if (!login || !id)
    return res.status(400).json({ error: "login and id required" });

  domain = safeDomain(domain);

  const url = `${BASE}?action=readMessage&login=${login}&domain=${domain}&id=${id}`;

  try {
    const response = await AXIOS.get(url);
    res.json(response.data);
  } catch (err) {
    console.error("📧 READ MESSAGE ERROR:");
    console.error("Status:", err.response?.status);
    console.error("Message:", err.response?.data || err.message);

    return res.status(500).json({
      error: "Failed to read message",
      details: err.response?.data || null,
    });
  }
});

export default router;
