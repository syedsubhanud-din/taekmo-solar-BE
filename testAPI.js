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

        console.log("\n2. Importing single barcode with new fields...");
        const testBarcode = `TEST-${Date.now()}`;
        const importRes = await axios.post(`${BASE_URL}/barcodes/import-single`, {
            barcode: testBarcode,
            brand: "TAEKMO",
            barcode_grade: "A",
            rated_power: "650 W",
            export_country: "Pakistan"
        }, authHeaders);

        const { id } = importRes.data;
        console.log(`   ✅ Imported ID: ${id}`);

        console.log("\n3. Testing authenticity verify endpoint for imported barcode...");
        const verifyRes = await axios.post(`${BASE_URL}/barcodes/verify`, {
            barcode: testBarcode
        });
        console.log("   ✅ Verified successfully:", verifyRes.data.barcode);

        console.log("\n4. Importing bulk barcodes with all fields...");
        await axios.post(`${BASE_URL}/barcodes/import-bulk`, {
            barcodes: [
                { barcode: `BULK1-${Date.now()}`, brand: "TAEKMO", barcode_grade: "A", rated_power: "650 W", export_country: "Pakistan" },
                { barcode: `BULK2-${Date.now()}`, brand: "TAEKMO", barcode_grade: "A+", rated_power: "700 W", export_country: "Pakistan" }
            ]
        }, authHeaders);
        console.log("   ✅ Bulk import successful");

        console.log("\n5. Checking barcodes list...");
        const listRes = await axios.get(`${BASE_URL}/barcodes`, authHeaders);
        const { data } = listRes.data;
        console.log(`   ✅ Found ${data.length} barcodes`);
        data.slice(0, 3).forEach(b => {
            console.log(`   - [${b.barcode}] Brand: ${b.brand}, Grade: ${b.barcode_grade}, Power: ${b.rated_power}, Country: ${b.export_country}`);
        });

    } catch (error) {
        console.error("Test failed:", error.response?.data || error.message);
    }
}

test();

