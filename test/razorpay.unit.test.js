/**
 * Razorpay security primitives: checkout signature, webhook signature, provider
 * selection and amount conversion. No network calls.
 */

process.env.PLEDGE_ENCRYPTION_KEY = "test-encryption-key-with-32-plus-chars!!";
process.env.PLEDGE_HASH_PEPPER = "test-hash-pepper-with-32-plus-characters!";
process.env.PLEDGE_PORTAL_SECRET = "test-portal-secret-with-32-plus-chars!!!";
process.env.FRONTEND_URL = "https://donate.test";
process.env.RAZORPAY_KEY_ID = "rzp_test_satyalok";
process.env.RAZORPAY_KEY_SECRET = "test-razorpay-secret";
process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test_satyalok";
process.env.RAZORPAY_ENABLED = "true";

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const razorpayConfig = await import("../src/config/razorpay.config.js");
const config = await import("../src/config/recurring.config.js");
const razorpay = await import("../src/services/Razorpay/razorpay.service.js");

const hmac = (value, secret) =>
    crypto.createHmac("sha256", secret).update(value, "utf8").digest("hex");

test("razorpay: configuration is detected from keys and webhook secret", () => {
    assert.equal(razorpayConfig.isRazorpayConfigured(), true);
    assert.equal(razorpayConfig.isRazorpayRecurringEnabled(), true);
    assert.equal(razorpayConfig.razorpayUnavailableReason(), null);
    assert.equal(razorpayConfig.razorpayRecurringUnavailableReason(), null);
});

test("razorpay: checkout signature accepts only the exact order|payment HMAC", () => {
    const orderId = "order_ABC123";
    const paymentId = "pay_XYZ789";
    const signature = hmac(`${orderId}|${paymentId}`, "test-razorpay-secret");

    assert.equal(
        razorpay.verifyPaymentSignature({ orderId, paymentId, signature }),
        true,
    );
    assert.equal(
        razorpay.verifyPaymentSignature({
            orderId,
            paymentId,
            signature: hmac(`${orderId}|${paymentId}`, "wrong-secret"),
        }),
        false,
    );
    assert.equal(
        razorpay.verifyPaymentSignature({
            orderId: "order_OTHER",
            paymentId,
            signature,
        }),
        false,
    );
    assert.equal(
        razorpay.verifyPaymentSignature({ orderId, paymentId, signature: "" }),
        false,
    );
});

test("razorpay: webhook signature is verified over the raw body", () => {
    const rawBody = JSON.stringify({
        event: "subscription.charged",
        payload: { subscription: { entity: { id: "sub_123" } } },
    });
    const signature = hmac(rawBody, "whsec_test_satyalok");

    assert.equal(
        razorpay.verifyWebhookSignature({ rawBody, signature }),
        true,
    );
    assert.equal(
        razorpay.verifyWebhookSignature({
            rawBody: rawBody + " ",
            signature,
        }),
        false,
    );
    assert.equal(
        razorpay.verifyWebhookSignature({ rawBody, signature: "deadbeef" }),
        false,
    );
});

test("razorpay: monthly rupees convert to paise without float drift", () => {
    assert.equal(razorpay.toPaise(500), 50000);
    assert.equal(razorpay.toPaise(1999.99), 199999);
    assert.equal(razorpay.toPaise(0.1), 10);
});

test("razorpay: recurring provider prefers Razorpay when configured", () => {
    assert.equal(config.activeRecurringProvider(), "razorpay");
    assert.equal(config.isRecurringEnabled(), true);

    const capability = config.recurringCapability();

    assert.equal(capability.available, true);
    assert.equal(capability.provider, "razorpay");
    assert.equal(capability.requiresVpa, false);
    assert.equal(capability.providers.razorpay, true);
    assert.equal(capability.plans.length, 3);
});
