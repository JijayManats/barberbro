
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const apiRoutes = require("./routes");
const authRoutes = require("./auth-routes");

const app = express();
const PORT = process.env.PORT || 5000;

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

// BarberBro API routes
app.use("/api", apiRoutes);
app.use("/api/auth", authRoutes);

app.get("/", (req, res) => {
  res.json({
    message: "BarberBro API is running!",
    status: "success",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Backend is working correctly",
  });
});

app.listen(PORT, () => {
  console.log(`BarberBro backend running at http://localhost:${PORT}`);
});