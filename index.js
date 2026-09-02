// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const promisePool = require("./DB");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();

// ===================== ENVIRONMENT & CONFIG =====================
const isProd = process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 5000;
const JWT_SECRET_KEY =
  process.env.JWT_SECRET_KEY || "replace_with_secure_secret_in_prod";

if (
  isProd &&
  (!process.env.JWT_SECRET_KEY ||
    process.env.JWT_SECRET_KEY === "replace_with_secure_secret_in_prod")
) {
  console.warn(
    "⚠️ WARNING: Running in production without a strong JWT_SECRET_KEY set in .env!",
  );
}

// ===================== SECURITY & LOGGING =====================
// Secure HTTP headers
app.use(helmet());

// HTTP request logging
app.use(morgan(isProd ? "combined" : "dev"));

// ===================== CORS =====================
const defaultOrigins = [
  "https://www.taekmo-solar.com",
  "https://taekmo-solar.com",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
];

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) =>
      o.trim().replace(/\/$/, ""),
    )
  : defaultOrigins;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser requests (mobile apps, server-to-server, curl) or in non-production
      if (!origin || !isProd) {
        return callback(null, true);
      }
      const cleanOrigin = origin.replace(/\/$/, "");
      if (
        allowedOrigins.includes("*") ||
        allowedOrigins.includes(cleanOrigin) ||
        defaultOrigins.includes(cleanOrigin)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json({ limit: "150mb" }));
app.use(express.urlencoded({ limit: "150mb", extended: true }));

// ===================== RATE LIMITING =====================
// General limiter across all routes
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message:
      "Too many requests from this IP, please try again after 15 minutes.",
  },
});
app.use(globalLimiter);

// Specific limiter for login (brute-force protection)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
});

// Specific limiter for contact-us (spam protection)
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: "Too many messages sent. Please try again after 1 hour.",
  },
});

// Specific limiter for public barcode verification
const verifyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    statusCode: 429,
    message: "Too many verification requests. Please slow down.",
  },
});

// ===================== SMTP =====================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: true, // TLS
  auth: {
    user: (process.env.SMTP_USER || "").trim(),
    pass: (process.env.SMTP_PASS || "").trim(),
  },
});

// Verify transporter on startup (non-blocking)
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter.verify((err) => {
    if (err) {
      console.warn("⚠️ SMTP transporter notice:", err.message);
    } else {
      console.log("📧 SMTP transporter is ready");
    }
  });
}

async function sendMail(to, subject, html) {
  return transporter.sendMail({
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}

// ===================== MIDDLEWARE =====================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      statusCode: 401,
      message: "Access denied. Token missing.",
    });
  }

  try {
    const verified = jwt.verify(token, JWT_SECRET_KEY);
    req.user = verified;
    next();
  } catch (error) {
    return res.status(403).json({
      statusCode: 403,
      message: "Invalid or expired token.",
    });
  }
};

// ===================== DB AUTO MIGRATION & INDEXES =====================
async function ensureDatabaseSchema() {
  try {
    // 1. Ensure barcodes table exists
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS barcodes (
        id VARCHAR(36) PRIMARY KEY,
        barcode VARCHAR(255) NOT NULL UNIQUE,
        brand VARCHAR(100) NOT NULL DEFAULT 'TAEKMO',
        barcode_grade VARCHAR(50) NOT NULL DEFAULT 'A',
        rated_power VARCHAR(100) NOT NULL DEFAULT '650 W',
        export_country VARCHAR(100) NOT NULL DEFAULT 'Pakistan',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Ensure contact_us table exists
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

    // 3. Ensure users table exists
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL
      )
    `);

    // 4. Check and add any missing columns in existing barcodes table
    const [columns] = await promisePool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'barcodes'
    `);
    const existingColumns = new Set(
      columns.map((c) => c.COLUMN_NAME.toLowerCase()),
    );

    if (!existingColumns.has("brand")) {
      await promisePool.query(
        "ALTER TABLE barcodes ADD COLUMN brand VARCHAR(100) NOT NULL DEFAULT 'TAEKMO'",
      );
    }
    if (!existingColumns.has("rated_power")) {
      await promisePool.query(
        "ALTER TABLE barcodes ADD COLUMN rated_power VARCHAR(100) NOT NULL DEFAULT '650 W'",
      );
    }
    if (!existingColumns.has("export_country")) {
      await promisePool.query(
        "ALTER TABLE barcodes ADD COLUMN export_country VARCHAR(100) NOT NULL DEFAULT 'Pakistan'",
      );
    }

    // 5. Add performance indexes if missing
    try {
      await promisePool.query(
        "CREATE INDEX idx_barcodes_created_at ON barcodes (created_at)",
      );
    } catch (_) {}
    try {
      await promisePool.query(
        "CREATE INDEX idx_barcodes_brand ON barcodes (brand)",
      );
    } catch (_) {}

    console.log("✅ Database schema & indexes verified");
  } catch (err) {
    console.error("⚠️ Database schema check warning:", err.message);
  }
}

// ===================== HEALTH & ROOT =====================

app.get("/health", async (req, res) => {
  try {
    await promisePool.query("SELECT 1");
    res.status(200).json({
      status: "OK",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: "CONNECTED",
    });
  } catch (err) {
    res.status(500).json({
      status: "ERROR",
      uptime: process.uptime(),
      database: "DISCONNECTED",
      error: isProd ? "Database unreachable" : err.message,
    });
  }
});

app.get("/", (req, res) => {
  res.status(200).json({
    name: "TAEKMO Solar Backend API",
    status: "Active",
    version: "1.0.0",
  });
});

// ===================== AUTH ROUTES =====================

// Login
app.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      statusCode: 400,
      message: "Email and password are required",
    });
  }

  try {
    const [users] = await promisePool.query(
      "SELECT id, name, email, password FROM users WHERE email = ?",
      [email.trim().toLowerCase()],
    );

    if (users.length === 0) {
      return res.status(400).json({
        statusCode: 400,
        message: "Invalid email or password",
      });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        statusCode: 400,
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET_KEY,
      { expiresIn: "5h" },
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        token,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Login failed",
      error: isProd ? "Internal server error" : error.message,
    });
  }
});

// ===================== BARCODES ROUTES =====================

// Get all barcodes with pagination
app.get("/barcodes", authenticateToken, async (req, res) => {
  let { lastcount, skipcount } = req.query;

  const limit = Math.min(Math.max(parseInt(lastcount) || 10, 1), 500);
  const offset = Math.max(parseInt(skipcount) || 0, 0);

  try {
    const [countRows] = await promisePool.query(
      "SELECT COUNT(*) as total FROM barcodes",
    );
    const totalCount = countRows[0].total;

    const [rows] = await promisePool.query(
      "SELECT id, barcode, brand, barcode_grade, rated_power, export_country, created_at FROM barcodes ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [limit, offset],
    );

    res.status(200).json({
      statusCode: 200,
      message:
        rows.length > 0
          ? "Barcodes retrieved successfully"
          : "No barcodes found",
      data: rows,
      pagination: {
        totalCount,
        lastcount: limit,
        skipcount: offset,
        hasNextPage: offset + limit < totalCount,
      },
    });
  } catch (error) {
    console.error("Get barcodes error:", error);
    res.status(500).json({
      statusCode: 500,
      message: "Failed to retrieve barcodes",
      error: isProd ? "Internal server error" : error.message,
    });
  }
});

// Search barcodes
app.get("/barcodes/search", authenticateToken, async (req, res) => {
  let { query, lastcount, skipcount } = req.query;

  const limit = Math.min(Math.max(parseInt(lastcount) || 10, 1), 500);
  const offset = Math.max(parseInt(skipcount) || 0, 0);
  const searchQuery = `%${(query || "").trim()}%`;

  try {
    const [countRows] = await promisePool.query(
      `SELECT COUNT(*) as total FROM barcodes 
       WHERE barcode LIKE ? OR brand LIKE ? OR barcode_grade LIKE ? OR rated_power LIKE ? OR export_country LIKE ?`,
      [searchQuery, searchQuery, searchQuery, searchQuery, searchQuery],
    );
    const totalCount = countRows[0].total;

    const [rows] = await promisePool.query(
      `SELECT id, barcode, brand, barcode_grade, rated_power, export_country, created_at 
       FROM barcodes 
       WHERE barcode LIKE ? OR brand LIKE ? OR barcode_grade LIKE ? OR rated_power LIKE ? OR export_country LIKE ? 
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [
        searchQuery,
        searchQuery,
        searchQuery,
        searchQuery,
        searchQuery,
        limit,
        offset,
      ],
    );

    res.status(200).json({
      statusCode: 200,
      message:
        rows.length > 0 ? "Barcodes found" : "No barcodes matched your search",
      data: rows,
      pagination: {
        totalCount,
        lastcount: limit,
        skipcount: offset,
        hasNextPage: offset + limit < totalCount,
      },
    });
  } catch (error) {
    console.error("Search barcodes error:", error);
    res.status(500).json({
      statusCode: 500,
      message: "Failed to search barcodes",
      error: isProd ? "Internal server error" : error.message,
    });
  }
});

// Import single barcode
app.post("/barcodes/import-single", authenticateToken, async (req, res) => {
  const { barcode, brand, barcode_grade, rated_power, export_country } =
    req.body;
  if (!barcode || !String(barcode).trim()) {
    return res
      .status(400)
      .json({ statusCode: 400, message: "Barcode is required" });
  }

  const cleanBarcode = String(barcode).trim();
  const cleanBrand = String(brand || "TAEKMO").trim();
  const cleanGrade = String(barcode_grade || "A").trim();
  const cleanRatedPower = String(rated_power || "650 W").trim();
  const cleanExportCountry = String(export_country || "Pakistan").trim();

  try {
    // Check if barcode already exists (case-insensitive)
    const [existing] = await promisePool.query(
      "SELECT id, barcode FROM barcodes WHERE LOWER(barcode) = LOWER(?)",
      [cleanBarcode],
    );

    if (existing.length > 0) {
      return res.status(400).json({
        statusCode: 400,
        error: "DUPLICATE_BARCODE",
        message: `Barcode "${cleanBarcode}" already exists in the system. Duplicate barcodes cannot be added.`,
        duplicate: cleanBarcode,
      });
    }

    const id = crypto.randomUUID();
    await promisePool.query(
      "INSERT INTO barcodes (id, barcode, brand, barcode_grade, rated_power, export_country) VALUES (?, ?, ?, ?, ?, ?)",
      [
        id,
        cleanBarcode,
        cleanBrand,
        cleanGrade,
        cleanRatedPower,
        cleanExportCountry,
      ],
    );

    return res.status(201).json({
      statusCode: 201,
      message: "Barcode created successfully",
      id,
      barcode: {
        id,
        barcode: cleanBarcode,
        brand: cleanBrand,
        barcode_grade: cleanGrade,
        rated_power: cleanRatedPower,
        export_country: cleanExportCountry,
      },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        statusCode: 400,
        error: "DUPLICATE_BARCODE",
        message: `Barcode "${cleanBarcode}" already exists in the system.`,
        duplicate: cleanBarcode,
      });
    }
    console.error("Import single barcode error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to import barcode",
      error: isProd ? "Internal server error" : error.message,
    });
  }
});

// Import bulk barcodes
app.post("/barcodes/import-bulk", authenticateToken, async (req, res) => {
  const { barcodes } = req.body;
  if (!Array.isArray(barcodes) || barcodes.length === 0) {
    return res
      .status(400)
      .json({ statusCode: 400, message: "Valid barcodes array is required" });
  }

  try {
    const totalSubmitted = barcodes.length;
    const allDuplicates = [];
    const uniquePayloadCandidates = [];
    const seenInPayload = new Set();

    // Step 1: Normalize items and filter intra-payload duplicates
    for (const item of barcodes) {
      const rawBarcode =
        typeof item === "object" && item !== null ? item.barcode : item;
      const cleanBarcode = String(rawBarcode || "").trim();

      if (!cleanBarcode) {
        continue;
      }

      const upperKey = cleanBarcode.toUpperCase();
      if (seenInPayload.has(upperKey)) {
        allDuplicates.push(cleanBarcode);
      } else {
        seenInPayload.add(upperKey);
        uniquePayloadCandidates.push({
          barcode: cleanBarcode,
          brand: (item && item.brand ? String(item.brand) : "TAEKMO").trim(),
          barcode_grade: (item && (item.barcode_grade || item.grade)
            ? String(item.barcode_grade || item.grade)
            : "A"
          ).trim(),
          rated_power: (item && (item.rated_power || item.power)
            ? String(item.rated_power || item.power)
            : "650 W"
          ).trim(),
          export_country: (item && (item.export_country || item.country)
            ? String(item.export_country || item.country)
            : "Pakistan"
          ).trim(),
        });
      }
    }

    if (uniquePayloadCandidates.length === 0 && allDuplicates.length === 0) {
      return res.status(400).json({
        statusCode: 400,
        message: "No valid barcode values provided.",
      });
    }

    // Step 2: Check candidates against database in batches & insert unique ones
    const BATCH_SIZE = 1000;
    let totalInserted = 0;

    for (let i = 0; i < uniquePayloadCandidates.length; i += BATCH_SIZE) {
      const batch = uniquePayloadCandidates.slice(i, i + BATCH_SIZE);
      const barcodeValues = batch.map((b) => b.barcode);

      // Query existing barcodes from DB
      const [existingRows] = await promisePool.query(
        "SELECT barcode FROM barcodes WHERE barcode IN (?)",
        [barcodeValues],
      );

      const dbExistingSet = new Set(
        existingRows.map((row) => String(row.barcode).trim().toUpperCase()),
      );

      const toInsert = [];
      for (const item of batch) {
        if (dbExistingSet.has(item.barcode.toUpperCase())) {
          allDuplicates.push(item.barcode);
        } else {
          toInsert.push(item);
        }
      }

      // Bulk insert non-duplicate barcodes
      if (toInsert.length > 0) {
        const values = toInsert.map((b) => [
          crypto.randomUUID(),
          b.barcode,
          b.brand,
          b.barcode_grade,
          b.rated_power,
          b.export_country,
        ]);

        await promisePool.query(
          "INSERT INTO barcodes (id, barcode, brand, barcode_grade, rated_power, export_country) VALUES ?",
          [values],
        );
        totalInserted += toInsert.length;
      }
    }

    const duplicateCount = allDuplicates.length;

    // Case 1: All barcodes were duplicates (0 inserted)
    if (totalInserted === 0) {
      return res.status(400).json({
        statusCode: 400,
        error: "ALL_DUPLICATES",
        message: `All ${totalSubmitted} barcode(s) already exist or are duplicates. No new barcodes were uploaded.`,
        total: totalSubmitted,
        inserted: 0,
        skipped: duplicateCount,
        duplicateCount: duplicateCount,
        duplicates: allDuplicates,
      });
    }

    // Case 2: Partial success (Some inserted, some duplicates skipped)
    if (duplicateCount > 0) {
      return res.status(200).json({
        statusCode: 200,
        message: `${totalInserted} barcode(s) uploaded successfully. ${duplicateCount} duplicate barcode(s) were found and skipped.`,
        warning: `The following ${duplicateCount} duplicate barcode(s) were detected and skipped: ${allDuplicates.slice(0, 10).join(", ")}${duplicateCount > 10 ? ` and ${duplicateCount - 10} more` : ""}`,
        total: totalSubmitted,
        inserted: totalInserted,
        skipped: duplicateCount,
        duplicateCount: duplicateCount,
        duplicates: allDuplicates,
      });
    }

    // Case 3: Complete success (All inserted, 0 duplicates)
    return res.status(201).json({
      statusCode: 201,
      message: `All ${totalInserted} barcode(s) uploaded successfully.`,
      total: totalSubmitted,
      inserted: totalInserted,
      skipped: 0,
      duplicateCount: 0,
      duplicates: [],
    });
  } catch (error) {
    console.error("Import bulk barcodes error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to import bulk barcodes",
      error: isProd ? "Internal server error" : error.message,
    });
  }
});

// Verify barcode (Public endpoint with rate limiter)
app.post("/barcodes/verify", verifyLimiter, async (req, res) => {
  const { barcode } = req.body;
  if (!barcode || !String(barcode).trim()) {
    return res
      .status(400)
      .json({
        statusCode: 400,
        message: "Serial number / Barcode is required",
      });
  }

  const cleanBarcode = String(barcode).trim();

  try {
    const [rows] = await promisePool.query(
      "SELECT id, barcode, brand, barcode_grade, rated_power, export_country, created_at FROM barcodes WHERE LOWER(barcode) = LOWER(?)",
      [cleanBarcode],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        statusCode: 404,
        message: "Panel not found",
        searchedBarcode: cleanBarcode,
      });
    }

    const found = rows[0];
    return res.status(200).json({
      statusCode: 200,
      message: "Panel verified",
      barcode: {
        id: found.id,
        barcode: found.barcode,
        brand: found.brand || "TAEKMO",
        barcode_grade: found.barcode_grade || "A",
        rated_power: found.rated_power || "650 W",
        export_country: found.export_country || "Pakistan",
        created_at: found.created_at,
      },
    });
  } catch (error) {
    console.error("Verify barcode error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to verify barcode",
      error: isProd ? "Internal server error" : error.message,
    });
  }
});

// Delete barcode
app.delete("/barcodes/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await promisePool.query(
      "DELETE FROM barcodes WHERE id = ?",
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        statusCode: 404,
        message: "Barcode not found",
      });
    }

    return res.status(200).json({
      statusCode: 200,
      message: "Barcode deleted successfully",
    });
  } catch (error) {
    console.error("Delete barcode error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to delete barcode",
      error: isProd ? "Internal server error" : error.message,
    });
  }
});

// ===================== CONTACT US =====================

app.post("/contact-us", contactLimiter, async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res
      .status(400)
      .json({
        statusCode: 400,
        message: "Name, email, subject and message are required",
      });
  }

  try {
    const id = crypto.randomUUID();
    await promisePool.query(
      "INSERT INTO contact_us (id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)",
      [
        id,
        String(name).trim(),
        String(email).trim(),
        String(subject).trim(),
        String(message).trim(),
      ],
    );

    const html = `
      <h3>New Contact Us Message</h3>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Message:</strong> ${message}</p>
    `;

    // Send async email notification
    sendMail(
      process.env.ADMIN_EMAIL || process.env.SMTP_USER,
      `New Contact Us Inquiry: ${subject}`,
      html,
    ).catch((err) =>
      console.error("Admin mail notification error:", err.message),
    );

    // Auto-reply to the user
    const userHtml = `
      <h3>Hello ${name},</h3>
      <p>Thank you for contacting us. We have received your message and will get back to you soon.</p>
      <p><strong>Your Message:</strong></p>
      <p>${message}</p>
      <br/>
      <p>Best Regards,<br/>TAEKMO Support Team</p>
    `;

    sendMail(email, "Thank you for contacting us - TAEKMO", userHtml).catch(
      (err) => console.error("User auto-reply mail error:", err.message),
    );

    return res
      .status(200)
      .json({ statusCode: 200, message: "Message sent successfully" });
  } catch (error) {
    console.error("Contact us error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Failed to send message",
      error: isProd ? "Internal server error" : error.message,
    });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ statusCode: 404, message: "Route not found" });
});

// ===================== START SERVER =====================
const server = app.listen(PORT, async () => {
  console.log(
    `🚀 TAEKMO Solar Backend Server running on port ${PORT} [Mode: ${isProd ? "PRODUCTION" : "DEVELOPMENT"}]`,
  );
  await ensureDatabaseSchema();
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 ${signal} received. Closing server gracefully...`);
  server.close(() => {
    console.log("🔒 HTTP server closed.");
    promisePool.end().then(() => {
      console.log("🗄️ Database connections closed.");
      process.exit(0);
    });
  });
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
