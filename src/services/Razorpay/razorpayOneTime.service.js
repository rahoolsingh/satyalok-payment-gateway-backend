import Donation from "../../models/donation.model.js";
import {
    createOrder,
    fetchOrder,
    fetchPayment,
    capturePayment,
    verifyPaymentSignature,
    toPaise,
} from "./razorpay.service.js";
import { AppError, ValidationError } from "../../utils/appError.util.js";
import { generateCertificate, deleteFiles } from "../generateCertificate.service.js";
import { sendMail, sendWithAttachment } from "../sendmail.service.js";
import { donationReceiptEmailTemplate } from "../emailTemplate.js";
import { RAZORPAY_CONFIG } from "../../config/razorpay.config.js";

/**
 * Razorpay one-time donations.
 *
 * The only amount used is the one validated on the server. The browser receives
 * a key id, an order id and prefilled contact details — never the key secret.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

const newOneTimeReference = () =>
    `RZP${Date.now().toString(36).toUpperCase()}${Math.random()
        .toString(36)
        .slice(2, 6)
        .toUpperCase()}`;

const validateOneTimeInput = (input) => {
    const name = String(input.name || "").trim();
    const email = String(input.email || "").trim().toLowerCase();
    const phone = String(input.phone || "").replace(/\D/g, "").slice(-10);
    const pan = String(input.pan || "").trim().toUpperCase();
    const amount = Number(input.amount);

    if (name.length < 2 || name.length > 80) {
        throw new ValidationError("Please enter your full name.");
    }
    if (!EMAIL_RE.test(email)) {
        throw new ValidationError("Please enter a valid email address.");
    }
    if (!PHONE_RE.test(phone)) {
        throw new ValidationError("Please enter a valid 10 digit Indian mobile number.");
    }
    if (!Number.isInteger(amount) || amount < 1) {
        throw new ValidationError("Please enter a valid donation amount.");
    }
    if (amount > 1000000) {
        throw new ValidationError("Please contact us for donations above ₹10,00,000.");
    }
    if (pan && !PAN_RE.test(pan)) {
        throw new ValidationError("PAN should look like ABCDE1234F.");
    }

    return { name, email, phone, amount, pan: pan || null };
};

/** POST /payment/razorpay/order */
const createRazorpayOneTimeOrder = async ({ input }) => {
    const donor = validateOneTimeInput(input);
    const merchantTransactionId = newOneTimeReference();
    const amountPaise = toPaise(donor.amount);

    const order = await createOrder({
        amountPaise,
        receipt: merchantTransactionId,
        notes: {
            donationRef: merchantTransactionId,
            donorEmail: donor.email,
        },
    });

    const donation = new Donation({
        name: donor.name,
        email: donor.email,
        amount: donor.amount,
        mobile: donor.phone,
        panNumber: donor.pan || undefined,
        taxBenefit: Boolean(donor.pan),
        merchantTransactionId,
        razorpayOrderId: order.id,
        paymentMethod: "razorpay",
        source: "one_time",
    });

    await donation.save();

    return {
        success: true,
        data: {
            provider: "razorpay",
            keyId: RAZORPAY_CONFIG.keyId,
            orderId: order.id,
            amount: amountPaise,
            currency: "INR",
            merchantTransactionId,
            name: RAZORPAY_CONFIG.companyName,
            description: RAZORPAY_CONFIG.description,
            prefill: {
                name: donor.name,
                email: donor.email,
                contact: donor.phone,
            },
            notes: { donationRef: merchantTransactionId },
            theme: { color: RAZORPAY_CONFIG.themeColor },
        },
    };
};

/** Build the legacy-compatible pgResponse shape used by receipts and /status. */
const buildPaymentResponse = (donation, payment) => ({
    success: true,
    code: "SUCCESS",
    message: "Payment successful",
    data: {
        merchantId: RAZORPAY_CONFIG.keyId,
        merchantTransactionId: donation.merchantTransactionId,
        transactionId: payment.id,
        amount: payment.amount,
        state: "COMPLETED",
        responseCode: "SUCCESS",
        paymentInstrument: {
            type: String(payment.method || "razorpay").toUpperCase(),
            utr:
                payment.acquirer_data?.rrn ||
                payment.acquirer_data?.bank_transaction_id ||
                null,
            maskedAccountNumber:
                payment.card?.last4 ? `****${payment.card.last4}` : null,
        },
    },
});

/**
 * Mark a one-time donation paid exactly once and send the receipt.
 * Safe to call from the checkout verification endpoint and from the webhook.
 */
const markOneTimeDonationPaid = async ({ donation, payment, logger = console }) => {
    if (donation.success && donation.sendMail) {
        return donation;
    }

    donation.success = true;
    donation.pgResponse = buildPaymentResponse(donation, payment);
    donation.externalTransactionId = payment.id;
    await donation.save();

    if (!donation.sendMail) {
        try {
            const emailTemplate = donationReceiptEmailTemplate(
                donation.amount,
                donation.merchantTransactionId,
                donation.createdAt,
                payment.id,
                donation.name,
                true,
                donation.taxBenefit,
            );

            if (donation.taxBenefit) {
                await generateCertificate(donation);

                await sendWithAttachment(
                    donation.email,
                    "Tax Benefit Donation Receipt From Satyalok - A New Hope",
                    `Thank you for your donation! INR ${donation.amount} has been received from ${donation.name} on ${donation.createdAt}.`,
                    emailTemplate,
                    [
                        {
                            filename: `${donation.merchantTransactionId}.pdf`,
                            path: `./${donation.merchantTransactionId}.pdf`,
                        },
                    ],
                );

                await deleteFiles(donation.merchantTransactionId);
            } else {
                await sendMail(
                    donation.email,
                    "Donation Receipt From Satyalok - A New Hope",
                    `Thank you for your donation! INR ${donation.amount} has been received from ${donation.name} on ${donation.createdAt}.`,
                    emailTemplate,
                );
            }

            donation.sendMail = true;
            await donation.save();
        } catch (error) {
            // The payment is real even if mail fails; never roll it back.
            logger.error(
                `Razorpay receipt failed for ${donation.merchantTransactionId}:`,
                error?.message || error,
            );
        }
    }

    return donation;
};

/** POST /payment/razorpay/verify — checkout handler callback. */
const verifyRazorpayOneTimePayment = async ({
    orderId,
    paymentId,
    signature,
    logger = console,
}) => {
    if (!verifyPaymentSignature({ orderId, paymentId, signature })) {
        throw new AppError("Payment signature verification failed.", 400, "BAD_SIGNATURE");
    }

    const donation = await Donation.findOne({ razorpayOrderId: orderId });

    if (!donation) {
        throw new AppError("Donation order not found.", 404, "ORDER_NOT_FOUND");
    }

    let payment = await fetchPayment(paymentId);

    if (String(payment.order_id) !== String(orderId)) {
        throw new AppError("Payment does not belong to this order.", 400, "ORDER_MISMATCH");
    }

    if (Number(payment.amount) !== toPaise(donation.amount)) {
        throw new AppError("Payment amount does not match the donation.", 400, "AMOUNT_MISMATCH");
    }

    if (payment.status === "authorized") {
        payment = await capturePayment({
            paymentId,
            amountPaise: Number(payment.amount),
        });
    }

    if (!["captured", "authorized"].includes(String(payment.status))) {
        throw new AppError(
            "The payment was not completed. Please try again.",
            409,
            "PAYMENT_NOT_COMPLETED",
        );
    }

    const order = await fetchOrder(orderId);

    if (Number(order.amount) !== toPaise(donation.amount)) {
        throw new AppError("Order amount mismatch.", 400, "AMOUNT_MISMATCH");
    }

    const updated = await markOneTimeDonationPaid({ donation, payment, logger });

    return {
        success: true,
        data: {
            merchantTransactionId: updated.merchantTransactionId,
            transactionId: payment.id,
            amount: updated.amount,
            success: true,
        },
    };
};

/** Used by the webhook: settle a donation from a captured payment entity. */
const settleOneTimeFromWebhook = async ({ payment, logger = console }) => {
    const orderId = payment?.order_id;

    if (!orderId) return { ignored: true };

    const donation = await Donation.findOne({ razorpayOrderId: orderId });

    if (!donation) return { ignored: true };

    const updated = await markOneTimeDonationPaid({ donation, payment, logger });

    return { settled: true, merchantTransactionId: updated.merchantTransactionId };
};

export {
    createRazorpayOneTimeOrder,
    verifyRazorpayOneTimePayment,
    settleOneTimeFromWebhook,
    markOneTimeDonationPaid,
    validateOneTimeInput,
};
