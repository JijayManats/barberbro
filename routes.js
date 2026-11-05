
const express = require("express");
const crypto = require("crypto");
const pool = require("./db");

const {
  authenticateToken,
  requireAdmin,
} = require("./auth-middleware");

const router = express.Router();

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

async function sendMemberCardEmail(customer, activationCode) {
  if (!customer?.email) {
    return { sent: false, reason: "missing-email" };
  }

  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT || 587);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const from = process.env.EMAIL_FROM || user || "BarberBro <noreply@barberbro.local>";

  if (!host || !user || !pass) {
    const qrPayload = buildCustomerQrPayload(customer);
    const preview = `Customer: ${customer.full_name}
Member ID: ${customer.member_code}
Activation code: ${activationCode}
QR payload: ${qrPayload}`;
    console.log("[member-card-demo]", preview);
    return { sent: false, reason: "smtp-missing", preview };
  }

  const nodemailer = require("nodemailer");
  const QRCode = require("qrcode");
  const qrPayload = buildCustomerQrPayload(customer);
  const qrImage = await QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 220,
    color: {
      dark: "#171a2c",
      light: "#fffaf4",
    },
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
          <h1 style="margin: 10px 0 0; font-size: 32px;">Welcome, ${customer.full_name}</h1>
        </div>
        <div style="padding: 0 28px 28px; background: #fffaf4; color: #171a2c;">
          <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap; padding-top: 28px;">
            <div style="background: linear-gradient(135deg, #f3cf6b 0%, #dba95a 100%); border-radius: 18px; padding: 18px; text-align: center; min-width: 220px;">
              <img src="${qrImage}" alt="BarberBro member QR code" style="display: block; width: 180px; height: 180px; margin: 0 auto; background: white; border-radius: 16px; padding: 8px;" />
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

// All routes in this file require an authenticated admin.
router.use(authenticateToken, requireAdmin);

// Get dashboard statistics
router.get("/dashboard", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM customers) AS total_customers,
        (SELECT COUNT(*) FROM visits
          WHERE visited_at::date = CURRENT_DATE) AS visits_today,
        (SELECT COALESCE(SUM(amount), 0) FROM visits)
          AS total_revenue
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load dashboard statistics" });
  }
});

// Get all customers, with optional search
router.get("/customers", async (req, res) => {
  try {
    const search = `%${req.query.search || ""}%`;

    const result = await pool.query(
      `SELECT c.*,
              CASE WHEN c.password_hash IS NOT NULL THEN true ELSE false END AS is_activated
       FROM customers c
       WHERE c.full_name ILIKE $1
          OR COALESCE(c.phone, '') ILIKE $1
          OR c.member_code ILIKE $1
       ORDER BY c.created_at DESC`,
      [search]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load customers" });
  }
});

// Add a customer
router.post("/customers", async (req, res) => {
  try {
    const { full_name, phone, email } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ error: "Customer name is required" });
    }

    const member_code = `BB-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const result = await pool.query(
      `INSERT INTO customers (member_code, full_name, phone, email)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [member_code, full_name.trim(), phone || null, email || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Phone number or member code already exists" });
    }

    console.error(error);
    res.status(500).json({ error: "Failed to create customer" });
  }
});

router.post("/customers/:id/activation-code", async (req, res) => {
  try {
    const customerId = Number(req.params.id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: "Invalid customer ID" });
    }

    const customerResult = await pool.query(
      `SELECT id, member_code, email, password_hash
       FROM customers
       WHERE id = $1`,
      [customerId]
    );

    if (customerResult.rowCount === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const customer = customerResult.rows[0];

    if (customer.password_hash) {
      return res.status(409).json({
        error: "This customer already has an activated account.",
      });
    }

    const activationCode = generateActivationCode();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const result = await pool.query(
      `INSERT INTO customer_activation_codes (customer_id, code, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, code, expires_at`,
      [customer.id, activationCode, expiresAt]
    );

    const createdActivationCode = result.rows[0].code;

    try {
      if (customer.email) {
        await sendMemberCardEmail(customer, createdActivationCode);
      }
    } catch (emailError) {
      console.warn("Customer card email failed:", emailError.message);
    }

    return res.status(201).json({
      message: "Activation code created successfully",
      code: createdActivationCode,
      expires_at: result.rows[0].expires_at,
      member_code: customer.member_code,
      email: customer.email,
      email_sent: Boolean(customer.email),
    });
  } catch (error) {
    console.error("Activation code generation failed:", error.message);
    return res.status(500).json({ error: "Failed to generate activation code" });
  }
});

router.post("/customers/lookup", async (req, res) => {
  try {
    const qrPayload = typeof req.body?.qr_payload === "string"
      ? req.body.qr_payload.trim()
      : "";

    const memberCode = typeof req.body?.member_code === "string"
      ? req.body.member_code.trim().toUpperCase()
      : "";

    const patternMatch = qrPayload.match(/barberbro:\/\/member\/(\d+)\/(.+)$/i);
    const lookupId = patternMatch ? Number(patternMatch[1]) : null;
    const lookupMemberCode = patternMatch ? decodeURIComponent(patternMatch[2]) : memberCode;

    if (!lookupId && !lookupMemberCode) {
      return res.status(400).json({ error: "A member QR payload or member code is required." });
    }

    const result = await pool.query(
      `SELECT id, member_code, full_name, phone, email,
              total_visits, loyalty_stamps, total_spent,
              CASE WHEN password_hash IS NOT NULL THEN true ELSE false END AS is_activated
       FROM customers
       WHERE ($1::int IS NOT NULL AND id = $1)
          OR UPPER(member_code) = UPPER($2)
       LIMIT 1`,
      [lookupId, lookupMemberCode]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Customer not found for this QR code." });
    }

    const customer = result.rows[0];
    customer.qr_payload = buildCustomerQrPayload(customer);

    res.json(customer);
  } catch (error) {
    console.error("Customer QR lookup failed:", error.message);
    res.status(500).json({ error: "Failed to find customer by QR" });
  }
});

// Get visit history
router.get("/visits", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT v.*, c.full_name, c.member_code
      FROM visits v
      JOIN customers c ON c.id = v.customer_id
      ORDER BY v.visited_at DESC
      LIMIT 200
    `);

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load visit history" });
  }
});

// Record a haircut visit and award one loyalty stamp
router.post("/visits", async (req, res) => {
  const client = await pool.connect();

  try {
    const { customer_id, service, barber_name, amount } = req.body;
    const price = Number(amount);

    if (!Number.isInteger(Number(customer_id)) ||
        Number(customer_id) <= 0 ||
        !service ||
        !Number.isFinite(price) ||
        price < 0) {
      return res.status(400).json({
        error: "Valid customer, service, and non-negative amount are required"
      });
    }

    await client.query("BEGIN");

    const customer = await client.query(
      "SELECT id FROM customers WHERE id = $1 FOR UPDATE",
      [Number(customer_id)]
    );

    if (customer.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Customer not found" });
    }

    const visit = await client.query(
      `INSERT INTO visits (customer_id, service, barber_name, amount)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [Number(customer_id), service, barber_name || null, price]
    );

    await client.query(
      `UPDATE customers
       SET total_visits = total_visits + 1,
           loyalty_stamps = loyalty_stamps + 1,
           total_spent = total_spent + $2
       WHERE id = $1`,
      [Number(customer_id), price]
    );

    await client.query("COMMIT");
    res.status(201).json(visit.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Failed to record visit" });
  } finally {
    client.release();
  }
});

router.post("/customers/:id/redeem", async (req, res) => {
  const client = await pool.connect();

  try {
    const customerId = Number(req.params.id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: "Invalid customer ID" });
    }

    await client.query("BEGIN");

    const result = await client.query(
      `SELECT id, loyalty_stamps
       FROM customers
       WHERE id = $1
       FOR UPDATE`,
      [customerId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Customer not found" });
    }

    if (result.rows[0].loyalty_stamps < 10) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Customer needs 10 stamps before redeeming a reward",
      });
    }

    await client.query(
      `INSERT INTO rewards (customer_id, reward_name, stamps_required, status, redeemed_at)
       VALUES ($1, $2, 10, 'redeemed', NOW())`,
      [customerId, "Free haircut loyalty reward"]
    );

    await client.query(
      `UPDATE customers
       SET loyalty_stamps = 0
       WHERE id = $1`,
      [customerId]
    );

    await client.query("COMMIT");

    res.json({ message: "Reward redeemed successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Failed to redeem reward" });
  } finally {
    client.release();
  }
});
module.exports = router;