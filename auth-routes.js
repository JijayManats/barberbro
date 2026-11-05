
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const QRCode = require("qrcode");
const nodemailer = require("nodemailer");
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

function getCustomerDisplayName(customer) {
  const fullName = String(customer?.full_name || "").trim();
  if (fullName) return fullName;

  const emailName = String(customer?.email || "").split("@")[0]?.trim();
  if (emailName) return emailName;

  return "Member";
}

async function sendMemberCardEmail(customer, activationCode) {
  if (!customer?.email) {
    return { sent: false, reason: "missing-email" };
  }

  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT || 587);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const from = process.env.EMAIL_FROM || user || "BarberBro <noreply@barberbro.local>";

  const displayName = getCustomerDisplayName(customer);

  if (!host || !user || !pass) {
    const preview = `Customer: ${displayName}
Member ID: ${customer.member_code}
Activation code: ${activationCode}
QR payload: ${buildCustomerQrPayload(customer)}`;
    console.log("[member-card-demo]", preview);
    return { sent: false, reason: "smtp-missing", preview };
  }

  const qrDataUrl = await QRCode.toDataURL(buildCustomerQrPayload(customer), {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
    color: { dark: "#171a2c", light: "#fffaf4" },
  });

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const html = `
    <div style="font-family: Arial, sans-serif; background: #f5efe7; padding: 24px; color: #171a2c;">
      <div style="max-width: 620px; margin: 0 auto; background: linear-gradient(135deg, #171a2c 0%, #241d38 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 20px 40px rgba(23,26,44,0.18);">
        <div style="padding: 32px 28px 18px; color: #f3ebdf;">
          <div style="font-size: 12px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.7;">BarberBro Loyalty</div>
          <h1 style="margin: 10px 0 0; font-size: 32px;">Welcome, ${getCustomerDisplayName(customer)}</h1>
        </div>
        <div style="padding: 0 28px 28px; background: #fffaf4; color: #171a2c;">
          <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap; padding-top: 28px;">
            <div style="background: linear-gradient(135deg, #f3cf6b 0%, #dba95a 100%); border-radius: 18px; padding: 18px; text-align: center; min-width: 220px;">
              <img src="${qrDataUrl}" alt="BarberBro member QR code" style="display: block; width: 180px; height: 180px; margin: 0 auto; background: white; border-radius: 16px; padding: 8px;" />
            </div>
            <div>
              <div style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #5a5447;">Member ID</div>
              <div style="font-size: 30px; font-weight: 800; margin-top: 8px; letter-spacing: 1px;">${customer.member_code}</div>
              <div style="margin-top: 14px; padding: 12px 14px; background: #efe8d8; border-radius: 12px;">
                <div style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #5a5447;">Activation code</div>
                <div style="font-size: 24px; font-weight: 800; margin-top: 7px;">${activationCode}</div>
              </div>
            </div>
          </div>
          <div style="margin-top: 20px; font-size: 14px; line-height: 1.7; color: #4b4b4b;">
            Use your member ID and activation code on the BarberBro customer app to finish setting up your account. Keep this email handy ? your QR card is also your quick check-in ID.
          </div>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from,
    to: customer.email,
    subject: "Your BarberBro member card and activation code",
    html,
  });

  return { sent: true };
}

// Admin login using credentials stored in backend .env
router.post("/admin/login", async (req, res) => {
  try {
    if (!process.env.JWT_SECRET ||
        !process.env.ADMIN_EMAIL ||
        !process.env.ADMIN_PASSWORD_HASH) {
      return res.status(500).json({
        error: "Admin authentication is not configured",
      });
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

    const emailMatches =
      email === process.env.ADMIN_EMAIL.trim().toLowerCase();

    const passwordMatches = await bcrypt.compare(
      password,
      process.env.ADMIN_PASSWORD_HASH
    );

    if (!emailMatches || !passwordMatches) {
      return res.status(401).json({
        error: "Invalid admin email or password",
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

    const match = qrPayload.match(/barberbro:\/\/member\/(\d+)\/(.+)$/i);
    const customerId = match ? Number(match[1]) : null;
    const memberCode = match ? decodeURIComponent(match[2]) : null;

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

module.exports = router;
