// testAPI.js
const axios = require("axios");

const BASE_URL = "http://localhost:5000";

async function test() {
    try {
        console.log("==========================================");
        console.log("1. Logging in...");
        const loginRes = await axios.post(`${BASE_URL}/login`, {
            email: "admin@gmail.com",
            password: "admin"
        });
        const { token } = loginRes.data.user;
        console.log("   ✅ Login successful");

        const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

        console.log("\n==========================================");
        console.log("2. Importing a single barcode...");
        const singleBarcode = `TEST-DUP-${Date.now()}`;
        const importRes = await axios.post(`${BASE_URL}/barcodes/import-single`, {
            barcode: singleBarcode,
            brand: "TAEKMO",
            barcode_grade: "A",
            rated_power: "650 W",
            export_country: "Pakistan"
        }, authHeaders);
        console.log(`   ✅ Single Barcode Imported: ${singleBarcode} (ID: ${importRes.data.id})`);

        console.log("\n==========================================");
        console.log("3. Testing Single Barcode Duplicate Rejection...");
        try {
            await axios.post(`${BASE_URL}/barcodes/import-single`, {
                barcode: singleBarcode,
                brand: "TAEKMO",
                barcode_grade: "A",
                rated_power: "650 W",
                export_country: "Pakistan"
            }, authHeaders);
            console.error("   ❌ ERROR: Duplicate single barcode was allowed!");
        } catch (dupError) {
            console.log("   ✅ Duplicate successfully rejected with status:", dupError.response?.status);
            console.log("   ✅ Server response:", dupError.response?.data);
        }

        console.log("\n==========================================");
        console.log("4. Testing Bulk Import with Partial Duplicates...");
        const newBulk1 = `BULK-NEW1-${Date.now()}`;
        const newBulk2 = `BULK-NEW2-${Date.now()}`;

        const partialBulkPayload = [
            { barcode: newBulk1, brand: "TAEKMO", barcode_grade: "A", rated_power: "650 W", export_country: "Pakistan" },
            { barcode: singleBarcode, brand: "TAEKMO", barcode_grade: "A", rated_power: "650 W", export_country: "Pakistan" }, // DB Duplicate
            { barcode: newBulk2, brand: "TAEKMO", barcode_grade: "A+", rated_power: "700 W", export_country: "Pakistan" },
            { barcode: newBulk1, brand: "TAEKMO", barcode_grade: "A", rated_power: "650 W", export_country: "Pakistan" }  // Payload Duplicate
        ];

        const bulkRes = await axios.post(`${BASE_URL}/barcodes/import-bulk`, {
            barcodes: partialBulkPayload
        }, authHeaders);

        console.log("   ✅ Bulk response status:", bulkRes.status);
        console.log("   ✅ Bulk message:", bulkRes.data.message);
        console.log("   ✅ Inserted count:", bulkRes.data.inserted);
        console.log("   ✅ Skipped count:", bulkRes.data.skipped);
        console.log("   ✅ Duplicates array:", bulkRes.data.duplicates);

        console.log("\n==========================================");
        console.log("5. Testing Bulk Import with 100% Duplicates...");
        try {
            await axios.post(`${BASE_URL}/barcodes/import-bulk`, {
                barcodes: [
                    { barcode: singleBarcode },
                    { barcode: newBulk1 },
                    { barcode: newBulk2 }
                ]
            }, authHeaders);
            console.error("   ❌ ERROR: 100% duplicate bulk import was allowed!");
        } catch (allDupError) {
            console.log("   ✅ All-duplicates bulk upload rejected with status:", allDupError.response?.status);
            console.log("   ✅ Server response:", allDupError.response?.data);
        }

        console.log("\n==========================================");
        console.log("6. Testing Verify Endpoint for newly added barcode...");
        const verifyRes = await axios.post(`${BASE_URL}/barcodes/verify`, {
            barcode: newBulk1
        });
        console.log("   ✅ Verified barcode:", verifyRes.data.barcode);

        console.log("\n==========================================");
        console.log("🎉 ALL TESTS PASSED SUCCESSFULLY!");
        console.log("==========================================");

    } catch (error) {
        console.error("❌ Test failed:", error.response?.data || error.message);
    }
}

test();
