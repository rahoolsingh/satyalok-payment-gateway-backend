import crypto from "crypto";
import Razorpay from "razorpay";
import RazorpayPlan from "../../models/razorpayPlan.model.js";
import {
    RAZORPAY_CONFIG,
    isRazorpayConfigured,
    razorpayUnavailableReason,
} from "../../config/razorpay.config.js";
import { AppError, ProviderError } from "../../utils/appError.util.js";

/**
 * Razorpay adapter.
 *
 * One-time donations use Orders + Checkout. Monthly auto-debits use Plans +
 * Subscriptions: Razorpay charges the mandate itself, and signed webhooks tell
 * us when the mandate is authorised and when each month's money arrived.
 *
 * Everything here is one thin translation of an API call. Business rules live
 * in the pledge service.
 */

let client = null;
let clientKey = null;

const getClient = () => {
    if (!isRazorpayConfigured()) {
        throw new AppError(
            "Razorpay is not configured on this deployment.",
            503,
            "RAZORPAY_NOT_CONFIGURED",
        );
    }

    const key = `${RAZORPAY_CONFIG.keyId}:${RAZORPAY_CONFIG.keySecret}`;

    if (!client || clientKey !== key) {
        client = new Razorpay({
            key_id: RAZORPAY_CONFIG.keyId,
            key_secret: RAZORPAY_CONFIG.keySecret,
        });
        clientKey = key;
    }

    return client;
};

const toProviderError = (operation, error) => {
    const status = error?.statusCode || error?.response?.status || null;
    const providerCode =
        error?.error?.code || error?.error?.reason || error?.code || "UNKNOWN";
    const providerMessage =
        error?.error?.description ||
        error?.error?.message ||
        error?.message ||
        "Razorpay request failed";

    return new ProviderError(`Razorpay ${operation} failed: ${providerMessage}`, {
        operation,
        httpStatus: status,
        providerCode,
        providerMessage,
        // No status or a 5xx may mean the request was accepted before the
        // connection broke. Callers must reconcile instead of retrying blindly.
        isAmbiguous: !status || status >= 500,
    });
};

const call = async (operation, fn) => {
    try {
        return await fn(getClient());
    } catch (error) {
        if (error instanceof AppError) throw error;
        throw toProviderError(operation, error);
    }
};

const toPaise = (rupees) => Math.round(Number(rupees) * 100);

/** Create a one-time order. Amount is always derived server-side. */
const createOrder = ({ amountPaise, receipt, notes = {} }) =>
    call("order.create", (rzp) =>
        rzp.orders.create({
            amount: amountPaise,
            currency: "INR",
            receipt,
            notes,
            // The account may also be set to auto-capture; sending it here keeps
            // behaviour explicit and consistent for this order.
            payment_capture: 1,
        }),
    );

const fetchOrder = (orderId) => call("order.fetch", (rzp) => rzp.orders.fetch(orderId));

const fetchPayment = (paymentId) =>
    call("payment.fetch", (rzp) => rzp.payments.fetch(paymentId));

const capturePayment = ({ paymentId, amountPaise, currency = "INR" }) =>
    call("payment.capture", (rzp) =>
        rzp.payments.capture(paymentId, amountPaise, currency),
    );

/**
 * Return the Razorpay plan for a monthly amount, creating it once and caching it
 * in Mongo. Plans are immutable, so a duplicate create would just litter the
 * dashboard; the unique amount index prevents that even under a race.
 */
const getOrCreatePlan = async ({ amountRupees }) => {
    const amountPaise = toPaise(amountRupees);

    const existing = await RazorpayPlan.findOne({ amountPaise });

    if (existing) return existing;

    const plan = await call("plan.create", (rzp) =>
        rzp.plans.create({
            period: "monthly",
            interval: 1,
            item: {
                name: `Satyalok monthly ₹${Number(amountRupees).toLocaleString(
                    "en-IN",
                )}`,
                amount: amountPaise,
                currency: "INR",
                description: "Monthly donation to Satyalok - A New Hope",
            },
            notes: { programme: "satyalok_monthly_giving" },
        }),
    );

    try {
        return await RazorpayPlan.create({
            amountPaise,
            currency: "INR",
            planId: plan.id,
            period: "monthly",
            interval: 1,
        });
    } catch (error) {
        if (error?.code === 11000) {
            return RazorpayPlan.findOne({ amountPaise });
        }
        throw error;
    }
};

/**
 * Create an auto-debit mandate.
 *
 * `total_count` is the number of monthly charges, matching the five-year mandate
 * validity used by the pledge model. `customer_notify: 1` makes Razorpay send
 * the RBI pre-debit notice before every charge.
 */
const createSubscription = ({ planId, totalCount, notes = {} }) =>
    call("subscription.create", (rzp) =>
        rzp.subscriptions.create({
            plan_id: planId,
            total_count: totalCount,
            quantity: 1,
            customer_notify: 1,
            notes,
        }),
    );

const fetchSubscription = (subscriptionId) =>
    call("subscription.fetch", (rzp) =>
        rzp.subscriptions.fetch(subscriptionId),
    );

const cancelSubscription = (subscriptionId) =>
    call("subscription.cancel", (rzp) =>
        rzp.subscriptions.cancel(subscriptionId, false),
    );

const pauseSubscription = (subscriptionId) =>
    call("subscription.pause", (rzp) =>
        rzp.subscriptions.pause(subscriptionId, { pause_at: "now" }),
    );

const resumeSubscription = (subscriptionId) =>
    call("subscription.resume", (rzp) =>
        rzp.subscriptions.resume(subscriptionId),
    );

const hmacHex = (value, secret) =>
    crypto.createHmac("sha256", secret).update(value, "utf8").digest("hex");

/**
 * Verify the checkout handler signature: HMAC(order_id|payment_id, key_secret).
 * This proves the payment id came from Razorpay for our order, not from a
 * tampered browser.
 */
const verifyPaymentSignature = ({ orderId, paymentId, signature }) => {
    if (!orderId || !paymentId || !signature) return false;

    const expected = hmacHex(`${orderId}|${paymentId}`, RAZORPAY_CONFIG.keySecret);

    return crypto.timingSafeEqual(
        Buffer.from(expected, "utf8"),
        Buffer.from(String(signature), "utf8").length === expected.length
            ? Buffer.from(String(signature), "utf8")
            : Buffer.alloc(expected.length, 0),
    );
};

/** Verify a webhook against the raw request body and the dashboard secret. */
const verifyWebhookSignature = ({ rawBody, signature }) => {
    if (!RAZORPAY_CONFIG.webhookSecret || !rawBody || !signature) return false;

    const expected = hmacHex(rawBody, RAZORPAY_CONFIG.webhookSecret);
    const provided = String(signature);

    if (provided.length !== expected.length) return false;

    return crypto.timingSafeEqual(
        Buffer.from(expected, "utf8"),
        Buffer.from(provided, "utf8"),
    );
};

export {
    createOrder,
    fetchOrder,
    fetchPayment,
    capturePayment,
    getOrCreatePlan,
    createSubscription,
    fetchSubscription,
    cancelSubscription,
    pauseSubscription,
    resumeSubscription,
    verifyPaymentSignature,
    verifyWebhookSignature,
    toPaise,
    toProviderError,
    razorpayUnavailableReason,
};
