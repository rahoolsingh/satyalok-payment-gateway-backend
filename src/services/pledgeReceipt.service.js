import Donation from "../models/donation.model.js";
import Pledge from "../models/pledge.model.js";
import Donor from "../models/donor.model.js";
import { generateCertificate, deleteFiles } from "./generateCertificate.service.js";
import { sendMail, sendWithAttachment } from "./sendmail.service.js";
import { donationReceiptEmailTemplate } from "./emailTemplate.js";
import { decryptField } from "../utils/crypto.util.js";
import { recurringDonationTxnId } from "../utils/reference.util.js";
import { toRupees } from "../utils/money.util.js";

/**
 * Booking a successful recurring debit.
 *
 * Each successful debit becomes a first-class Donation row. That is deliberate:
 * the existing admin donation list, the 80G certificate generator and the
 * receipt email template all keep working untouched, and an auditor can read the
 * donations collection without knowing anything about mandates.
 *
 * PAN is stored encrypted (`panEncrypted`) with only a masked value in the legacy
 * `panNumber` column; the real PAN is decrypted in memory only when a
 * certificate is generated.
 */

const buildPgResponse = ({ pledge, debit, payment }) => ({
    success: true,
    code: "SUCCESS",
    message: "Payment successful",
    data: {
        merchantId: process.env.MERCHANT_ID || "AUTOPAY",
        merchantTransactionId: debit.merchantOrderId,
        transactionId: debit.providerTransactionId || payment?.transactionId || "",
        amount: debit.amountPaise, // paise — generateCertificate expects paise here
        state: "COMPLETED",
        responseCode: "SUCCESS",
        paymentInstrument: {
            type: "UPI_AUTOPAY",
            utr: debit.utr || payment?.utr || null,
            maskedAccountNumber: debit.maskedInstrument || null,
        },
        subscription: {
            merchantSubscriptionId: pledge.merchantSubscriptionId,
            cycleNumber: debit.cycleNumber,
            attempt: debit.attempt,
        },
    },
});

/**
 * Idempotently create the Donation row for a debit and email the receipt.
 *
 * Safe to call more than once (webhook + reconciliation + cron may all land
 * here): the transaction id is deterministic and `receiptSent` guards the email.
 *
 * @returns {Promise<object|null>} the Donation document
 */
const issueReceiptForDebit = async ({ pledge, debit, payment, logger = console }) => {
    const merchantTransactionId = recurringDonationTxnId({
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        cycleNumber: debit.cycleNumber,
        attempt: debit.attempt,
    });

    let donation = await Donation.findOne({ merchantTransactionId });

    if (!donation) {
        const pan = decryptField(pledge.donor.panEncrypted);

        donation = new Donation({
            name: pledge.donor.name,
            email: pledge.donor.email,
            amount: toRupees(debit.amountPaise),
            currency: pledge.currency,
            mobile: Number(String(pledge.donor.phone).replace(/\D/g, "").slice(-10)),
            merchantTransactionId,
            success: true,
            pgResponse: buildPgResponse({ pledge, debit, payment }),
            taxBenefit: Boolean(pledge.donor.taxBenefit && pan),
            panNumber: pledge.donor.panMasked || undefined,
            panEncrypted: pledge.donor.panEncrypted || null,
            // We send the receipt ourselves, so the legacy resend cron must skip
            // this row (it only re-processes rows with sendMail === false).
            sendMail: true,
            paymentMethod: pledge.provider || "phonepe_autopay",
            donationDate: debit.redeemedAt || new Date(),
            source: "recurring",
            pledgeRef: pledge.pledgeRef,
            pledgeId: pledge._id,
            cycleNumber: debit.cycleNumber,
        });

        try {
            await donation.save();
        } catch (error) {
            // Unique index race: another worker created it first.
            if (error?.code === 11000) {
                donation = await Donation.findOne({ merchantTransactionId });
            } else {
                throw error;
            }
        }
    }

    if (!donation) {
        return null;
    }

    if (!donation.receiptSent) {
        await sendReceipt({ pledge, donation, debit, logger });
    }

    // Roll up totals exactly once per debit.
    if (!debit.donationId) {
        await Pledge.updateOne(
            { _id: pledge._id },
            {
                $inc: { totalDonatedPaise: debit.amountPaise, cyclesCompleted: 1 },
                $set: { lastDebitAt: debit.redeemedAt || new Date() },
            },
        );

        await Donor.updateOne(
            { donorKey: pledge.donor.donorKey },
            {
                $inc: { totalDonatedPaise: debit.amountPaise },
                $set: { lastDonatedAt: debit.redeemedAt || new Date() },
            },
        );
    }

    return donation;
};

/**
 * Send the 80G receipt (with certificate when PAN is on file) or a plain
 * acknowledgement. Failures are logged, never thrown: a mail outage must not
 * roll back a real payment.
 */
const sendReceipt = async ({ pledge, donation, debit, logger }) => {
    try {
        const template = donationReceiptEmailTemplate(
            donation.amount,
            donation.merchantTransactionId,
            donation.createdAt,
            donation.pgResponse?.data?.transactionId,
            donation.name,
            true,
            donation.taxBenefit,
        );

        const subject = donation.taxBenefit
            ? "Tax Benefit Donation Receipt From Satyalok - A New Hope"
            : "Donation Receipt From Satyalok - A New Hope";

        const summary = `Thank you for your monthly pledge. INR ${donation.amount} has been received from ${donation.name}. Mandate ${pledge.merchantSubscriptionId}, cycle ${debit.cycleNumber}.`;

        if (donation.taxBenefit) {
            const pan = decryptField(pledge.donor.panEncrypted);

            await generateCertificate({
                ...donation.toObject(),
                panNumber: pan,
            });

            await sendWithAttachment(donation.email, subject, summary, template, [
                {
                    filename: `${donation.merchantTransactionId}.pdf`,
                    path: `./${donation.merchantTransactionId}.pdf`,
                },
            ]);

            await deleteFiles(donation.merchantTransactionId);
        } else {
            await sendMail(donation.email, subject, summary, template);
        }

        await Donation.updateOne({ _id: donation._id }, { $set: { receiptSent: true } });
        donation.receiptSent = true;
    } catch (error) {
        logger.error(
            `Receipt delivery failed for ${donation.merchantTransactionId}:`,
            error?.message || error,
        );
    }
};

export { issueReceiptForDebit, buildPgResponse };


