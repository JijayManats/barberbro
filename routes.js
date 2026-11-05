
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

function buildCustomerQrImageUrl(customer) {
  const qrPayload = buildCustomerQrPayload(customer);
  if (!qrPayload) {
    return "";
  }

  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrPayload)}&size=220x220&margin=1&ecc=M&color=171a2c&bgcolor=fffaf4`;
}

function getCustomerDisplayName(customer) {
  const fullName = String(customer?.full_name || "").trim();
  if (fullName) return fullName;

  const emailName = String(customer?.email || "").split("@")[0]?.trim();
  if (emailName) return emailName;

  return "Member";
}

function parseVisitQrPayload(rawPayload) {
  const trimmed = String(rawPayload || "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    const value = trimmed.startsWith("barberbro://") ? new URL(trimmed) : null;
    if (!value && !trimmed.startsWith("barberbro://")) {
      return null;
    }

    const pathname = value ? (value.pathname || "") : "";
    const idMatch = pathname.match(/\/([0-9]+)(?:\/[^/]+)?$/);
    const customerId = idMatch ? Number(idMatch[1]) : null;
    const params = value ? value.searchParams : new URLSearchParams(trimmed.split("?")[1] || "");
    const service = String(params.get("service") || "").trim();
    const barber = String(params.get("barber") || params.get("barber_name") || "").trim();
    const amount = Number(params.get("amount") || 0);

    if (!customerId || !service || !barber || !Number.isFinite(amount) || amount < 0) {
      return null;
    }

    return {
      customer_id: customerId,
      service,
      barber_name: barber,
      amount,
    };
  } catch {
    return null;
  }
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
  const qrPayload = buildCustomerQrPayload(customer);
  const memberId = String(customer?.member_code || "").toUpperCase();

  if (!host || !user || !pass) {
    const preview = `Customer: ${displayName}
Member ID: ${memberId}
Activation code: ${activationCode}
QR payload: ${qrPayload}`;
    console.log("[member-card-demo]", preview);
    return { sent: false, reason: "smtp-missing", preview };
  }

  const nodemailer = require("nodemailer");
  const QRCode = require("qrcode");
  const qrImage = qrPayload
    ? await QRCode.toDataURL(qrPayload, {
        width: 220,
        margin: 1,
        color: {
          dark: "#171a2c",
          light: "#fffaf4",
        },
      })
    : "";

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: true,
    tls: {
      rejectUnauthorized: false,
    },
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });

  try {
    await transporter.verify();
  } catch (verifyError) {
    console.error("[member-card-email] SMTP verification failed:", verifyError.message);
    return {
      sent: false,
      reason: "smtp-verification-failed",
      error: verifyError.message,
    };
  }

  const html = `
    <div style="font-family: Arial, sans-serif; background: #f5efe7; padding: 24px; color: #171a2c;">
      <div style="max-width: 620px; margin: 0 auto; background: linear-gradient(135deg, #171a2c 0%, #241d38 100%); border-radius: 24px; overflow: hidden; box-shadow: 0 20px 40px rgba(23,26,44,0.18);">
        <div style="padding: 32px 28px 18px; color: #f3ebdf;">
          <div style="font-size: 12px; letter-spacing: 3px; text-transform: uppercase; opacity: 0.7;">BarberBro Loyalty</div>
          <h1 style="margin: 10px 0 0; font-size: 32px;">Welcome, ${displayName}</h1>
        </div>
        <div style="padding: 0 28px 28px; background: #fffaf4; color: #171a2c;">
          <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap; padding-top: 28px;">
            <div style="background: linear-gradient(135deg, #f3cf6b 0%, #dba95a 100%); border-radius: 18px; padding: 18px; text-align: center; min-width: 220px; min-height: 220px; display: flex; align-items: center; justify-content: center;">
              ${qrImage ? `<img src="${qrImage}" alt="BarberBro member QR code" style="display: block; width: 180px; height: 180px; margin: 0 auto; background: white; border-radius: 16px; padding: 8px;" />` : `<div style="display:block;width:180px;height:180px;border-radius:16px;background:#f3efe9;display:flex;align-items:center;justify-content:center;color:#171a2c;font-weight:700;">QR</div>`}
            </div>
            <div>
              <div style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #5a5447;">Member ID</div>
              <div style="font-size: 30px; font-weight: 800; margin-top: 8px; letter-spacing: 1px;">${memberId}</div>
              <div style="margin-top: 16px; padding: 12px 14px; background: #efe8d8; border-radius: 12px;">
                <div style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #5a5447;">Activation code</div>
                <div style="font-size: 24px; font-weight: 800; margin-top: 7px;">${activationCode}</div>
              </div>
            </div>
          </div>
          <div style="margin-top: 20px; border-top: 1px solid #e4ddcf; padding-top: 18px; font-size: 14px; line-height: 1.7; color: #4b4b4b;">
            <div style="font-weight: 700; color: #171a2c; margin-bottom: 6px;">Quick setup details</div>
            <div>Member ID: <strong>${memberId}</strong></div>
            <div>Activation code: <strong>${activationCode}</strong></div>
            <div>QR payload: <strong>${qrPayload || "Unavailable"}</strong></div>
          </div>
          <div style="margin-top: 18px; font-size: 14px; line-height: 1.7; color: #4b4b4b;">Use your member ID and activation code on the BarberBro customer app to finish setting up your account. Keep this email handy — your QR card is also your quick check-in ID.</div>
        </div>
      </div>
    </div>
  `;

  const text = `Welcome, ${displayName}\n\nMember ID: ${memberId}\nActivation code: ${activationCode}\nQR payload: ${qrPayload || "Unavailable"}\n\nUse your member ID and activation code on the BarberBro customer app to finish setting up your account.`;

  await transporter.sendMail({
    from,
    to: customer.email,
    subject: "Your BarberBro member card and activation code",
    text,
    html,
  });

  return { sent: true };
}

router.get("/barbers", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, specialty, is_active, created_at
       FROM barbers
       WHERE is_active = TRUE
       ORDER BY name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Barber list failed:", error.message);
    res.status(500).json({ error: "Failed to load barbers" });
  }
});

router.get("/reward-templates", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, required_stamps, description, is_active, created_at
       FROM reward_templates
       WHERE is_active = TRUE
       ORDER BY required_stamps ASC, name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Reward template load failed:", error.message);
    res.status(500).json({ error: "Failed to load rewards" });
  }
});

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

router.get("/barbers/admin", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, specialty, is_active, created_at
       FROM barbers
       ORDER BY name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Admin barber query failed:", error.message);
    res.status(500).json({ error: "Failed to load barbers" });
  }
});

router.post("/barbers", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const specialty = String(req.body?.specialty || "").trim();

    if (!name) {
      return res.status(400).json({ error: "Barber name is required" });
    }

    const result = await pool.query(
      `INSERT INTO barbers (name, specialty)
       VALUES ($1, $2)
       RETURNING *`,
      [name, specialty || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Barber create failed:", error.message);
    res.status(500).json({ error: "Failed to add barber" });
  }
});

router.put("/barbers/:id", async (req, res) => {
  try {
    const barberId = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    const specialty = String(req.body?.specialty || "").trim();

    if (!Number.isInteger(barberId) || barberId <= 0) {
      return res.status(400).json({ error: "Invalid barber ID" });
    }

    if (!name) {
      return res.status(400).json({ error: "Barber name is required" });
    }

    const result = await pool.query(
      `UPDATE barbers
       SET name = $1,
           specialty = $2
       WHERE id = $3
       RETURNING *`,
      [name, specialty || null, barberId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Barber not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Barber update failed:", error.message);
    res.status(500).json({ error: "Failed to update barber" });
  }
});

router.delete("/barbers/:id", async (req, res) => {
  try {
    const barberId = Number(req.params.id);

    if (!Number.isInteger(barberId) || barberId <= 0) {
      return res.status(400).json({ error: "Invalid barber ID" });
    }

    const result = await pool.query(
      `UPDATE barbers
       SET is_active = FALSE
       WHERE id = $1
       RETURNING id` ,
      [barberId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Barber not found" });
    }

    res.json({ message: "Barber removed successfully", barber_id: barberId });
  } catch (error) {
    console.error("Barber delete failed:", error.message);
    res.status(500).json({ error: "Failed to delete barber" });
  }
});

router.get("/reward-templates/admin", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, required_stamps, description, is_active, created_at
       FROM reward_templates
       ORDER BY required_stamps ASC, name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Admin reward template query failed:", error.message);
    res.status(500).json({ error: "Failed to load rewards" });
  }
});

router.post("/reward-templates", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const requiredStamps = Number(req.body?.required_stamps ?? 10);

    if (!name) {
      return res.status(400).json({ error: "Reward name is required" });
    }

    if (!Number.isFinite(requiredStamps) || requiredStamps <= 0) {
      return res.status(400).json({ error: "Required stamps must be a positive number" });
    }

    const result = await pool.query(
      `INSERT INTO reward_templates (name, required_stamps, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, requiredStamps, description || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Reward template create failed:", error.message);
    res.status(500).json({ error: "Failed to add reward" });
  }
});

router.put("/reward-templates/:id", async (req, res) => {
  try {
    const templateId = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    const requiredStamps = Number(req.body?.required_stamps ?? 10);

    if (!Number.isInteger(templateId) || templateId <= 0) {
      return res.status(400).json({ error: "Invalid reward ID" });
    }

    if (!name) {
      return res.status(400).json({ error: "Reward name is required" });
    }

    if (!Number.isFinite(requiredStamps) || requiredStamps <= 0) {
      return res.status(400).json({ error: "Required stamps must be a positive number" });
    }

    const result = await pool.query(
      `UPDATE reward_templates
       SET name = $1,
           required_stamps = $2,
           description = $3
       WHERE id = $4
       RETURNING *`,
      [name, requiredStamps, description || null, templateId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Reward not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Reward template update failed:", error.message);
    res.status(500).json({ error: "Failed to update reward" });
  }
});

router.delete("/reward-templates/:id", async (req, res) => {
  try {
    const templateId = Number(req.params.id);

    if (!Number.isInteger(templateId) || templateId <= 0) {
      return res.status(400).json({ error: "Invalid reward ID" });
    }

    const result = await pool.query(
      `UPDATE reward_templates
       SET is_active = FALSE
       WHERE id = $1
       RETURNING id`,
      [templateId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Reward not found" });
    }

    res.json({ message: "Reward removed successfully", reward_id: templateId });
  } catch (error) {
    console.error("Reward template delete failed:", error.message);
    res.status(500).json({ error: "Failed to delete reward" });
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
      `SELECT id, member_code, full_name, email, password_hash
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
    let emailResult = { sent: false, reason: "not-attempted" };

    try {
      if (customer.email) {
        emailResult = await sendMemberCardEmail(customer, createdActivationCode);
      }
    } catch (emailError) {
      emailResult = {
        sent: false,
        reason: "smtp-error",
        error: emailError.message,
      };
      console.warn("Customer card email failed:", emailError.message);
    }

    return res.status(201).json({
      message: "Activation code created successfully",
      code: createdActivationCode,
      expires_at: result.rows[0].expires_at,
      member_code: customer.member_code,
      email: customer.email,
      email_sent: emailResult.sent,
      email_error: emailResult.sent ? null : (emailResult.error || emailResult.reason || "email sending failed"),
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

    const parsedQr = parseQrLookupPayload(qrPayload || memberCode);
    const lookupId = parsedQr.id;
    const lookupMemberCode = parsedQr.memberCode || memberCode;

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

router.delete("/customers/:id", async (req, res) => {
  const client = await pool.connect();

  try {
    const customerId = Number(req.params.id);

    if (!Number.isInteger(customerId) || customerId <= 0) {
      return res.status(400).json({ error: "Invalid customer ID" });
    }

    await client.query("BEGIN");

    const customer = await client.query(
      `SELECT id FROM customers WHERE id = $1 FOR UPDATE`,
      [customerId]
    );

    if (customer.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Customer not found" });
    }

    await client.query(`DELETE FROM visits WHERE customer_id = $1`, [customerId]);
    await client.query(`DELETE FROM rewards WHERE customer_id = $1`, [customerId]);
    await client.query(`DELETE FROM customer_activation_codes WHERE customer_id = $1`, [customerId]);
    await client.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    await client.query("COMMIT");

    res.json({ message: "Customer deleted successfully", customer_id: customerId });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Customer deletion failed:", error.message);
    res.status(500).json({ error: "Failed to delete customer" });
  } finally {
    client.release();
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