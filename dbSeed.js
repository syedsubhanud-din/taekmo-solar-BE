// dbSeed.js
require("dotenv").config();
const bcrypt = require("bcryptjs");
const promisePool = require("./DB");

async function seedDatabase() {
  console.log("🌱 Starting database initialization and seeding...");

  try {
    // 1. Create Tables if they don't exist
    console.log("🏗️ Creating tables...");

    // Drop tables if they exist to apply new schema (UUID)
    await promisePool.query("DROP TABLE IF EXISTS barcodes, contact_us, users");

    // Users Table
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);

    // Barcodes Table
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS barcodes (
        id VARCHAR(36) PRIMARY KEY,
        barcode VARCHAR(255) NOT NULL UNIQUE,
        barcode_grade VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Contact Us Table
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS contact_us (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        subject VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Disable foreign key checks for clearing data
    await promisePool.query("SET FOREIGN_KEY_CHECKS = 0");

    // 3. Truncate tables (empty all data)
    const tables = ["users", "barcodes", "contact_us"];
    for (const table of tables) {
      const [countResult] = await promisePool.query(`SELECT COUNT(*) as count FROM ${table}`);
      const rowCount = countResult[0].count;

      if (rowCount === 0) {
        console.log(`ℹ️ Table ${table} is already empty. No data to clear.`);
      } else {
        console.log(`🧹 Clearing ${rowCount} rows from table: ${table}...`);
        await promisePool.query(`TRUNCATE TABLE ${table}`);
      }
    }

    // 4. Re-enable foreign key checks
    await promisePool.query("SET FOREIGN_KEY_CHECKS = 1");

    // 5. Insert Default User
    console.log("👤 Creating default admin user...");
    const adminEmail = process.env.ADMIN_EMAIL || "admin@gmail.com";
    if (!process.env.ADMIN_EMAIL) {
      console.log("⚠️ No ADMIN_EMAIL found in .env, using default: admin@gmail.com");
    }
    const adminPassword = "admin";
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    await promisePool.query(
      "INSERT INTO users (id, name, email, password) VALUES (UUID(), ?, ?, ?)",
      ["Admin", adminEmail, hashedPassword]
    );

    console.log("\n✅ Database initialized and seeded successfully!");
    console.log("--------------------------------");
    console.log(`Admin Email: ${adminEmail} (check .env for custom email)`);
    console.log(`Admin Password: ${adminPassword}`);
    console.log("--------------------------------");

  } catch (error) {
    console.error("\n❌ Initialization/Seeding failed:", error);
  } finally {
    process.exit();
  }
}

seedDatabase();