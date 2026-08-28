// testAPI.js
const axios = require("axios");

const BASE_URL = "http://localhost:5000";

async function test() {
    try {
        console.log("1. Logging in...");
        const loginRes = await axios.post(`${BASE_URL}/login`, {
            email: "admin@gmail.com",
            password: "admin"
        });
        const { token } = loginRes.data.user;
        console.log("   ✅ Login successful");

        const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

        console.log("\n2. Importing single barcode...");
        const importRes = await axios.post(`${BASE_URL}/barcodes/import-single`, {
            barcode: `TEST-${Date.now()}`,
            barcode_grade: "A"
        }, authHeaders);

        const { id } = importRes.data;
        console.log(`   ✅ Imported ID: ${id}`);
        if (id.length === 36 && id.includes("-")) {
            console.log("   ✅ Valid UUID");
        } else {
            console.log("   ❌ Invalid UUID");
        }

        console.log("\n3. Importing bulk barcodes...");
        await axios.post(`${BASE_URL}/barcodes/import-bulk`, {
            barcodes: [
                { barcode: `BULK1-${Date.now()}`, barcode_grade: "B" },
                { barcode: `BULK2-${Date.now()}`, barcode_grade: "C" }
            ]
        }, authHeaders);
        console.log("   ✅ Bulk import successful");

        console.log("\n4. Checking barcodes list...");
        const listRes = await axios.get(`${BASE_URL}/barcodes`, authHeaders);
        const { data } = listRes.data;
        console.log(`   ✅ Found ${data.length} barcodes`);
        data.forEach(b => {
            console.log(`   - ${b.id}: ${b.barcode}`);
            if (b.id.length !== 36) {
                console.log(`     ❌ ID ${b.id} is NOT a UUID`);
            }
        });

    } catch (error) {
        console.error("Test failed:", error.response?.data || error.message);
    }
}

test();
