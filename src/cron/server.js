import { paymentStatus } from "../services/PhonePe/payment.service.js";
import Donation from "../models/donation.model.js";

import QuizChamp from "../models/quizchamp.model.js";

import cron from "node-cron";
import mongoose from "mongoose";
import { paymentConfirmation } from "../controllers/payment.controller.js";
import {
    sendMobileLog,
    sendMobileLogWithError,
} from "../services/mobileLog.service.js";

// Never let a background job crash the process. On a slow database start these
// queries can time out; the next scheduled tick retries them.
const safely = (name, fn) => () =>
    fn().catch((error) => {
        console.error(`[cron] ${name} failed:`, error?.message || error);
    });

cron.schedule("0 */5 * * *", safely("verification", runVerificationJob)); // every 5 hours

// run at 18:30 every day
cron.schedule("30 16 * * *", safely("verification", runVerificationJob)); // every day at 6:30 PM

cron.schedule("0 */6 * * *", safely("donation-mail", runDonationMailResendJob), {
    timezone: "Asia/Kolkata",
}); // every 6 hours

// current time
console.log("Current time:", new Date().toLocaleString());

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
                `Invalid status response for ${record.merchantTransactionId
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

// fucntion to check if success is true and send mail if not sent: run on start and then every 6 hours
async function runDonationMailResendJob() {
    console.log("⏳ Running donation mail resend job...");
    sendMobileLog("Donation mail resend job started.");

    const donationsToResend = await Donation.find({
        success: true,
        sendMail: false,
        verifiedFailed: { $ne: true },
    });

    for (const donation of donationsToResend) {
        try {
            const reqLike = { query: { id: donation.merchantTransactionId } };
            await paymentConfirmation(reqLike, {
                redirect: (url) => console.log(`↪ Redirecting to ${url}`),
            });
            console.log(
                `📧 Resent donation email for ${donation.merchantTransactionId}`
            );
            sendMobileLog(
                `Resent donation email for ${donation.merchantTransactionId}`
            );
        } catch (err) {
            console.error(
                `❌ Error resending email for ${donation.merchantTransactionId}:`,
                err
            );
            sendMobileLogWithError(
                `Error resending email for ${donation.merchantTransactionId}: ${err.message}`
            );
        }
    }

    console.log("✅ Donation mail resend job completed.");
    sendMobileLog("Donation mail resend job completed.");

}

// Run on start, but only once Mongo is connected and never let it crash the API.
const waitForDatabase = async ({ attempts = 60, delayMs = 500 } = {}) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (mongoose.connection.readyState === 1) return true;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return false;
};

waitForDatabase()
    .then((ready) => {
        if (!ready) {
            console.error("[cron] database not ready; skipping startup mail job");
            return null;
        }
        return runDonationMailResendJob();
    })
    .catch((error) => {
        console.error("[cron] startup donation-mail job failed:", error?.message || error);
    });