// verifyUUID.js
const promisePool = require("./DB");

async function verify() {
    try {
        const [users] = await promisePool.query("SELECT id, name, email FROM users");
        console.log("Users in DB:");
        users.forEach(user => {
            console.log(`- ID: ${user.id}, Name: ${user.name}, Email: ${user.email}`);
            if (user.id.length === 36 && user.id.includes("-")) {
                console.log("  ✅ Valid UUID format");
            } else {
                console.log("  ❌ Invalid UUID format");
            }
        });

        const [barcodes] = await promisePool.query("SELECT id, barcode FROM barcodes");
        console.log("\nBarcodes in DB (should be empty after seed):", barcodes.length);
    } catch (error) {
        console.error("Verification failed:", error);
    } finally {
        process.exit();
    }
}

verify();
