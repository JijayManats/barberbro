
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const apiRoutes = require("./routes");
const authRoutes = require("./auth-routes");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

console.log("=== BARBERBRO SERVER DIAGNOSTICS ===");
console.log("Working directory:", process.cwd());
console.log("JWT_SECRET loaded:", Boolean(process.env.JWT_SECRET));
console.log("Auth routes:", authRoutes.stack
  .filter((layer) => layer.route)
  .map((layer) => {
    const methods = Object.keys(layer.route.methods)
      .join(",")
      .toUpperCase();

    return `${methods} ${layer.route.path}`;
  }));
console.log("====================================");

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Backend is working correctly",
  });
});

// Public auth routes must be mounted before admin-protected API routes.
app.use("/api/auth", authRoutes);
app.use("/api", apiRoutes);

const adminDistPath = path.join(__dirname, "admin-web", "dist");
const customerDistPath = path.join(__dirname, "customer-app", "dist");

if (fs.existsSync(adminDistPath)) {
  app.use("/admin", express.static(adminDistPath));
  app.get(/^\/admin\/(.*)$/, (req, res) => {
    res.sendFile(path.join(adminDistPath, "index.html"));
  });
}

if (fs.existsSync(customerDistPath)) {
  app.use(express.static(customerDistPath));
  app.get(/^(?!\/api|\/admin).*/, (req, res) => {
    res.sendFile(path.join(customerDistPath, "index.html"));
  });
}

app.get("/", (req, res) => {
  if (fs.existsSync(customerDistPath)) {
    return res.sendFile(path.join(customerDistPath, "index.html"));
  }

  res.json({
    message: "BarberBro API is running!",
    status: "success",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BarberBro backend running at http://localhost:${PORT}`);
});