import { paymentStatus } from "../services/PhonePe/payment.service.js";
import Donation from "../models/donation.model.js";

import QuizChamp from "../models/quizchamp.model.js";

import cron from "node-cron";
import { paymentConfirmation } from "../controllers/payment.controller.js";
import {
    sendMobileLog,
    sendMobileLogWithError,
} from "../services/mobileLog.service.js";

cron.schedule("0 */5 * * *", runVerificationJob); // every 5 hours

async function runVerificationJob() {
    console.log("⏳ Running payment verification retry job...");
    sendMobileLog("Payment verification retry job started.");

    const pendingDonations = await Donation.find({
        success: false,
        verifiedFailed: { $ne: true },
    });
    const pendingQuizPayments = await QuizChamp.find({
        success: false,
        verifiedFailed: { $ne: true },
    });

    const processRecord = async (record, isQuiz = false) => {
        const Model = isQuiz ? QuizChamp : Donation;

        if (record.verificationRetryCount >= 3) {
            await Model.updateOne(
                { _id: record._id },
                { verifiedFailed: true }
            );
            console.log(
                `🚫 Marked ${record.merchantTransactionId} as verifiedFailed after 3 retries`
            );
            sendMobileLog(
                `Marked ${record.merchantTransactionId} as verifiedFailed after 3 retries`
            );

            return;
        }

        let status;
        try {
            status = await paymentStatus(record.merchantTransactionId);
        } catch (err) {
            console.error(
                `❌ Error fetching status for ${record.merchantTransactionId}:`,
                err
            );

            return;
        }

        if (!status || typeof status.success === "undefined") {
            console.warn(
                `⚠️ Invalid status response for ${record.merchantTransactionId}:`,
                status
            );
            sendMobileLogWithError(
                `Invalid status response for ${
                    record.merchantTransactionId
                }: ${JSON.stringify(status)}`
            );
            return;
        }

        if (status.success) {
            const reqLike = { query: { id: record.merchantTransactionId } };
            try {
                await paymentConfirmation(reqLike, {
                    redirect: (url) => console.log(`↪ Redirecting to ${url}`),
                });
            } catch (err) {
                console.error(
                    `❌ Error in paymentConfirmation for ${record.merchantTransactionId}:`,
                    err
                );
            }
        } else {
            await Model.updateOne(
                { _id: record._id },
                { $inc: { verificationRetryCount: 1 } }
            );
            console.log(
                `🔁 Retry count increased for ${record.merchantTransactionId}`
            );
        }
    };

    for (const record of pendingDonations) {
        await processRecord(record, false);
    }

    for (const record of pendingQuizPayments) {
        await processRecord(record, true);
    }

    console.log("✅ Verification retry job completed.");
    sendMobileLog("Verification retry job completed.");
}
