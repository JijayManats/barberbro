
require("dotenv").config();
const pool = require("./db");

async function checkTables() {
  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log("Tables found in Neon:");
    console.table(result.rows);

    if (result.rows.length === 0) {
      console.log("No tables found. We need to check the database setup.");
    }
  } catch (error) {
    console.error("Error:", error.message);
  } finally {
    await pool.end();
  }
}

checkTables();