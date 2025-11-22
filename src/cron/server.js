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

// run at 18:30 every day
cron.schedule("30 16 * * *", runVerificationJob); // every day at 6:30 PM

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

// fucntion to check if success is true and send mail if not sent
cron.schedule("0 */6 * * *", async () => {
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

});