// DB.js

require('dotenv').config();

const mysql = require('mysql2');

// Create a connection pool (recommended for performance)
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER,          // Default MySQL user in XAMPP is 'root'
    password: process.env.MYSQL_PASSWORD || "",      // Default password for 'root' in XAMPP is empty
    database: process.env.MYSQL_DATABASE, // The name of your database
    port: process.env.DB_PORT || 3306,
    family: 4,  // force IPv4
    waitForConnections: true,
    connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT, 10), // Limit the number of simultaneous connections
    queueLimit: parseInt(process.env.MYSQL_QUEUE_LIMIT, 10)
});

// Use the pool to get a connection
const promisePool = pool.promise();

module.exports = promisePool;
