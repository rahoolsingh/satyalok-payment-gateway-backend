const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Environment variables
const saltKey = process.env.SALT_KEY;
const merchantId = process.env.MERCHANT_ID;
const port = process.env.PORT || 8000; // Default to 8000 if PORT is not set
const frontendURL = process.env.FRONTEND_URL;
const backendURL = process.env.BACKEND_URL;

// Routes
app.get('/', (req, res) => {
    res.send("Hello World!");
});

app.post('/order', async (req, res) => {
    try {
        const { transactionId, name, amount, phone } = req.body;

        const data = {
            merchantId,
            merchantTransactionId: transactionId,
            name,
            amount: amount * 100, // Convert to smallest currency unit
            redirectUrl: `${backendURL}/status?id=${transactionId}`,
            redirectMode: "POST",
            mobileNumber: phone,
            paymentInstrument: {
                type: "PAY_PAGE"
            }
        };

        const payload = JSON.stringify(data);
        const payloadMain = Buffer.from(payload).toString('base64');
        const keyIndex = 1;
        const stringToHash = `${payloadMain}/pg/v1/pay${saltKey}`;
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const checksum = `${sha256}###${keyIndex}`;

        const prodURL = "https://api.phonepe.com/apis/hermes/pg/v1/pay";

        const options = {
            method: 'POST',
            url: prodURL,
            headers: {
                accept: 'application/json',
                'Content-Type': 'application/json',
                'X-VERIFY': checksum
            },
            data: {
                request: payloadMain
            }
        };

        const response = await axios(options);
        console.log(response.data);
        return res.json(response.data);

    } catch (error) {
        console.error("Error in /order:", error);
        return res.status(500).json({ error: "An error occurred while processing the order." });
    }
});

app.post('/status', async (req, res) => {
    try {
        const merchantTransactionId = req.query.id;
        const keyIndex = 1;
        const stringToHash = `/pg/v1/status/${merchantId}/${merchantTransactionId}${saltKey}`;
        const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const checksum = `${sha256}###${keyIndex}`;

        const options = {
            method: 'GET',
            url: `https://api.phonepe.com/apis/hermes/pg/v1/status/${merchantId}/${merchantTransactionId}`,
            headers: {
                accept: 'application/json',
                'Content-Type': 'application/json',
                'X-VERIFY': checksum,
                'X-MERCHANT-ID': merchantId
            }
        };

        const response = await axios(options);
        if (response.data.success === true) {
            return res.redirect(`${frontendURL}/success`);
        } else {
            return res.redirect(`${frontendURL}/failure`);
        }
    } catch (error) {
        console.error("Error in /status:", error);
        return res.status(500).json({ error: "An error occurred while checking the payment status." });
    }
});

// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
