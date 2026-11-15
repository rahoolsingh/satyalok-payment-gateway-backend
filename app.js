import express from "express";
import dotenv from "dotenv";
import {
    checkStatus,
    initiatePayment,
    initiateQuizChampPayment,
    paymentConfirmation,
    processPayment,
} from "./src/controllers/payment.controller.js";
import cors from "cors";
import connectDB from "./src/db/index.js";
import { donationReceiptEmailTemplate } from "./src/services/emailTemplate.js";
import fileUpload from "./src/middleware/fileUpload.middleware.js";
import {
    sendEmailVerificationOTP,
    verifyEmailOTP,
    verifyToken,
} from "./src/controllers/verification.controller.js";
import adminRouter from "./src/routes/admin.route.js";
import cookieParser from "cookie-parser";
import verifyApiKey from "./src/middleware/verifyApiKey.middleware.js";
import {
    initiateQuizChampS2S,
    checkQuizChampStatusS2S,
} from "./src/controllers/quizChampS2S.controller.js";

import "./src/cron/server.js";
import "./src/cron/pledge.cron.js";
import verifyAdmin from "./src/middleware/verifyAdmin.middleware.js";
import {
    getParticipantData,
    getParticipantDataBulk,
    getRollNumberWithEmail,
} from "./src/controllers/result.controller.js";
import pledgeRouter from "./src/routes/pledge.route.js";
import webhookRouter from "./src/routes/webhook.route.js";
import paymentRouter from "./src/routes/payment.route.js";
import { errorHandler } from "./src/utils/appError.util.js";
import {
    isRecurringEnabled,
    recurringUnavailableReason,
} from "./src/config/recurring.config.js";

const app = express();

dotenv.config();
app.use(
    cors({
        origin: process.env.CORS_URLS.split(","),
        methods: "GET,POST,DELETE,PATCH,PUT",
        credentials: true,
    }),
);

console.log("CORS enabled for:", process.env.CORS_URLS.split(","));

// Make the state of the recurring programme visible at boot. Safe to print:
// it only ever names a missing variable, never a value.
console.log(
    `Recurring donations: ${
        isRecurringEnabled()
            ? "enabled"
            : `coming soon (${recurringUnavailableReason()})`
    }`,
);
// Keep the raw JSON bytes for webhook HMAC verification (Razorpay signs the
// exact payload, so a re-serialised body would never match).
app.use(
    express.json({
        verify: (req, res, buf) => {
            req.rawBody = buf;
        },
    }),
);
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8000;

app.get("/", (req, res) => {
    if (req.query.text) {
        return res.send(`Hello, ${req.query.text}!`);
    }
    res.status(200).send({
        message: "Johar",
        commitVersion: process.env.RENDER_GIT_COMMIT,
        alive: true,
    });
});

app.use(cookieParser());

app.use("/admin", adminRouter);

// ─── Recurring donations (monthly pledges / UPI Autopay) ─────────────────────
app.use("/pledge", pledgeRouter);
app.use("/payment", paymentRouter);
app.use("/webhook", webhookRouter);

app.post("/order", initiatePayment);

app.post("/quizChampOrder", verifyAdmin, fileUpload, initiateQuizChampPayment);

app.post("/process-payment", processPayment);

app.get("/status", checkStatus);

app.get("/confirmation", paymentConfirmation);

app.post("/send-verification-code", sendEmailVerificationOTP);

app.post("/verify-code", verifyEmailOTP);

// get roll number with email and roll number
app.post("/get-roll-number", getRollNumberWithEmail);

app.post("/get-participant-data", getParticipantData);

app.post("/get-participant-data-bulk", getParticipantDataBulk);

// ─── Quiz Champ 2026 server-to-server endpoints (API key auth) ───────────────
app.post("/quizChampOrderS2S", verifyApiKey, initiateQuizChampS2S);
app.get("/quizChampStatusS2S", verifyApiKey, checkQuizChampStatusS2S);

// Central error handler — must be registered after every route.
app.use(errorHandler);

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
    });
});
