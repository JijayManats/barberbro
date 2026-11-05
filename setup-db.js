
const fs = require("fs");
const path = require("path");
const pool = require("./db");

async function setupDatabase() {
  try {
    const schemaFiles = ["schema.sql", "add-customer-auth.sql"];

    for (const fileName of schemaFiles) {
      const schema = fs.readFileSync(path.join(__dirname, fileName), "utf8");
      await pool.query(schema);
    }

    console.log("BarberBro database tables created successfully!");

    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log("Tables in your database:");
    result.rows.forEach((row) => console.log(`- ${row.table_name}`));
  } catch (error) {
    console.error("Database setup failed:", error.message);
  } finally {
    await pool.end();
  }
}

setupDatabase();