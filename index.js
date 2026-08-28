// index.js
// Last updated: 2026-01-15 14:12
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const promisePool = require("./DB");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

const app = express();

// ===================== CORS =====================
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false             // cannot use cookies when origin = '*'  
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ===================== CONFIG =====================
const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || "replace_with_secure_secret_in_prod";
const PORT = Number(process.env.PORT) || 5000;

// ===================== SMTP =====================
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // smtp.titan.email
  port: Number(process.env.SMTP_PORT || 465),
  secure: true, // TLS
  auth: {
    user: process.env.SMTP_USER.trim(),
    pass: process.env.SMTP_PASS.trim(),
  },
  // tls: {
  //   rejectUnauthorized: false
  // }
});

// verify transporter on startup
transporter.verify((err, success) => {
  if (err) {
    console.error("SMTP transporter verification failed:", err.message);
  } else {
    console.log("SMTP transporter is ready");
  }
});

async function sendMail(to, subject, html) {
  return transporter.sendMail({
    from: process.env.FROM_EMAIL || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}

// ===================== ROUTES =====================

// Login
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      statusCode: 400,
      message: "Email and password are required"
    });
  }

  try {
    const [users] = await promisePool.query(
      "SELECT id, name, email, password FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      return res.status(400).json({
        statusCode: 400,
        message: "Invalid email or password"
      });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        statusCode: 400,
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET_KEY,
      { expiresIn: "5h" }
    );

    return res.status(200).json({
      statusCode: 200,
      message: "Login successful",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        token
      }
    });

  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      statusCode: 500,
      message: "Login failed",
      error: error.message
    });
  }
});

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
    res.status(403).json({
      statusCode: 403,
      message: "Invalid or expired token.",
    });
  }
};

// ===================== BARCODES =====================

// Get all barcodes with pagination
app.get("/barcodes", authenticateToken, async (req, res) => {
  let { lastcount, skipcount } = req.query;

  // Convert to numbers and set defaults
  const limit = parseInt(lastcount) || 10;
  const offset = parseInt(skipcount) || 0;

  try {
    // Get total count for pagination info
    const [countRows] = await promisePool.query("SELECT COUNT(*) as total FROM barcodes");
    const totalCount = countRows[0].total;

    // Get paginated data
    const [rows] = await promisePool.query(
      "SELECT * FROM barcodes ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [limit, offset]
    );

    res.status(200).json({
      statusCode: 200,
      message: rows.length > 0 ? "Barcodes retrieved successfully" : "No barcodes found",
      data: rows,
      pagination: {
        totalCount,
        lastcount: limit,
        skipcount: offset,
        hasNextPage: offset + limit < totalCount
      }
    });
  } catch (error) {
    console.error("Get barcodes error:", error);
    res.status(500).json({ statusCode: 500, message: "Failed to retrieve barcodes", error: error.message });
  }
});

// Search barcodes
app.get("/barcodes/search", authenticateToken, async (req, res) => {
  let { query, lastcount, skipcount } = req.query;

  const limit = parseInt(lastcount) || 10;
  const offset = parseInt(skipcount) || 0;
  const searchQuery = `%${query || ""}%`;

  try {
    // Get total count for search query
    const [countRows] = await promisePool.query(
      "SELECT COUNT(*) as total FROM barcodes WHERE barcode LIKE ?",
      [searchQuery]
    );
    const totalCount = countRows[0].total;

    // Get matched data
    const [rows] = await promisePool.query(
      "SELECT * FROM barcodes WHERE barcode LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [searchQuery, limit, offset]
    );

    res.status(200).json({
      statusCode: 200,
      message: rows.length > 0 ? "Barcodes found" : "No barcodes matched your search",
      data: rows,
      pagination: {
        totalCount,
        lastcount: limit,
        skipcount: offset,
        hasNextPage: offset + limit < totalCount
      }
    });
  } catch (error) {
    console.error("Search barcodes error:", error);
    res.status(500).json({ statusCode: 500, message: "Failed to search barcodes", error: error.message });
  }
});

// Import single barcode
app.post("/barcodes/import-single", authenticateToken, async (req, res) => {
  const { barcode, barcode_grade } = req.body;
  if (!barcode || !barcode_grade) {
    return res.status(400).json({ statusCode: 400, message: "Barcode and barcode_grade are required" });
  }

  try {
    // Check if barcode already exists
    const [existing] = await promisePool.query(
      "SELECT id FROM barcodes WHERE barcode = ?",
      [barcode]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        statusCode: 400,
        message: "Barcode already exists",
        duplicate: barcode
      });
    }

    const id = crypto.randomUUID();
    await promisePool.query(
      "INSERT INTO barcodes (id, barcode, barcode_grade) VALUES (?, ?, ?)",
      [id, barcode, barcode_grade]
    );
    res.status(201).json({ statusCode: 201, message: "Barcode created successfully", id });
  } catch (error) {
    console.error("Import single barcode error:", error);
    res.status(500).json({ statusCode: 500, message: "Failed to import barcode", error: error.message });
  }
});

// Import bulk barcodes
app.post("/barcodes/import-bulk", authenticateToken, async (req, res) => {
  const { barcodes } = req.body;
  if (!Array.isArray(barcodes) || barcodes.length === 0) {
    return res.status(400).json({ statusCode: 400, message: "Valid barcodes array is required" });
  }

  try {
    const BATCH_SIZE = 1000; // Process in batches to handle large datasets
    let totalInserted = 0;
    let totalSkipped = 0;
    const allDuplicates = [];

    // Process barcodes in batches
    for (let i = 0; i < barcodes.length; i += BATCH_SIZE) {
      const batch = barcodes.slice(i, i + BATCH_SIZE);
      const barcodeValues = batch.map(b => b.barcode);

      // Check for existing barcodes in database for this batch
      const [existingBarcodes] = await promisePool.query(
        "SELECT barcode FROM barcodes WHERE barcode IN (?)",
        [barcodeValues]
      );

      const existingSet = new Set(existingBarcodes.map(row => row.barcode));

      // Filter out duplicates in this batch
      const newBarcodes = batch.filter(b => !existingSet.has(b.barcode));
      const duplicates = batch.filter(b => existingSet.has(b.barcode));

      // Track duplicates
      if (duplicates.length > 0) {
        allDuplicates.push(...duplicates.map(b => b.barcode));
        totalSkipped += duplicates.length;
      }

      // Insert only new barcodes from this batch
      if (newBarcodes.length > 0) {
        const values = newBarcodes.map(b => [crypto.randomUUID(), b.barcode, b.barcode_grade]);
        await promisePool.query(
          "INSERT INTO barcodes (id, barcode, barcode_grade) VALUES ?",
          [values]
        );
        totalInserted += newBarcodes.length;
      }

      // Log progress for large uploads
      if (barcodes.length > 10000) {
        const progress = Math.min(i + BATCH_SIZE, barcodes.length);
        console.log(`Processed ${progress}/${barcodes.length} barcodes...`);
      }
    }

    // If all barcodes are duplicates
    if (totalInserted === 0) {
      return res.status(400).json({
        statusCode: 400,
        message: "All barcodes already exist",
        duplicates: allDuplicates,
        duplicateCount: totalSkipped
      });
    }

    const response = {
      statusCode: 201,
      message: "Bulk barcodes processed successfully",
      inserted: totalInserted,
      skipped: totalSkipped,
      total: barcodes.length
    };

    // Include duplicate information if any were skipped
    if (totalSkipped > 0) {
      // Only include first 100 duplicates to avoid huge response
      response.duplicates = allDuplicates.slice(0, 100);
      if (allDuplicates.length > 100) {
        response.duplicatesShown = 100;
        response.duplicatesTotal = allDuplicates.length;
      }
      response.message = `${totalInserted} barcode(s) inserted, ${totalSkipped} duplicate(s) skipped`;
    }

    res.status(201).json(response);
  } catch (error) {
    console.error("Import bulk barcodes error:", error);
    res.status(500).json({ statusCode: 500, message: "Failed to import bulk barcodes", error: error.message });
  }
});

// Verify barcode
app.post("/barcodes/verify", async (req, res) => {
  const { barcode } = req.body;
  if (!barcode) {
    return res.status(400).json({ statusCode: 400, message: "Barcode is required" });
  }

  try {
    const [rows] = await promisePool.query(
      "SELECT * FROM barcodes WHERE barcode = ?",
      [barcode]
    );

    if (rows.length === 0) {
      return res.status(404).json({ statusCode: 404, message: "Barcode not found" });
    }

    res.status(200).json({ statusCode: 200, message: "Barcode verified", barcode: rows[0] });
  } catch (error) {
    console.error("Verify barcode error:", error);
    res.status(500).json({ statusCode: 500, message: "Failed to verify barcode", error: error.message });
  }
});

// Delete barcode
app.delete("/barcodes/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await promisePool.query(
      "DELETE FROM barcodes WHERE id = ?",
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        statusCode: 404,
        message: "Barcode not found"
      });
    }

    res.status(200).json({
      statusCode: 200,
      message: "Barcode deleted successfully"
    });
  } catch (error) {
    console.error("Delete barcode error:", error);
    res.status(500).json({
      statusCode: 500,
      message: "Failed to delete barcode",
      error: error.message
    });
  }
});

// ===================== CONTACT US =====================

app.post("/contact-us", async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ statusCode: 400, message: "Name, email, subject and message are required" });
  }

  try {
    const id = crypto.randomUUID();
    await promisePool.query(
      "INSERT INTO contact_us (id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)",
      [id, name, email, subject, message]
    );

    const html = `
      <h3>New Contact Us Message</h3>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Message:</strong> ${message}</p>
    `;

    await sendMail(
      process.env.ADMIN_EMAIL || process.env.SMTP_USER,
      `New Contact Us Inquiry: ${subject}`,
      html
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

    await sendMail(email, "Thank you for contacting us - TAEKMO", userHtml);

    res.status(200).json({ statusCode: 200, message: "Message sent successfully" });
  } catch (error) {
    console.error("Contact us error:", error);
    res.status(500).json({ statusCode: 500, message: "Failed to send message", error: error.message });
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ statusCode: 404, message: "Route not found" });
});

// START SERVER
app.listen(PORT, () => {
  console.log(`✅ Server running at port ${PORT}`);
});
