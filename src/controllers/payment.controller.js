import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

const saltKey = process.env.SALT_KEY;
const merchantId = process.env.MERCHANT_ID;
const frontendURL = process.env.FRONTEND_URL;

const initiatePayment = async (req, res) => {
    try {
        const { transactionId, name, amount, phone } = req.body;
        console.log(req.body);
        const data = {
            merchantId,
            merchantTransactionId: transactionId,
            name,
            amount: amount * 100, // Convert to smallest currency unit
            redirectUrl: `${frontendURL}/status?id=${transactionId}`,
            redirectMode: "POST",
            mobileNumber: phone,
            paymentInstrument: {
                type: "PAY_PAGE",
            },
        };

        const payload = JSON.stringify(data);
        const payloadMain = Buffer.from(payload).toString("base64");
        const keyIndex = 1;
        const stringToHash = `${payloadMain}/pg/v1/pay${saltKey}`;
        const sha256 = crypto
            .createHash("sha256")
            .update(stringToHash)
            .digest("hex");
        const checksum = `${sha256}###${keyIndex}`;

        const prodURL = `${process.env.PROD_URL}/pg/v1/pay`;

        const options = {
            method: "POST",
            url: prodURL,
            headers: {
                accept: "application/json",
                "Content-Type": "application/json",
                "X-VERIFY": checksum,
            },
            data: {
                request: payloadMain,
            },
        };

        const response = await axios(options);
        console.log(response.data);
        return res.json(response.data);
    } catch (error) {
        console.error("Error in /order:", error);
        return res
            .status(500)
            .json({ error: "An error occurred while processing the order." });
    }
};

const checkStatus = async (req, res) => {
    const transactionId = req.query.id;
    try {
        const keyIndex = 1;
        const stringToHash = `/pg/v1/status/${merchantId}/${transactionId}${saltKey}`;
        const sha256 = crypto
            .createHash("sha256")
            .update(stringToHash)
            .digest("hex");
        const checksum = `${sha256}###${keyIndex}`;

        const options = {
            method: "GET",
            url: `${process.env.PROD_URL}/pg/v1/status/${merchantId}/${transactionId}`,
            headers: {
                accept: "application/json",
                "Content-Type": "application/json",
                "X-VERIFY": checksum,
                "X-MERCHANT-ID": merchantId,
            },
        };

        const response = await axios(options);
        return res.json(response.data);
    } catch (error) {
        console.error("Error in /status:", error);
        return res.status(500).json({
            error: "An error occurred while checking the payment status.",
        });
    }
};

export { initiatePayment, checkStatus };
