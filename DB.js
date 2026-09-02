// DB.js
require('dotenv').config();
const mysql = require('mysql2');

const dbName = process.env.MYSQL_DATABASE || 'taekmo';

// Automatically create database if not exists
(async () => {
    try {
        const tempConn = mysql.createConnection({
            host: process.env.MYSQL_HOST || '127.0.0.1',
            user: process.env.MYSQL_USER || 'root',
            password: process.env.MYSQL_PASSWORD || '',
            port: Number(process.env.DB_PORT) || 3306,
        }).promise();

        await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await tempConn.end();
    } catch (err) {
        // Silently ignore if connection cannot be made yet (e.g. MySQL starting up)
    }
})();

// Create a connection pool (recommended for performance)
const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: dbName,
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT, 10) || 10,
    queueLimit: parseInt(process.env.MYSQL_QUEUE_LIMIT, 10) || 0
});

// Use the pool to get a connection
const promisePool = pool.promise();

module.exports = promisePool;

