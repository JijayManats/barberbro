
const express = require("express");
const crypto = require("crypto");
const pool = require("./db");

const {
  authenticateToken,
  requireAdmin,
} = require("./auth-middleware");
const { addRealtimeClient } = require("./realtime");

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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
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
    return {
      sent: false,
      reason: "missing-email",
      error: "No email address is saved for this customer.",
    };
  }

  const user = process.env.EMAIL_USER;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!user || !clientId || !clientSecret || !refreshToken) {
    return {
      sent: false,
      reason: "gmail-api-not-configured",
      error: "Set EMAIL_USER, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in the server environment.",
    };
  }

  const memberId = String(customer?.member_code || "").toUpperCase();
  const safeMemberId = escapeHtml(memberId);
  const safeActivationCode = escapeHtml(activationCode);
  const recipient = String(customer.email).trim();
  const from = String(user).trim();
  const emailAddressPattern = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

  if (!emailAddressPattern.test(recipient) || !emailAddressPattern.test(from)) {
    return {
      sent: false,
      reason: "invalid-email-header",
      error: "The sender or recipient email address is invalid.",
    };
  }

  const html = `
    <!doctype html>
    <html>
      <body style="margin:0;padding:0;background:#f3f1ec;font-family:Arial,Helvetica,sans-serif;color:#20221d;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1ec;padding:32px 12px;">
          <tr><td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e8e4da;border-radius:12px;overflow:hidden;">
              <tr><td style="padding:24px 28px;background:#20211c;color:#f4efe6;">
                <div style="font-size:13px;font-weight:bold;letter-spacing:2px;">BARBER<span style="color:#d8b66a;">BRO</span></div>
              </td></tr>
              <tr><td style="padding:26px 28px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="padding:14px 16px;background:#f7f5f0;border:1px solid #e9e4d8;border-radius:8px;">
                    <div style="font-size:11px;font-weight:bold;letter-spacing:1.4px;color:#777267;">MEMBER ID</div>
                    <div style="margin-top:7px;font-size:21px;font-weight:bold;letter-spacing:1px;color:#20211c;">${safeMemberId}</div>
                  </td></tr>
                  <tr><td height="12" style="font-size:0;line-height:0;">&nbsp;</td></tr>
                  <tr><td style="padding:14px 16px;background:#fbf6e9;border:1px solid #eadbb5;border-radius:8px;">
                    <div style="font-size:11px;font-weight:bold;letter-spacing:1.4px;color:#76623c;">ACTIVATION CODE</div>
                    <div style="margin-top:7px;font-size:25px;font-weight:bold;letter-spacing:2px;color:#29251b;">${safeActivationCode}</div>
                  </td></tr>
                </table>
              </td></tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
  `;

  const text = `Member ID: ${memberId}\nActivation code: ${activationCode}`;

  const boundary = `barberbro-${crypto.randomBytes(12).toString("hex")}`;
  const encodeMimeBody = (value) =>
    Buffer.from(value, "utf8")
      .toString("base64")
      .match(/.{1,76}/g)
      .join("\r\n");
  const mimeMessage = [
    `From: ${from}`,
    `To: ${recipient}`,
    "Subject: Your BarberBro activation details",
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeMimeBody(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15000),
  });

  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) {
    const detail = tokenData.error_description || tokenData.error;
    throw new Error(
      `Google OAuth token request failed${detail ? `: ${detail}` : "."}`
    );
  }

  const gmailResponse = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: Buffer.from(mimeMessage).toString("base64url") }),
      signal: AbortSignal.timeout(15000),
    }
  );
  const gmailData = await gmailResponse.json().catch(() => ({}));
  if (!gmailResponse.ok || !gmailData.id) {
    const detail = gmailData.error?.message;
    throw new Error(
      `Gmail API send failed${detail ? `: ${detail}` : ` (HTTP ${gmailResponse.status}).`}`
    );
  }

  console.info("[member-card-email] Message accepted by Gmail API:", recipient);
  return { sent: true, message_id: gmailData.id };
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

router.get("/haircut-styles", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, image_data, created_at,
              (catalog_key IS NOT NULL) AS is_default
       FROM haircut_styles
       ORDER BY name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Haircut style load failed:", error.message);
    res.status(500).json({ error: "Failed to load haircut styles" });
  }
});

router.get("/events", authenticateToken, (req, res) => {
  addRealtimeClient(req, res);
});

// The remaining routes in this file require an authenticated admin.
router.use(authenticateToken, requireAdmin);

router.post("/haircut-styles", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const imageData = String(req.body?.image_data || "");
    const match = imageData.match(
      /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
    );

    if (!name || name.length > 120) {
      return res.status(400).json({ error: "Hairstyle name must be between 1 and 120 characters" });
    }

    if (!match) {
      return res.status(400).json({ error: "Choose a valid JPEG, PNG, or WebP reference image" });
    }

    const imageBytes = Buffer.from(match[2], "base64");
    const validImageSignature = match[1] === "image/png"
      ? imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === "image/jpeg"
        ? imageBytes[0] === 255 && imageBytes[1] === 216 && imageBytes[2] === 255
        : imageBytes.subarray(0, 4).toString() === "RIFF" &&
          imageBytes.subarray(8, 12).toString() === "WEBP";

    if (!validImageSignature || imageBytes.length === 0 || imageBytes.length > 1.5 * 1024 * 1024) {
      return res.status(400).json({ error: "Reference images must be valid and no larger than 1.5 MB" });
    }

    const result = await pool.query(
      `INSERT INTO haircut_styles (name, image_data)
       VALUES ($1, $2)
       RETURNING id, name, image_data, created_at`,
      [name, imageData]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "A hairstyle with that name already exists" });
    }
    console.error("Haircut style create failed:", error.message);
    res.status(500).json({ error: "Failed to add hairstyle" });
  }
});

router.put("/haircut-styles/:id", async (req, res) => {
  try {
    const styleId = Number(req.params.id);
    const name = String(req.body?.name || "").trim();
    const imageData = String(req.body?.image_data || "");

    if (!Number.isInteger(styleId) || styleId <= 0) {
      return res.status(400).json({ error: "Invalid hairstyle ID" });
    }
    if (!name || name.length > 120) {
      return res.status(400).json({ error: "Hairstyle name must be between 1 and 120 characters" });
    }

    if (imageData) {
      const match = imageData.match(
        /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/
      );
      if (!match) {
        return res.status(400).json({ error: "Choose a valid JPEG, PNG, or WebP reference image" });
      }

      const imageBytes = Buffer.from(match[2], "base64");
      const validImageSignature = match[1] === "image/png"
        ? imageBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : match[1] === "image/jpeg"
          ? imageBytes[0] === 255 && imageBytes[1] === 216 && imageBytes[2] === 255
          : imageBytes.subarray(0, 4).toString() === "RIFF" &&
            imageBytes.subarray(8, 12).toString() === "WEBP";

      if (!validImageSignature || imageBytes.length === 0 || imageBytes.length > 1.5 * 1024 * 1024) {
        return res.status(400).json({ error: "Reference images must be valid and no larger than 1.5 MB" });
      }
    }

    const result = await pool.query(
      `UPDATE haircut_styles
       SET name = $1, image_data = COALESCE(NULLIF($2, ''), image_data)
       WHERE id = $3
       RETURNING id, name, image_data, created_at,
                 (catalog_key IS NOT NULL) AS is_default`,
      [name, imageData, styleId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Hairstyle not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "A hairstyle with that name already exists" });
    }
    console.error("Haircut style update failed:", error.message);
    res.status(500).json({ error: "Failed to update hairstyle" });
  }
});

router.delete("/haircut-styles/:id", async (req, res) => {
  try {
    const styleId = Number(req.params.id);
    if (!Number.isInteger(styleId) || styleId <= 0) {
      return res.status(400).json({ error: "Invalid hairstyle ID" });
    }

    const result = await pool.query(
      "DELETE FROM haircut_styles WHERE id = $1 AND catalog_key IS NULL RETURNING id",
      [styleId]
    );

    if (result.rowCount === 0) {
      const existing = await pool.query(
        "SELECT catalog_key FROM haircut_styles WHERE id = $1",
        [styleId]
      );
      if (existing.rowCount === 0) {
        return res.status(404).json({ error: "Hairstyle not found" });
      }
      return res.status(409).json({ error: "Built-in hairstyles cannot be deleted. Edit the style instead." });
    }

    res.json({ message: "Hairstyle removed successfully", hairstyle_id: styleId });
  } catch (error) {
    console.error("Haircut style delete failed:", error.message);
    res.status(500).json({ error: "Failed to delete hairstyle" });
  }
});

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

router.get("/barbers/stats", async (req, res) => {
  try {
    const result = await pool.query(`
      WITH period_bounds AS (
        SELECT
          date_trunc('day', NOW() AT TIME ZONE 'Asia/Manila')
            AT TIME ZONE 'Asia/Manila' AS day_start,
          date_trunc('week', NOW() AT TIME ZONE 'Asia/Manila')
            AT TIME ZONE 'Asia/Manila' AS week_start,
          date_trunc('month', NOW() AT TIME ZONE 'Asia/Manila')
            AT TIME ZONE 'Asia/Manila' AS month_start,
          date_trunc('year', NOW() AT TIME ZONE 'Asia/Manila')
            AT TIME ZONE 'Asia/Manila' AS year_start
      ),
      barber_periods AS (
        SELECT
          b.id AS barber_id,
          COUNT(v.id) FILTER (WHERE v.visited_at >= bounds.day_start) AS haircuts_today,
          COUNT(v.id) FILTER (WHERE v.visited_at >= bounds.week_start) AS haircuts_this_week,
          COUNT(v.id) FILTER (WHERE v.visited_at >= bounds.month_start) AS haircuts_this_month,
          COUNT(v.id) FILTER (WHERE v.visited_at >= bounds.year_start) AS haircuts_this_year,
          COALESCE(SUM(v.amount) FILTER (WHERE v.visited_at >= bounds.day_start), 0) AS earnings_today,
          COALESCE(SUM(v.amount) FILTER (WHERE v.visited_at >= bounds.week_start), 0) AS earnings_this_week,
          COALESCE(SUM(v.amount) FILTER (WHERE v.visited_at >= bounds.month_start), 0) AS earnings_this_month,
          COALESCE(SUM(v.amount) FILTER (WHERE v.visited_at >= bounds.year_start), 0) AS earnings_this_year
        FROM barbers b
        CROSS JOIN period_bounds bounds
        LEFT JOIN visits v
          ON LOWER(BTRIM(v.barber_name)) = LOWER(BTRIM(b.name))
        GROUP BY b.id, bounds.day_start, bounds.week_start, bounds.month_start, bounds.year_start
      ),
      service_counts AS (
        SELECT
          LOWER(BTRIM(barber_name)) AS barber_key,
          MIN(BTRIM(service)) AS service,
          COUNT(*) AS request_count
        FROM visits
        WHERE NULLIF(BTRIM(barber_name), '') IS NOT NULL
          AND NULLIF(BTRIM(service), '') IS NOT NULL
        GROUP BY LOWER(BTRIM(barber_name)), LOWER(BTRIM(service))
        HAVING COUNT(*) >= 2
      ),
      ranked_services AS (
        SELECT *,
          RANK() OVER (PARTITION BY barber_key ORDER BY request_count DESC) AS popularity_rank
        FROM service_counts
      ),
      top_services AS (
        SELECT
          barber_key,
          JSON_AGG(
            JSON_BUILD_OBJECT('name', service, 'count', request_count)
            ORDER BY service
          ) AS services
        FROM ranked_services
        WHERE popularity_rank = 1
        GROUP BY barber_key
      ),
      customer_counts AS (
        SELECT
          LOWER(BTRIM(v.barber_name)) AS barber_key,
          c.id AS customer_id,
          c.full_name,
          COUNT(*) AS visit_count
        FROM visits v
        JOIN customers c ON c.id = v.customer_id
        WHERE NULLIF(BTRIM(v.barber_name), '') IS NOT NULL
        GROUP BY LOWER(BTRIM(v.barber_name)), c.id, c.full_name
        HAVING COUNT(*) >= 2
      ),
      ranked_customers AS (
        SELECT *,
          RANK() OVER (PARTITION BY barber_key ORDER BY visit_count DESC) AS frequency_rank
        FROM customer_counts
      ),
      top_customers AS (
        SELECT
          barber_key,
          JSON_AGG(
            JSON_BUILD_OBJECT('name', full_name, 'count', visit_count)
            ORDER BY full_name
          ) AS customers
        FROM ranked_customers
        WHERE frequency_rank = 1
        GROUP BY barber_key
      )
      SELECT
        b.id,
        b.name,
        b.specialty,
        b.is_active,
        COALESCE(p.haircuts_today, 0) AS haircuts_today,
        COALESCE(p.haircuts_this_week, 0) AS haircuts_this_week,
        COALESCE(p.haircuts_this_month, 0) AS haircuts_this_month,
        COALESCE(p.haircuts_this_year, 0) AS haircuts_this_year,
        COALESCE(p.earnings_today, 0) AS earnings_today,
        COALESCE(p.earnings_this_week, 0) AS earnings_this_week,
        COALESCE(p.earnings_this_month, 0) AS earnings_this_month,
        COALESCE(p.earnings_this_year, 0) AS earnings_this_year,
        COALESCE(s.services, '[]'::json) AS top_services,
        COALESCE(c.customers, '[]'::json) AS top_customers
      FROM barbers b
      JOIN barber_periods p ON p.barber_id = b.id
      LEFT JOIN top_services s ON s.barber_key = LOWER(BTRIM(b.name))
      LEFT JOIN top_customers c ON c.barber_key = LOWER(BTRIM(b.name))
      ORDER BY b.is_active DESC, b.name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Barber statistics load failed:", error.message);
    res.status(500).json({ error: "Failed to load barber statistics" });
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
       WHERE is_active = TRUE
       ORDER BY required_stamps ASC, name ASC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Admin reward template query failed:", error.message);
    res.status(500).json({ error: "Failed to load rewards" });
  }
});

router.get("/reward-redemptions", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.reward_name, r.stamps_required,
              COALESCE(r.redeemed_at, r.created_at) AS redeemed_at,
              c.full_name, c.member_code
       FROM rewards r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.status = 'redeemed'
       ORDER BY COALESCE(r.redeemed_at, r.created_at) DESC, r.id DESC
       LIMIT 200`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Reward redemption history failed:", error.message);
    res.status(500).json({ error: "Failed to load reward redemption history" });
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
    let emailResult;

    try {
      emailResult = await sendMemberCardEmail(customer, createdActivationCode);
    } catch (emailError) {
      emailResult = {
        sent: false,
        reason: "email-send-failed",
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
      email_error: emailResult.sent
        ? null
        : (emailResult.error || emailResult.reason || "Email sending failed"),
    });
  } catch (error) {
    console.error("Activation code generation failed:", error.message);
    return res.status(500).json({ error: "Failed to generate activation code" });
  }
});

router.post("/customers/:id/activation-code/resend", async (req, res) => {
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

    if (!customer.email) {
      return res.status(400).json({
        error: "This customer does not have an email address.",
      });
    }

    const activationResult = await pool.query(
      `SELECT code
       FROM customer_activation_codes
       WHERE customer_id = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [customer.id]
    );

    if (activationResult.rowCount === 0) {
      return res.status(404).json({
        error: "No active activation code is available. Generate a new code first.",
      });
    }

    let emailResult;
    try {
      emailResult = await sendMemberCardEmail(
        customer,
        activationResult.rows[0].code
      );
    } catch (emailError) {
      console.error("Activation email retry failed:", emailError.message);
      emailResult = {
        sent: false,
        reason: "email-send-failed",
        error: emailError.message,
      };
    }

    return res.json({
      message: emailResult.sent
        ? "Activation email accepted by Gmail."
        : "Activation email could not be sent.",
      email: customer.email,
      email_sent: emailResult.sent,
      email_error: emailResult.sent
        ? null
        : (emailResult.error || emailResult.reason || "Email sending failed"),
    });
  } catch (error) {
    console.error("Activation email retry failed:", error.message);
    return res.status(500).json({ error: "Failed to retry the activation email" });
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

module.exports = router;