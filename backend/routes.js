
const express = require("express");
const pool = require("./db");

const {
  authenticateToken,
  requireAdmin,
} = require("./auth-middleware");

const router = express.Router();

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
      `SELECT * FROM customers
       WHERE full_name ILIKE $1
          OR COALESCE(phone, '') ILIKE $1
          OR member_code ILIKE $1
       ORDER BY created_at DESC`,
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