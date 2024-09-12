import axios from "axios";
import crypto from "crypto";

import dotenv from "dotenv";

dotenv.config();

const saltKey = process.env.SALT_KEY;
const merchantId = process.env.MERCHANT_ID;
const backendURL = process.env.BACKEND_URL;

const createOrder = async (name, amount, phone, merchantTransactionId) => {
    try {
        const transactionId = merchantTransactionId;
        const data = {
            merchantId,
            merchantTransactionId: transactionId,
            name,
            amount: amount * 100, // Convert to smallest currency unit
            redirectUrl: `${backendURL}/confirmation?id=${transactionId}`,
            redirectMode: "REDIRECT",
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
        // console.log(response.data);
        return response.data;
    } catch (error) {
        console.error("Error in payment service:", error);
        throw error;
    }
};

const paymentStatus = async (transactionId) => {
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
        return response.data;
    } catch (error) {
        console.error("Error in payment service:", error);
        throw error;
    }
};
export { createOrder, paymentStatus };
