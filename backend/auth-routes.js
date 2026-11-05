
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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

    const bcrypt = require("bcryptjs");
    const jwt = require("jsonwebtoken");

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

    // Existing customers cannot log in until their account is securely activated.
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
