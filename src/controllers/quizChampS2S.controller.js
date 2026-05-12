/**
 * Server-to-server Quiz Champ payment controller (2026 edition).
 * Called by the Quiz Champ Backend (QCB) — no file uploads, no cookie auth.
 * Auth is via x-api-key header (verifyApiKey middleware).
 *
 * Flow:
 *  1. QCB calls POST /quizChampOrderS2S → PGS saves record, returns donation-frontend redirect URL
 *  2. Quiz-champ frontend redirects user to donation-frontend /payment-redirects/:txnId
 *  3. Donation frontend calls POST /process-payment → PhonePe
 *  4. PhonePe → PGS /confirmation → PGS calls QCB /api/payment/callback
 *  5. QCB marks participant COMPLETED, assigns roll number
 *  6. PGS redirects user to quiz-champ frontend /payment-success
 */
import dotenv from "dotenv";
import QuizChamp from "../models/quizchamp.model.js";
import { paymentStatus } from "../services/PhonePe/payment.service.js";

dotenv.config();

// Donation frontend URL — this is whitelisted with PhonePe
const frontendURL = process.env.FRONTEND_URL;

/**
 * POST /quizChampOrderS2S
 * Body: { name, mobileNumber, group, amount, merchantTransactionId, email?, class? }
 *
 * Saves a QuizChamp record and returns the donation-frontend payment-redirects URL.
 * The quiz-champ frontend redirects the user there to trigger PhonePe.
 */
export const initiateQuizChampS2S = async (req, res) => {
    const {
        name,
        mobile,
        mobileNumber,
        group,
        amount,
        merchantTransactionId,
        email,
    } = req.body;

    const mobileVal = mobile || mobileNumber;

    if (!name || !mobileVal || !group || !amount || !merchantTransactionId) {
        return res.status(400).json({
            success: false,
            message:
                "Missing required fields: name, mobileNumber, group, amount, merchantTransactionId",
        });
    }

    if (!["JUNIOR", "SENIOR"].includes(group)) {
        return res.status(400).json({
            success: false,
            message: "group must be JUNIOR or SENIOR",
        });
    }

    // Idempotency: if this txn already exists, return the same redirect URL
    const existingTxn = await QuizChamp.findOne({ merchantTransactionId });
    if (existingTxn) {
        const redirectUrl = `${frontendURL}/payment-redirects/${merchantTransactionId}`;
        return res.json({ success: true, redirectUrl, merchantTransactionId });
    }

    try {
        await QuizChamp.create({
            photo: "pending",
            name,
            fatherName: req.body.fatherName || "N/A",
            motherName: req.body.motherName || "N/A",
            email: email || `${merchantTransactionId}@quizchamp.local`,
            mobile: Number(String(mobileVal).replace(/\D/g, "")),
            group,
            class: req.body.class || "",
            schoolName: req.body.schoolName || "",
            mediumOfStudy: req.body.mediumOfStudy || "Hindi",
            aadhaarNumber: req.body.aadhaarNumber || "pending",
            aadhaarCardPhoto: "pending",
            merchantTransactionId,
            amount,
        });

        // Return the donation-frontend URL — it's whitelisted with PhonePe
        const redirectUrl = `${frontendURL}/payment-redirects/${merchantTransactionId}`;
        return res.json({ success: true, redirectUrl, merchantTransactionId });
    } catch (error) {
        console.error("Error in initiateQuizChampS2S:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to initiate payment",
        });
    }
};

/**
 * GET /quizChampStatusS2S?id={merchantTransactionId}
 * Returns the payment status for a given QC26 transaction.
 */
export const checkQuizChampStatusS2S = async (req, res) => {
    const { id } = req.query;

    if (!id) {
        return res
            .status(400)
            .json({ success: false, message: "Transaction ID is required" });
    }

    try {
        const record = await QuizChamp.findOne({ merchantTransactionId: id });
        if (!record) {
            return res
                .status(404)
                .json({ success: false, message: "Transaction not found" });
        }

        // If already confirmed in DB, return cached result without hitting PhonePe
        if (record.success) {
            return res.json({
                success: true,
                data: {
                    transactionId:
                        record.pgResponse?.data?.transactionId || id,
                    amount: record.amount,
                    state: "COMPLETED",
                },
            });
        }

        // Otherwise check live with PhonePe
        const status = await paymentStatus(id);
        return res.json(status);
    } catch (error) {
        console.error("Error in checkQuizChampStatusS2S:", error);
        return res
            .status(500)
            .json({ success: false, message: "Failed to check payment status" });
    }
};
