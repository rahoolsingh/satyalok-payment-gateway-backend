import dotenv from "dotenv";

dotenv.config();

/**
 * Razorpay configuration.
 *
 * Two capabilities are gated independently:
 *   - one-time orders need the API key pair,
 *   - recurring subscriptions also need a webhook secret, because activation and
 *     every monthly charge are confirmed by signed webhooks.
 *
 * The frontend only ever receives the public key id; the secret never leaves the
 * server.
 */
export const RAZORPAY_CONFIG = {
    keyId: process.env.RAZORPAY_KEY_ID || null,
    keySecret: process.env.RAZORPAY_KEY_SECRET || null,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || null,
    enabled: process.env.RAZORPAY_ENABLED !== "false",
    companyName: "Satyalok - A New Hope",
    description: "Donation to Satyalok",
    themeColor: "#1f1b16",
    checkoutUrl: "https://checkout.razorpay.com/v1/checkout.js",
};

/** True when one-time payments can be created on this deployment. */
export const isRazorpayConfigured = () =>
    Boolean(
        RAZORPAY_CONFIG.enabled &&
            RAZORPAY_CONFIG.keyId &&
            RAZORPAY_CONFIG.keySecret,
    );

/** True when the auto-debit (subscription) flow can run end to end. */
export const isRazorpayRecurringEnabled = () =>
    isRazorpayConfigured() && Boolean(RAZORPAY_CONFIG.webhookSecret);

/** Operator-facing reason, never includes a secret value. */
export const razorpayUnavailableReason = () => {
    if (isRazorpayConfigured()) return null;
    if (!RAZORPAY_CONFIG.enabled) return "RAZORPAY_ENABLED is false";
    if (!RAZORPAY_CONFIG.keyId) return "RAZORPAY_KEY_ID is missing";
    return "RAZORPAY_KEY_SECRET is missing";
};

export const razorpayRecurringUnavailableReason = () => {
    const oneTimeReason = razorpayUnavailableReason();
    if (oneTimeReason) return oneTimeReason;
    if (!RAZORPAY_CONFIG.webhookSecret) {
        return "RAZORPAY_WEBHOOK_SECRET is missing";
    }
    return null;
};