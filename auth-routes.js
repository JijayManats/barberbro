
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("./db");

const router = express.Router();

function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function generateActivationCode() {
  return `BB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function buildCustomerQrPayload(customer) {
  const customerId = Number(customer?.id ?? 0);
  const memberCode = String(customer?.member_code || "").trim();

  if (!customerId || !memberCode) {
    return "";
  }

  return `barberbro://member/${customerId}/${encodeURIComponent(memberCode)}`;
}

function parseQrLookupPayload(rawPayload) {
  const trimmed = String(rawPayload || "").trim();

  if (!trimmed) {
    return { id: null, memberCode: "" };
  }

  if (trimmed.startsWith("barberbro://member/")) {
    const match = trimmed.match(/^barberbro:\/\/member\/(?:(\d+)\/)?(.+)$/i);
    if (!match) {
      return { id: null, memberCode: "" };
    }

    const parsedId = Number(match[1]);
    return {
      id: Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null,
      memberCode: decodeURIComponent(match[2] || "").trim(),
    };
  }

  const queryMatch = trimmed.match(/[?&](?:member_code|memberCode)=([^&]+)/i);
  if (queryMatch) {
    return { id: null, memberCode: decodeURIComponent(queryMatch[1]).trim() };
  }

  if (/^\d+$/.test(trimmed)) {
    return { id: Number(trimmed), memberCode: "" };
  }

  return { id: null, memberCode: trimmed.replace(/^member\//i, "").trim() };
}

// Admin login using credentials stored in the environment.
router.post("/admin/login", async (req, res) => {
  try {
    const configuredAdminUsername = (
      process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL || ""
    ).trim().toLowerCase();

    if (!process.env.JWT_SECRET ||
        !configuredAdminUsername ||
        !process.env.ADMIN_PASSWORD_HASH) {
      return res.status(500).json({
        error: "Admin authentication is not configured",
      });
    }

    const suppliedUsername =
      typeof req.body.username === "string"
        ? req.body.username
        : typeof req.body.email === "string"
          ? req.body.email
          : "";
    const username = suppliedUsername.trim().toLowerCase();

    const password =
      typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!username || !password) {
      return res.status(400).json({
        error: "Username and password are required",
      });
    }

    const usernameMatches = username === configuredAdminUsername;

    const passwordMatches = await bcrypt.compare(
      password,
      process.env.ADMIN_PASSWORD_HASH
    );

    if (!usernameMatches || !passwordMatches) {
      return res.status(401).json({
        error: "Invalid admin username or password",
      });
    }

    const token = jwt.sign(
      { role: "admin" },
      process.env.JWT_SECRET,
      {
        algorithm: "HS256",
        expiresIn: "2h",
      }
    );

    return res.json({
      message: "Admin login successful",
      token,
      role: "admin",
    });
  } catch (error) {
    console.error("Admin login failed:", error.message);
    return res.status(500).json({
      error: "Unable to log in right now",
    });
  }
});

router.post("/activate", async (req, res) => {
  try {
    const memberCode =
      typeof req.body.member_code === "string"
        ? req.body.member_code.trim().toUpperCase()
        : typeof req.body.memberCode === "string"
          ? req.body.memberCode.trim().toUpperCase()
          : "";

    const activationCode =
      typeof req.body.activation_code === "string"
        ? req.body.activation_code.trim().toUpperCase()
        : typeof req.body.activationCode === "string"
          ? req.body.activationCode.trim().toUpperCase()
          : "";

    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!memberCode || !activationCode || !email || !password) {
      return res.status(400).json({
        error: "Member code, activation code, email, and password are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long",
      });
    }

    const customerResult = await pool.query(
      `SELECT id, member_code, full_name, email, password_hash
       FROM customers
       WHERE UPPER(member_code) = $1
         AND LOWER(COALESCE(email, '')) = $2
       LIMIT 1`,
      [memberCode, email]
    );

    const customer = customerResult.rows[0];

    if (!customer) {
      return res.status(404).json({
        error: "No matching customer account was found.",
      });
    }

    if (customer.password_hash) {
      return res.status(409).json({
        error: "This account is already activated.",
      });
    }

    const codeResult = await pool.query(
      `SELECT id, code, expires_at, used_at
       FROM customer_activation_codes
       WHERE customer_id = $1
         AND code = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [customer.id, activationCode]
    );

    const activeCode = codeResult.rows[0];

    if (!activeCode) {
      return res.status(404).json({
        error: "This activation code is not valid for this customer.",
      });
    }

    if (activeCode.used_at) {
      return res.status(409).json({
        error: "This activation code has already been used.",
      });
    }

    if (new Date(activeCode.expires_at).getTime() < Date.now()) {
      return res.status(410).json({
        error: "This activation code has expired. Ask your shop to generate a new one.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.query("BEGIN");

    try {
      await pool.query(
        `UPDATE customers
         SET password_hash = $1
         WHERE id = $2`,
        [passwordHash, customer.id]
      );

      await pool.query(
        `UPDATE customer_activation_codes
         SET used_at = NOW()
         WHERE id = $1`,
        [activeCode.id]
      );

      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }

    return res.json({
      message: "Account activated successfully. You can sign in now.",
    });
  } catch (error) {
    console.error("Customer activation failed:", error.message);
    return res.status(500).json({
      error: "Unable to activate the account right now",
    });
  }
});

// Customer login using email and password
router.post("/login", async (req, res) => {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: "Authentication is not configured" });
    }

    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body.password === "string"
        ? req.body.password
        : "";

    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required",
      });
    }

    const result = await pool.query(
      `SELECT id, email, password_hash
       FROM customers
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    const customer = result.rows[0];

    if (
      !customer ||
      !customer.password_hash ||
      !(await bcrypt.compare(password, customer.password_hash))
    ) {
      return res.status(401).json({
        error: "Invalid email or password, or account not activated",
      });
    }

    const token = jwt.sign(
      { customerId: customer.id, role: "customer" },
      process.env.JWT_SECRET,
      { algorithm: "HS256", expiresIn: "2h" }
    );

    res.json({
      message: "Login successful",
      token,
    });
  } catch (error) {
    console.error("Customer login failed:", error.message);
    res.status(500).json({ error: "Unable to log in right now" });
  }
});

router.post("/lookup-qr", async (req, res) => {
  try {
    const qrPayload = typeof req.body?.qr_payload === "string" ? req.body.qr_payload.trim() : "";

    if (!qrPayload) {
      return res.status(400).json({ error: "QR payload is required." });
    }

    const parsedQr = parseQrLookupPayload(qrPayload);
    const customerId = parsedQr.id;
    const memberCode = parsedQr.memberCode || null;

    const result = await pool.query(
      `SELECT id, member_code, full_name, phone, email,
              total_visits, loyalty_stamps, total_spent,
              CASE WHEN password_hash IS NOT NULL THEN true ELSE false END AS is_activated
       FROM customers
       WHERE ($1::int IS NOT NULL AND id = $1)
          OR UPPER(member_code) = UPPER($2)
       LIMIT 1`,
      [customerId, memberCode]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Customer not found for this QR code." });
    }

    const customer = result.rows[0];
    customer.qr_payload = buildCustomerQrPayload(customer);
    res.json(customer);
  } catch (error) {
    console.error("Customer QR lookup failed:", error.message);
    res.status(500).json({ error: "Unable to find customer by QR" });
  }
});

// Return only the authenticated customer's own information
router.get("/me", authenticateToken, async (req, res) => {
  try {
    if (req.auth.role !== "customer") {
      return res.status(403).json({ error: "Customer access only" });
    }

    const result = await pool.query(
      `SELECT id, member_code, full_name, phone, email,
              total_visits, loyalty_stamps, total_spent, created_at
       FROM customers
       WHERE id = $1`,
      [req.auth.customerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Customer profile failed:", error.message);
    res.status(500).json({ error: "Unable to load customer profile" });
  }
});

 // Return only the authenticated customer's visit history
router.get("/visits", authenticateToken, async (req, res) => {
  try {
    if (req.auth.role !== "customer") {
      return res.status(403).json({
        error: "Customer access only",
      });
    }

    const result = await pool.query(
      `SELECT id, service, barber_name, amount, visited_at
       FROM visits
       WHERE customer_id = $1
       ORDER BY visited_at DESC
       LIMIT 50`,
      [req.auth.customerId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(
      "Customer visit history failed:",
      error.message
    );

    res.status(500).json({
      error: "Unable to load visit history",
    });
  }
});

router.get("/rewards/history", authenticateToken, async (req, res) => {
  if (req.auth.role !== "customer") {
    return res.status(403).json({ error: "Customer access only" });
  }

  try {
    const result = await pool.query(
      `SELECT id, reward_name, stamps_required,
              COALESCE(redeemed_at, created_at) AS redeemed_at
       FROM rewards
       WHERE customer_id = $1 AND status = 'redeemed'
       ORDER BY COALESCE(redeemed_at, created_at) DESC, id DESC
       LIMIT 50`,
      [req.auth.customerId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Customer reward history failed:", error.message);
    res.status(500).json({ error: "Unable to load reward history" });
  }
});

router.post("/rewards/redeem", authenticateToken, async (req, res) => {
  if (req.auth.role !== "customer") {
    return res.status(403).json({ error: "Customer access only" });
  }

  const rewardId = Number(req.body?.reward_id);
  if (!Number.isInteger(rewardId) || rewardId <= 0) {
    return res.status(400).json({ error: "Invalid reward" });
  }

  let client;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;

    const customerResult = await client.query(
      `SELECT id, loyalty_stamps
       FROM customers
       WHERE id = $1
       FOR UPDATE`,
      [req.auth.customerId]
    );

    if (customerResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({ error: "Customer not found" });
    }

    const rewardResult = await client.query(
      `SELECT id, name, required_stamps
       FROM reward_templates
       WHERE id = $1 AND is_active = TRUE
       FOR SHARE`,
      [rewardId]
    );

    if (rewardResult.rowCount === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({ error: "This reward is no longer available" });
    }

    const customer = customerResult.rows[0];
    const reward = rewardResult.rows[0];
    if (customer.loyalty_stamps < reward.required_stamps) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(400).json({
        error: `You need ${reward.required_stamps} stamps to redeem this reward`,
      });
    }

    const remainingStamps = customer.loyalty_stamps - reward.required_stamps;
    const redemptionResult = await client.query(
      `INSERT INTO rewards (customer_id, reward_name, stamps_required, status, redeemed_at)
       VALUES ($1, $2, $3, 'redeemed', NOW())
       RETURNING id, redeemed_at`,
      [customer.id, reward.name, reward.required_stamps]
    );

    await client.query(
      `UPDATE customers
       SET loyalty_stamps = $2
       WHERE id = $1`,
      [customer.id, remainingStamps]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      message: "Reward redeemed successfully",
      reward: {
        id: reward.id,
        name: reward.name,
        stamps_required: reward.required_stamps,
        remaining_stamps: remainingStamps,
      },
      redemption: {
        id: redemptionResult.rows[0].id,
        reward_name: reward.name,
        stamps_required: reward.required_stamps,
        redeemed_at: redemptionResult.rows[0].redeemed_at,
      },
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Customer reward rollback failed:", rollbackError.message);
      }
    }
    console.error("Customer reward redemption failed:", error.message);
    return res.status(500).json({ error: "Unable to redeem this reward right now" });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
