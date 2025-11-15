/**
 * server.js
 * Clean, single-file ESM backend with:
 * - Auth (register/login)
 * - Wallet (deposit, balance)
 * - Referrals
 * - Paystack init/verify
 * - VTpass airtime/data
 * - 5SIM foreign-number purchase
 * - Webshare proxy purchase
 * - WireGuard VPN account generation (wg CLI required)
 * - Disposable email utilities (1secmail + proxied AXIOS backend)
 * - SQLite DB + migrations/seeding
 *
 * Notes:
 * - Requires "type": "module" in package.json for ESM.
 * - Ensure environment variables are set (see defaults below).
 * - This file intentionally keeps everything in one place (Option A).
 */

import dotenv from "dotenv";
dotenv.config();
import express from "express";
import helmet from "helmet";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { fileURLToPath } from "url";
import { exec as execCb } from "child_process";
import util from "util";


const execAsync = util.promisify(execCb);

// --------- Environment & Constants ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data.db");

// External service envs (provide your own in .env)
const FIVE_SIM_API_KEY = process.env.FIVE_SIM_API_KEY || "";
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";
const VTPASS_API_KEY = process.env.VTPASS_API_KEY || "";
const VTPASS_SECRET_KEY = process.env.VTPASS_SECRET_KEY || "";
const VTPASS_BASE_URL = process.env.VTPASS_BASE_URL || "https://vtpass.com/api"; // adjust if required

const WEBSHARE_API_KEY = process.env.WEBSHARE_API_KEY || "";
const WEBSHARE_PLAN_RESIDENTIAL = process.env.WEBSHARE_PLAN_RESIDENTIAL || "";
const WEBSHARE_PLAN_DATACENTER = process.env.WEBSHARE_PLAN_DATACENTER || "";
const WEBSHARE_PLAN_MOBILE = process.env.WEBSHARE_PLAN_MOBILE || "";

const WG_SERVER_PUBLIC_KEY = process.env.WG_SERVER_PUBLIC_KEY || "";
const WG_SERVER_ENDPOINT = process.env.WG_SERVER_ENDPOINT || "";
const WG_SERVER_PORT = process.env.WG_SERVER_PORT || "51820";
const WG_INTERFACE = process.env.WG_INTERFACE || "wg0";
const WG_NEXT_IP_START = process.env.WG_NEXT_IP_START || "10.13.0.10";

const PROXY_PRICES = {
  residential: 500,
  datacenter: 300,
  mobile: 1000,
};

const WEBSHARE_PLAN_MAP = {
  residential: WEBSHARE_PLAN_RESIDENTIAL,
  datacenter: WEBSHARE_PLAN_DATACENTER,
  mobile: WEBSHARE_PLAN_MOBILE,
};

const VPN_PRICES = {
  basic: 500,
  premium: 1500,
  business: 3500,
};

// Disposable email proxy service used in original file
const DISPOSABLE_BASE = process.env.DISPOSABLE_BASE || "http://185.199.111.153/api/v1/";

// Allowed disposable domains
const VALID_DOMAINS = [
  "1secmail.com",
  "1secmail.org",
  "1secmail.net",
  "wwjmp.com",
  "esiix.com",
  "xojxe.com",
  "vddaz.com",
];

// --------- Fetch helper (use global fetch if available, else node-fetch) ----------
const fetch = globalThis.fetch
  ? globalThis.fetch.bind(globalThis)
  : (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// --------- Express app & security ----------
const app = express();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", "https://api.mail.tm"],
      }
    }
  })
);


app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Explicit CSP header (keeps parity with helmet config)
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' https://www.1secmail.com; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com"
  );
  next();
});

// --------- Database setup ----------
let db;
(async function initDb() {
  try {
    db = await open({
      filename: DB_FILE,
      driver: sqlite3.Database,
    });

    // Users, numbers, orders, wallet, transactions, proxies, vpn_accounts
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        referral_code TEXT,
        referred_by TEXT
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS numbers (
        id TEXT PRIMARY KEY,
        country TEXT,
        number TEXT,
        provider TEXT,
        price_cents INTEGER,
        available INTEGER DEFAULT 1
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        number_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        meta TEXT
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS wallet (
        user_id TEXT PRIMARY KEY,
        balance_cents INTEGER DEFAULT 0
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        network TEXT,
        phone TEXT,
        amount_cents INTEGER,
        status TEXT,
        created_at INTEGER NOT NULL,
        reference TEXT
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS proxies (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        username TEXT,
        password TEXT,
        created_at INTEGER NOT NULL
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS vpn_accounts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        plan TEXT NOT NULL,
        client_address TEXT NOT NULL,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL,
        preshared_key TEXT,
        created_at INTEGER NOT NULL
      );
    `);
    
// ------------------------------
// RECEIVE EMAIL ENDPOINT
// ------------------------------
app.post("/email/receive", async (req, res) => {
  const { to, from, subject, message } = req.body;

  if (!to || !from || !subject || !message) {
    return res.status(400).json({ error: "Missing fields" });
  }

  await db.run(
    "INSERT INTO emails (email, sender, subject, content, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
    [to, from, subject, message]
  );

  res.json({ success: true, message: "Email stored" });
});

    // Seed demo numbers if empty
    const row = await db.get(`SELECT COUNT(*) as c FROM numbers`);
    if (!row || row.c === 0) {
      const demo = [
        ["us-1", "USA", "+1-415-555-0101", "demo-sim", 199, 1],
        ["us-2", "USA", "+1-415-555-0102", "demo-sim", 299, 1],
        ["uk-1", "UK", "+44-20-7946-0001", "demo-sim", 299, 1],
        ["ng-1", "Nigeria", "+234-809-000-0001", "demo-sim", 149, 1],
      ];
      const insert = await db.prepare(
        `INSERT INTO numbers (id,country,number,provider,price_cents,available) VALUES (?,?,?,?,?,?)`
      );
      for (const r of demo) await insert.run(...r);
      try {
        await insert.finalize();
      } catch (e) {}
      console.log("Seeded demo numbers.");
    }

    console.log("SQLite database ready.");
  } catch (err) {
    console.error("DB INIT ERROR:", err);
    process.exit(1);
  }
})();

// Middleware to ensure DB is ready
app.use((req, res, next) => {
  if (!db) return res.status(503).json({ error: "Database initializing" });
  next();
});

// --------- Helpers ----------
function createToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return res.status(401).json({ error: "Missing Authorization" });
  const token = h.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}
import fs from "fs";


// Path to settings JSON file
const settingsFile = path.join(process.cwd(), "adminSettings.json");

// GET admin settings
app.get("/admin/settings", (req, res) => {
  try {
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: "Failed to load settings" });
  }
});

// UPDATE admin settings
app.post("/admin/settings", (req, res) => {
  try {
    fs.writeFileSync(settingsFile, JSON.stringify(req.body, null, 2), "utf8");
    res.json({ message: "Settings updated successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

function safeDomain(domain) {
  if (VALID_DOMAINS.includes(domain)) return domain;
  return "1secmail.com";
}

function ipToInt(ip) {
  return ip.split(".").reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}
function intToIp(i) {
  return [(i >> 24) & 255, (i >> 16) & 255, (i >> 8) & 255, i & 255].join(".");
}

async function allocateNextIp() {
  const base = WG_NEXT_IP_START || "10.13.0.10";
  const used = await db.all(`SELECT client_address FROM vpn_accounts`);
  const usedIps = used.map((r) => r.client_address.split("/")[0]);
  const startInt = ipToInt(base);
  for (let i = 0; i < 200; i++) {
    const cand = intToIp(startInt + i);
    if (!usedIps.includes(cand)) return `${cand}/32`;
  }
  throw new Error("No available internal IP addresses");
}

async function vtpassRequest(endpoint, payload) {
  if (!VTPASS_API_KEY || !VTPASS_SECRET_KEY) throw new Error("VTpass credentials not configured");
  const url = `${VTPASS_BASE_URL}/${endpoint}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "api-key": VTPASS_API_KEY,
      "secret-key": VTPASS_SECRET_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok || data.code !== "000") {
    console.error("VTpass error:", data);
    throw new Error(data.response_description || data.message || "VTpass request failed");
  }
  return data;
}

// --------- Routes (grouped & cleaned) ----------

/* --------------------------
   AUTH: register, login, me
   -------------------------- */
app.post("/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const existing = await db.get(`SELECT id FROM users WHERE email = ?`, email.toLowerCase());
    if (existing) return res.status(409).json({ error: "User already exists" });

    const id = uuidv4();
    const created_at = Date.now();
    const password_hash = await bcrypt.hash(password, 10);
    const referral_code = uuidv4().slice(0, 8);

    // Check referred_by query param
    const referred_by = req.query.ref || null;

    await db.run(
      `INSERT INTO users (id,email,password_hash,created_at,referral_code,referred_by) VALUES (?,?,?,?,?,?)`,
      id,
      email.toLowerCase(),
      password_hash,
      created_at,
      referral_code,
      referred_by
    );

    // Create wallet row
    await db.run(`INSERT INTO wallet (user_id,balance_cents) VALUES (?,?)`, id, 0);

    // Reward referrer (₦50 = 5000 cents) if exists
    if (referred_by) {
      const refUser = await db.get(`SELECT id FROM users WHERE referral_code = ?`, referred_by);
      if (refUser) {
        await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, 5000, refUser.id);
      }
    }

    const token = createToken({ id, email });

    res.status(201).json({
      success: true,
      token,
      user: { id, email, referral_code },
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({ error: "Could not register user" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const row = await db.get(`SELECT id,email,password_hash,created_at FROM users WHERE email = ?`, email.toLowerCase());
    if (!row) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const user = { id: row.id, email: row.email, created_at: row.created_at };
    const token = createToken(user);
    res.json({ token, user });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/auth/me", authMiddleware, async (req, res) => {
  try {
    const userRow = await db.get(`SELECT id,email,created_at FROM users WHERE id = ?`, req.user.id);
    if (!userRow) return res.status(404).json({ error: "User not found" });
    res.json({ user: userRow });
  } catch (err) {
    console.error("ME ERROR:", err);
    res.status(500).json({ error: "Could not fetch user" });
  }
});

/* --------------------------
   WALLET: balance, deposit, paystack init/verify
   -------------------------- */
app.get("/wallet", authMiddleware, async (req, res) => {
  try {
    let wallet = await db.get(`SELECT * FROM wallet WHERE user_id = ?`, req.user.id);
    if (!wallet) {
      // If missing, create with zero balance
      await db.run(`INSERT INTO wallet (user_id,balance_cents) VALUES (?,?)`, req.user.id, 0);
      wallet = await db.get(`SELECT * FROM wallet WHERE user_id = ?`, req.user.id);
    }
    res.json({ balance: wallet.balance_cents / 100 });
  } catch (err) {
    console.error("WALLET GET ERROR:", err);
    res.status(500).json({ error: "Could not fetch wallet" });
  }
});

app.post("/wallet/deposit", authMiddleware, async (req, res) => {
  try {
    let { amount } = req.body || {};
    amount = parseFloat(amount);
    if (!amount || Number.isNaN(amount) || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    const cents = Math.round(amount * 100);
    await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, cents, req.user.id);
    const wallet = await db.get(`SELECT * FROM wallet WHERE user_id = ?`, req.user.id);
    res.json({ balance: wallet.balance_cents / 100 });
  } catch (err) {
    console.error("WALLET DEPOSIT ERROR:", err);
    res.status(500).json({ error: "Could not deposit" });
  }
});

// Paystack: initialize
app.post("/wallet/paystack/init", authMiddleware, async (req, res) => {
  try {
    const { amount } = req.body || {};
    const amt = parseFloat(amount);
    if (!amt || isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });
    if (!PAYSTACK_SECRET_KEY) return res.status(500).json({ error: "Paystack not configured" });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: req.user.email,
        amount: Math.round(amt * 100),
        callback_url: `${process.env.APP_BASE_URL || `http://localhost:${PORT}`}/paystack/return`,
      }),
    });
   let data;
try {
    data = await response.json();
} catch (err) {
    console.log("1secmail fetch error:", err.message);
    return res.json({ success: false, message: "1SecMail returned invalid data" });
}

    if (!data.status) {
      console.error("Paystack init error:", data);
      return res.status(400).json({ error: data.message || "Failed to initialize payment" });
    }
    res.json({ authorization_url: data.data.authorization_url, reference: data.data.reference });
  } catch (err) {
    console.error("Paystack init error:", err);
    res.status(500).json({ error: "Payment initialization failed" });
  }
});

// Paystack: verify (called server-side)
app.post("/wallet/paystack/verify", authMiddleware, async (req, res) => {
  try {
    const reference = req.body.reference || req.query.reference;
    if (!reference) return res.status(400).json({ error: "Missing payment reference" });
    if (!PAYSTACK_SECRET_KEY) return res.status(500).json({ error: "Paystack not configured" });

    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.status || !verifyData.data) return res.status(400).json({ error: "Invalid response from Paystack" });

    if (verifyData.data.status === "success") {
      const amount = verifyData.data.amount / 100;
      // Ensure wallet
      let wallet = await db.get(`SELECT * FROM wallet WHERE user_id = ?`, req.user.id);
      if (!wallet) {
        await db.run(`INSERT INTO wallet (user_id,balance_cents) VALUES (?,?)`, req.user.id, 0);
      }
      await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, Math.round(amount * 100), req.user.id);
      const updated = await db.get(`SELECT balance_cents FROM wallet WHERE user_id = ?`, req.user.id);
      return res.json({ success: true, balance: updated.balance_cents / 100 });
    } else {
      return res.status(400).json({ error: "Payment verification failed" });
    }
  } catch (err) {
    console.error("Paystack verify error:", err);
    res.status(500).json({ error: "Server error verifying payment" });
  }
});

/* --------------------------
   VTpass: airtime & data
   -------------------------- */
app.post("/api/airtime", authMiddleware, async (req, res) => {
  try {
    const { network, phone, amount } = req.body || {};
    if (!network || !phone || !amount) return res.status(400).json({ error: "Missing required fields" });
    const amountNaira = parseFloat(amount);
    if (isNaN(amountNaira) || amountNaira <= 0) return res.status(400).json({ error: "Invalid amount" });

    const wallet = await db.get(`SELECT * FROM wallet WHERE user_id = ?`, req.user.id);
    if (!wallet || wallet.balance_cents < amountNaira * 100) return res.status(402).json({ error: "Insufficient wallet balance" });

    const reference = "AIRTIME-" + uuidv4();
    const now = Date.now();

    // Deduct wallet optimistically
    await db.run(`UPDATE wallet SET balance_cents = balance_cents - ? WHERE user_id = ?`, Math.round(amountNaira * 100), req.user.id);

    const vtpassData = await vtpassRequest("pay", {
      request_id: reference,
      serviceID: network,
      amount: amountNaira,
      phone,
    });

    // Log transaction
    await db.run(
      `INSERT INTO transactions (id,user_id,type,network,phone,amount_cents,status,created_at,reference) VALUES (?,?,?,?,?,?,?,?,?)`,
      uuidv4(),
      req.user.id,
      "airtime",
      network,
      phone,
      Math.round(amountNaira * 100),
      "success",
      now,
      reference
    );

    const updatedWallet = await db.get(`SELECT balance_cents FROM wallet WHERE user_id = ?`, req.user.id);

    res.json({
      success: true,
      message: vtpassData.response_description || "Airtime purchase successful",
      new_balance: updatedWallet.balance_cents / 100,
    });
  } catch (err) {
    console.error("Airtime purchase failed:", err);
    // On error: try to refund (best-effort)
    try {
      const amountNaira = parseFloat(req.body?.amount || 0) || 0;
      if (amountNaira > 0) await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, Math.round(amountNaira * 100), req.user.id);
    } catch (e) {}
    res.status(500).json({ error: err.message || "Failed to process airtime purchase" });
  }
});

app.post("/api/data", authMiddleware, async (req, res) => {
  try {
    const { network, phone, variation_code } = req.body || {};
    if (!network || !phone || !variation_code) return res.status(400).json({ error: "Missing required fields" });

    // Fetch variations from VTpass
    const priceRes = await vtpassRequest("service-variations", { serviceID: network });
    // Defensive: handle both `varations` (typo) and `variations`
    const variations = priceRes.content?.variations || priceRes.content?.varations || [];
    const plan = variations.find((v) => v.variation_code === variation_code);
    if (!plan) return res.status(400).json({ error: "Invalid plan" });

    const amountNaira = parseFloat(plan.variation_amount);
    const wallet = await db.get(`SELECT * FROM wallet WHERE user_id = ?`, req.user.id);
    if (!wallet || wallet.balance_cents < amountNaira * 100) return res.status(402).json({ error: "Insufficient wallet balance" });

    const reference = "DATA-" + uuidv4();
    const now = Date.now();

    // Deduct wallet
    await db.run(`UPDATE wallet SET balance_cents = balance_cents - ? WHERE user_id = ?`, Math.round(amountNaira * 100), req.user.id);

    const vtpassData = await vtpassRequest("pay", {
      request_id: reference,
      serviceID: network,
      variation_code,
      phone,
      amount: amountNaira,
    });

    // Log transaction
    await db.run(
      `INSERT INTO transactions (id,user_id,type,network,phone,amount_cents,status,created_at,reference) VALUES (?,?,?,?,?,?,?,?,?)`,
      uuidv4(),
      req.user.id,
      "data",
      network,
      phone,
      Math.round(amountNaira * 100),
      "success",
      now,
      reference
    );

    const updatedWallet = await db.get(`SELECT balance_cents FROM wallet WHERE user_id = ?`, req.user.id);

    res.json({
      success: true,
      message: vtpassData.response_description || "Data purchase successful",
      new_balance: updatedWallet.balance_cents / 100,
    });
  } catch (err) {
    console.error("Data purchase failed:", err);
    // Try refund
    try {
      const variation_price = 0; // unknown here; we keep conservative behavior
    } catch (e) {}
    res.status(500).json({ error: err.message || "Failed to process data purchase" });
  }
});

/* --------------------------
   5SIM foreign-number purchase
   -------------------------- */
app.post("/api/foreign-number", authMiddleware, async (req, res) => {
  try {
    const { country } = req.body || {};
    if (!country) return res.status(400).json({ error: "Country required" });

    const countryCodeMap = {
      US: "us",
      GB: "gb",
      NG: "ng",
      IN: "in",
      CA: "ca",
    };
    const apiCountry = countryCodeMap[country];
    if (!apiCountry) return res.status(400).json({ error: "Unsupported country" });

    const wallet = await db.get(`SELECT * FROM wallet WHERE user_id = ?`, req.user.id);
    if (!wallet) return res.status(400).json({ error: "Wallet not found" });

    const balance = wallet.balance_cents / 100;
    const price = 2.0; // fixed example price
    if (balance < price) return res.status(402).json({ error: "Insufficient wallet balance" });

    if (!FIVE_SIM_API_KEY) return res.status(500).json({ error: "5SIM API key not configured" });

    // Deduct wallet
    await db.run(`UPDATE wallet SET balance_cents = balance_cents - ? WHERE user_id = ?`, Math.round(price * 100), req.user.id);

    const initRes = await fetch(`https://5sim.net/v1/user/buy/activation/${apiCountry}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${FIVE_SIM_API_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ product: "anyService", country: apiCountry }),
    });

    const initData = await initRes.json();
    if (!initRes.ok) {
      console.error("5SIM error:", initData);
      // refund
      await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, Math.round(price * 100), req.user.id);
      return res.status(500).json({ error: "Number purchase failed: " + (initData.message || initData.error || "unknown") });
    }

    const number = initData.phone || initData.number || null;
    const provider = initData.operator || initData.provider || null;

    const orderId = uuidv4();
    const created_at = Date.now();
    const meta = JSON.stringify({ country: apiCountry, number, provider });

    await db.run(`INSERT INTO orders (id,user_id,number_id,status,created_at,meta) VALUES (?,?,?,?,?,?)`, orderId, req.user.id, orderId, "active", created_at, meta);

    const remaining_balance = ((balance - price) || 0).toFixed(2);

    res.json({ success: true, country: apiCountry, number, provider, remaining_balance });
  } catch (err) {
    console.error("Foreign-number API error:", err);
    res.status(500).json({ error: "Server error purchasing number" });
  }
});

/* --------------------------
   PROXY: Webshare purchase
   -------------------------- */
app.post("/proxy/buy", authMiddleware, async (req, res) => {
  try {
    const { type } = req.body || {};
    if (!type || !PROXY_PRICES[type]) return res.status(400).json({ error: "Invalid proxy type" });

    const amountNaira = PROXY_PRICES[type];

    // Wallet check
    const wallet = await db.get(`SELECT balance_cents FROM wallet WHERE user_id = ?`, req.user.id);
    if (!wallet) return res.status(400).json({ error: "Wallet not found" });
    if (wallet.balance_cents < amountNaira * 100) return res.status(402).json({ error: "Insufficient wallet balance" });

    const planId = WEBSHARE_PLAN_MAP[type];
    if (!planId || !WEBSHARE_API_KEY) return res.status(500).json({ error: "Server misconfiguration: Webshare not configured" });

    // Deduct wallet
    await db.run(`UPDATE wallet SET balance_cents = balance_cents - ? WHERE user_id = ?`, Math.round(amountNaira * 100), req.user.id);

    // Get config token
    const configRes = await fetch(`https://proxy.webshare.io/api/v3/proxy/config?plan_id=${encodeURIComponent(planId)}`, {
      method: "GET",
      headers: { Authorization: `Token ${WEBSHARE_API_KEY}` },
    });

    if (!configRes.ok) {
      // refund
      await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, Math.round(amountNaira * 100), req.user.id);
      const eText = await configRes.text().catch(() => null);
      console.error("Webshare config error:", configRes.status, eText);
      return res.status(502).json({ error: "Failed to contact Webshare (config)" });
    }

    const configJson = await configRes.json();
    const token = configJson.proxy_list_download_token || configJson.token || null;
    if (!token) {
      // refund
      await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, Math.round(amountNaira * 100), req.user.id);
      console.error("Webshare config missing token:", configJson);
      return res.status(502).json({ error: "Failed to obtain proxy list token from Webshare" });
    }

    const downloadUrl = `https://proxy.webshare.io/api/v2/proxy/list/download/${encodeURIComponent(token)}/-/any/username/direct/`;
    const downloadRes = await fetch(downloadUrl);
    if (!downloadRes.ok) {
      // refund
      await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, Math.round(amountNaira * 100), req.user.id);
      const txt = await downloadRes.text().catch(() => null);
      console.error("Webshare download error:", downloadRes.status, txt);
      return res.status(502).json({ error: "Failed to download proxies from Webshare" });
    }

    const listText = await downloadRes.text();
    const lines = listText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) {
      // refund
      await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, Math.round(amountNaira * 100), req.user.id);
      console.error("Webshare returned empty proxy list");
      return res.status(502).json({ error: "No proxies available from provider" });
    }

    const first = lines[0];
    const parts = first.split(":");
    let ip, port, username, password;
    if (parts.length >= 4) {
      [ip, port, username, password] = parts;
    } else if (parts.length === 2) {
      [ip, port] = parts;
      username = null;
      password = null;
    } else {
      ip = first;
      port = 0;
      username = null;
      password = null;
    }

    const proxyId = uuidv4();
    const now = Date.now();
    await db.run(
      `INSERT INTO proxies (id,user_id,type,ip,port,username,password,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      proxyId,
      req.user.id,
      type,
      ip,
      parseInt(port, 10) || 0,
      username,
      password,
      now
    );

    const updatedWallet = await db.get(`SELECT balance_cents FROM wallet WHERE user_id = ?`, req.user.id);

    return res.json({
      success: true,
      message: "Proxy purchased successfully",
      proxy: { id: proxyId, type, ip, port: parseInt(port, 10) || 0, username, password },
      new_balance: updatedWallet.balance_cents / 100,
    });
  } catch (err) {
    console.error("proxy buy error:", err);
    res.status(500).json({ error: "Server error purchasing proxy" });
  }
});

/* --------------------------
   VPN: WireGuard account generation
   -------------------------- */
app.post("/vpn/buy", authMiddleware, async (req, res) => {
  let price;
  try {
    const { plan } = req.body || {};
    if (!plan || !VPN_PRICES[plan]) return res.status(400).json({ error: "Invalid plan" });

    price = VPN_PRICES[plan];

    const wallet = await db.get(`SELECT balance_cents FROM wallet WHERE user_id = ?`, req.user.id);
    if (!wallet) return res.status(400).json({ error: "Wallet not found" });
    if (wallet.balance_cents < price * 100) return res.status(402).json({ error: "Insufficient wallet balance" });

    // Deduct wallet
    await db.run(`UPDATE wallet SET balance_cents = balance_cents - ? WHERE user_id = ?`, Math.round(price * 100), req.user.id);

    // Generate keys (requires `wg` commands on the host)
    // private key
    const { stdout: privStdout } = await execAsync(`wg genkey`);
    const privateKey = privStdout.toString().trim();
    // public key
    const { stdout: pubStdout } = await execAsync(`echo "${privateKey}" | wg pubkey`);
    const publicKey = pubStdout.toString().trim();

    // optional preshared key
    let presharedKey = null;
    try {
      const { stdout: pskOut } = await execAsync(`wg genpsk`);
      presharedKey = pskOut.toString().trim();
    } catch (e) {
      presharedKey = null;
    }

    const clientAddress = await allocateNextIp();
    const iface = WG_INTERFACE;
    const allowed = clientAddress.split("/")[0] + "/32";

    // Add peer to running interface (note: process substitution may fail on some shells)
    try {
      if (presharedKey) {
        // fallback to echo into temp file if shell doesn't support <()
        await execAsync(`sudo wg set ${iface} peer ${publicKey} preshared-key <(echo ${presharedKey}) allowed-ips ${allowed}`);
      } else {
        await execAsync(`sudo wg set ${iface} peer ${publicKey} allowed-ips ${allowed}`);
      }
    } catch (err) {
      // If process substitution fails, try fallback via temporary file
      try {
        if (presharedKey) {
          await execAsync(`echo "${presharedKey}" > /tmp/psk-${publicKey} && sudo wg set ${iface} peer ${publicKey} preshared-key /tmp/psk-${publicKey} allowed-ips ${allowed} && rm -f /tmp/psk-${publicKey}`);
        } else {
          await execAsync(`sudo wg set ${iface} peer ${publicKey} allowed-ips ${allowed}`);
        }
      } catch (err2) {
        console.error("wg set error:", err2);
        throw new Error("Failed to register peer with WireGuard interface");
      }
    }

    // Persist in DB
    const id = uuidv4();
    const now = Date.now();
    await db.run(
      `INSERT INTO vpn_accounts (id,user_id,plan,client_address,public_key,private_key,preshared_key,created_at) VALUES (?,?,?,?,?,?,?,?)`,
      id,
      req.user.id,
      plan,
      clientAddress,
      publicKey,
      privateKey,
      presharedKey,
      now
    );

    const updatedWallet = await db.get(`SELECT balance_cents FROM wallet WHERE user_id = ?`, req.user.id);

    // Build client config
    const clientIpNoCidr = clientAddress.split("/")[0];
    const clientConf = [
      "[Interface]",
      `PrivateKey = ${privateKey}`,
      `Address = ${clientAddress}`,
      `DNS = 1.1.1.1`,
      "",
      "[Peer]",
      `PublicKey = ${WG_SERVER_PUBLIC_KEY}`,
      ...(presharedKey ? [`PresharedKey = ${presharedKey}`] : []),
      `Endpoint = ${WG_SERVER_ENDPOINT}:${WG_SERVER_PORT}`,
      `AllowedIPs = 0.0.0.0/0, ::/0`,
      `PersistentKeepalive = 25`,
    ]
      .filter(Boolean)
      .join("\n");

    return res.json({
      success: true,
      message: "VPN account created",
      client_config: clientConf,
      client_address: clientIpNoCidr,
      new_balance: updatedWallet.balance_cents / 100,
    });
  } catch (err) {
    console.error("vpn buy error:", err);
    // Refund if deducted
    try {
      if (req.user && req.user.id && typeof price !== "undefined") {
        await db.run(`UPDATE wallet SET balance_cents = balance_cents + ? WHERE user_id = ?`, Math.round((price || 0) * 100), req.user.id);
      }
    } catch (e) {}
    return res.status(500).json({ error: "Server error creating VPN account" });
  }
});

/* --------------------------
   NUMBERS & ORDERS
   -------------------------- */
app.get("/numbers", async (req, res) => {
  try {
    const country = req.query.country;
    let rows;
    if (country) {
      rows = await db.all(`SELECT id,country,number,provider,price_cents,available FROM numbers WHERE country = ?`, country);
    } else {
      rows = await db.all(`SELECT id,country,number,provider,price_cents,available FROM numbers`);
    }
    res.json({ numbers: rows });
  } catch (err) {
    console.error("NUMBERS ERROR:", err);
    res.status(500).json({ error: "Could not fetch numbers" });
  }
});

app.post("/orders", authMiddleware, async (req, res) => {
  try {
    const { number_id } = req.body || {};
    if (!number_id) return res.status(400).json({ error: "number_id required" });

    const num = await db.get(`SELECT id,available,price_cents FROM numbers WHERE id = ?`, number_id);
    if (!num) return res.status(404).json({ error: "Number not found" });
    if (!num.available) return res.status(409).json({ error: "Number not available" });

    const orderId = uuidv4();
    const now = Date.now();
    const meta = JSON.stringify({ price_cents: num.price_cents, demo: true });

    await db.run(
      `INSERT INTO orders (id,user_id,number_id,status,created_at,meta) VALUES (?,?,?,?,?,?)`,
      orderId,
      req.user.id,
      number_id,
      "active",
      now,
      meta
    );
    await db.run(`UPDATE numbers SET available = 0 WHERE id = ?`, number_id);

    const order = await db.get(`SELECT * FROM orders WHERE id = ?`, orderId);
    res.status(201).json({ order });
  } catch (err) {
    console.error("order error", err);
    res.status(500).json({ error: "Could not create order" });
  }
});

app.get("/orders", authMiddleware, async (req, res) => {
  try {
    const rows = await db.all(
      `SELECT o.id,o.number_id,o.status,o.created_at,o.meta,n.number,n.country
       FROM orders o
       LEFT JOIN numbers n ON n.id = o.number_id
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`,
      req.user.id
    );
    res.json({ orders: rows });
  } catch (err) {
    console.error("orders fetch error", err);
    res.status(500).json({ error: "Could not fetch orders" });
  }
});

/* --------------------------
   Referral info
   -------------------------- */
app.get("/referral/info", authMiddleware, async (req, res) => {
  try {
    const user = await db.get(`SELECT referral_code FROM users WHERE id = ?`, req.user.id);
    const link = `${process.env.APP_BASE_URL || `http://localhost:${PORT}`}/auth/register?ref=${user.referral_code}`;
    res.json({ referral_code: user.referral_code, referral_link: link });
  } catch (err) {
    console.error("REFERRAL ERROR:", err);
    res.status(500).json({ error: "Could not fetch referral info" });
  }
});

/* --------------------------
   Disposable email (1secmail) helpers
   -------------------------- */
app.get("/email/new", (req, res) => {
  const domains = ["1secmail.com", "1secmail.org", "1secmail.net"];
  const login = Math.random().toString(36).substring(2, 12);
  const domain = domains[Math.floor(Math.random() * domains.length)];
  res.json({ email: `${login}@${domain}`, login, domain });
});

import axios from "axios";

const safeUserAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "Mozilla/5.0 (X11; Linux x86_64)",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)"
];

// Random helper
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
// MAIL.TM — NEW DISPOSABLE EMAIL SERVICE (RELIABLE)
const MAILTM = "https://api.mail.tm";

app.get("/email/new", async (req, res) => {
  try {
    const domainRes = await axios.get(`${MAILTM}/domains`);
    const domain = domainRes.data["hydra:member"][0].domain;

    const username = Math.random().toString(36).substring(2, 12);
    const password = Math.random().toString(36).substring(2, 14);

    const accountRes = await axios.post(`${MAILTM}/accounts`, {
      address: `${username}@${domain}`,
      password
    });

    res.json({
      email: accountRes.data.address,
      id: accountRes.data.id,
      password,
    });
  } catch (err) {
    console.error("mail.tm new error:", err.message);
    res.status(500).json({ error: "Failed to create email" });
  }
});

// Get messages
app.get("/email/messages", async (req, res) => {
  const { id, password } = req.query;

  try {
    const tokenRes = await axios.post(`${MAILTM}/token`, {
      address: id,
      password
    });

    const auth = tokenRes.data.token;

    const inbox = await axios.get(`${MAILTM}/messages`, {
      headers: { Authorization: `Bearer ${auth}` }
    });

    res.json(inbox.data["hydra:member"]);
  } catch (err) {
    console.error("mail.tm messages error:", err.message);
    res.status(500).json({ error: "Failed to fetch inbox" });
  }
});

// Read message
app.get("/email/read", async (req, res) => {
  const { msg, auth } = req.query;

  try {
    const full = await axios.get(`${MAILTM}/messages/${msg}`, {
      headers: { Authorization: `Bearer ${auth}` }
    });

    res.json(full.data);
  } catch {
    res.status(500).json({ error: "Failed to read message" });
  }
});


/* --------------------------
   Admin: create numbers
   -------------------------- */
app.post("/admin/numbers", async (req, res) => {
  try {
    const { country, number, provider, price_cents } = req.body || {};
    if (!number) return res.status(400).json({ error: "number required" });

    const id = uuidv4();
    await db.run(
      `INSERT INTO numbers (id,country,number,provider,price_cents,available) VALUES (?,?,?,?,?,1)`,
      id,
      country || "unknown",
      number,
      provider || "demo",
      price_cents || 100
    );
    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error("ADMIN NUMBERS ERROR:", err);
    res.status(500).json({ error: "Could not create number" });
  }
});

/* --------------------------
   Misc & root
   -------------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "uchenzylogs_replica.html"), (err) => {
    if (err) {
      res.status(500).send("Index not found");
    }
  });
});

app.get("/paystack/return", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "paystack-return.html"), (err) => {
    if (err) res.status(404).send("Return page not found");
  });
});

/* --------------------------
   Global error handler (fallback)
   -------------------------- */
app.use((err, req, res, next) => {
  console.error("UNHANDLED ERROR:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* --------------------------
   Start server
   -------------------------- */
app.listen(PORT, () => {
  console.log(`✅ UchenzyLogs demo API running on http://localhost:${PORT}`);
  console.log(`📁 Using database: ${DB_FILE}`);
});
