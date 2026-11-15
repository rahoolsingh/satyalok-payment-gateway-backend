/**
 * Unit tests for the recurring donation security primitives.
 *
 * These cover the pieces where a bug would cost money or leak data:
 * money conversion, mandate scheduling, deterministic idempotency keys,
 * field encryption, magic-link signing and the webhook signature check.
 *
 * Run: npm test
 */

// Must be set before the modules under test read them.
process.env.PLEDGE_ENCRYPTION_KEY = "test-encryption-key-with-32-plus-chars!!";
process.env.PLEDGE_HASH_PEPPER = "test-hash-pepper-with-32-plus-characters!";
process.env.PLEDGE_PORTAL_SECRET = "test-portal-secret-with-32-plus-chars!!!";
process.env.FRONTEND_URL = "https://donate.test";
process.env.PHONEPE_AUTOPAY_CLIENT_ID = "test-client";
process.env.PHONEPE_AUTOPAY_CLIENT_SECRET = "test-secret";
process.env.PHONEPE_AUTOPAY_WEBHOOK_USERNAME = "satyalok";
process.env.PHONEPE_AUTOPAY_WEBHOOK_PASSWORD = "super-secret";

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const money = await import("../src/utils/money.util.js");
const schedule = await import("../src/utils/schedule.util.js");
const reference = await import("../src/utils/reference.util.js");
const cryptoUtil = await import("../src/utils/crypto.util.js");
const magicLink = await import("../src/services/magicLink.service.js");
const config = await import("../src/config/recurring.config.js");
const autopay = await import("../src/services/PhonePe/autopay.service.js");
const webhook = await import("../src/controllers/pledgeWebhook.controller.js");
const { ValidationError } = await import("../src/utils/appError.util.js");

test("money: rupees convert to paise without float drift", () => {
    assert.equal(money.toPaise(500), 50000);
    assert.equal(money.toPaise(0.1), 10);
    assert.equal(money.toPaise(1999.99), 199999);
    assert.equal(money.toRupees(50000), 500);
    assert.equal(money.toRupees(199999), 1999.99);
});

test("money: only whole rupee recurring amounts are accepted", () => {
    assert.equal(money.isWholeRupeeAmount(500), true);
    assert.equal(money.isWholeRupeeAmount(500.5), false);
    assert.equal(money.isWholeRupeeAmount(-5), false);
    assert.equal(money.isWholeRupeeAmount("500"), true);
    assert.equal(money.isWholeRupeeAmount("abc"), false);
});

test("schedule: monthly addition clamps to the end of shorter months", () => {
    const jan31 = new Date(Date.UTC(2026, 0, 31, 4, 30));
    const feb = schedule.addMonthsClamped(jan31, 1);

    assert.equal(feb.getUTCMonth(), 1);
    assert.equal(feb.getUTCDate(), 28);
    assert.equal(feb.getUTCHours(), 4, "time of day is preserved");
});

test("schedule: month-end stays correct across a leap year", () => {
    const jan31 = new Date(Date.UTC(2028, 0, 31));
    assert.equal(schedule.addMonthsClamped(jan31, 1).getUTCDate(), 29);
});

test("schedule: mandate expiry is detected", () => {
    const expiresAt = new Date(Date.now() - 1000);
    assert.equal(schedule.isMandateExpired(expiresAt), true);
    assert.equal(schedule.isMandateExpired(new Date(Date.now() + 86_400_000)), false);
});

test("reference: cycle order ids are deterministic, short and provider-safe", () => {
    const subId = "SLSUB-MC4X9T-8KQ2WD";

    const a = reference.cycleOrderId({
        merchantSubscriptionId: subId,
        cycleNumber: 3,
        attempt: 2,
    });
    const b = reference.cycleOrderId({
        merchantSubscriptionId: subId,
        cycleNumber: 3,
        attempt: 2,
    });

    assert.equal(a, b, "same inputs must produce the same order id");
    assert.match(a, /^SLD-8KQ2WD-c0003-a02$/);
    assert.ok(a.length <= 63);
    assert.match(a, /^[A-Za-z0-9_-]+$/);

    const nextAttempt = reference.cycleOrderId({
        merchantSubscriptionId: subId,
        cycleNumber: 3,
        attempt: 3,
    });

    assert.notEqual(a, nextAttempt, "a new attempt must not reuse the order id");
});

test("crypto: PAN round-trips through AES-256-GCM", () => {
    const pan = "ABCDE1234F";
    const encrypted = cryptoUtil.encryptField(pan);

    assert.ok(encrypted.startsWith("v1:"));
    assert.equal(cryptoUtil.decryptField(encrypted), pan);
    assert.equal(cryptoUtil.maskPan(pan), "XXXXXX234F");
});

test("crypto: tampered ciphertext is rejected", () => {
    const encrypted = cryptoUtil.encryptField("ABCDE1234F");
    const parts = encrypted.split(":");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("AAAA").toString("base64")].join(":");

    assert.throws(() => cryptoUtil.decryptField(tampered));
});

test("crypto: constant time compare returns false for mismatched lengths", () => {
    assert.equal(cryptoUtil.safeCompare("abc", "abc"), true);
    assert.equal(cryptoUtil.safeCompare("abc", "abcd"), false);
    assert.equal(cryptoUtil.safeCompare(null, "abc"), false);
});

test("crypto: donor key is stable and not reversible to the email", () => {
    const one = cryptoUtil.hmacHex("donor@example.com");
    const two = cryptoUtil.hmacHex("donor@example.com");
    const other = cryptoUtil.hmacHex("other@example.com");

    assert.equal(one, two);
    assert.notEqual(one, other);
    assert.ok(!one.includes("donor"));
});


test("magic link: signed token verifies and carries the pledge id", () => {
    const token = magicLink.createPortalToken({
        pledgeId: "64f0000000000000000000aa",
        ttlSeconds: 3600,
    });

    const payload = magicLink.verifyPortalToken(token);

    assert.equal(payload.pledgeId, "64f0000000000000000000aa");
    assert.equal(payload.scope, "manage");
    assert.ok(payload.exp * 1000 > Date.now());
});

test("magic link: tampered or expired tokens are rejected", () => {
    const token = magicLink.createPortalToken({ pledgeId: "64f0000000000000000000aa" });
    const [payloadB64, signature] = token.split(".");

    const tamperedSignature =
        signature.slice(0, -2) + (signature.endsWith("AA") ? "BB" : "AA");

    assert.throws(
        () => magicLink.verifyPortalToken(`${payloadB64}.${tamperedSignature}`),
        /Invalid access token/,
    );

    const expired = magicLink.createPortalToken({
        pledgeId: "64f0000000000000000000aa",
        ttlSeconds: -10,
    });

    assert.throws(() => magicLink.verifyPortalToken(expired), /expired/i);
    assert.throws(() => magicLink.verifyPortalToken(""), /Missing access token/);
});

test("magic link: portal url points at the frontend with the token", () => {
    const url = magicLink.buildPortalUrl("64f0000000000000000000aa");

    assert.ok(url.startsWith("https://donate.test/pledge/manage/"));
    assert.ok(magicLink.verifyPortalToken(url.split("/").pop()).pledgeId);
});

test("plans: preset plan wins over a client supplied amount", () => {
    const resolved = config.resolvePlan({
        planId: "monthly_500",
        amount: 999999,
        ValidationError,
    });

    assert.equal(resolved.amount, 500);
    assert.equal(resolved.frequency, "MONTHLY");
});

test("plans: custom amount is validated against server limits", () => {
    assert.equal(
        config.resolvePlan({ planId: "custom", amount: 1500, ValidationError }).amount,
        1500,
    );

    assert.throws(
        () => config.resolvePlan({ planId: "custom", amount: 49, ValidationError }),
        /Minimum recurring amount/,
    );
    assert.throws(
        () => config.resolvePlan({ planId: "custom", amount: 250.5, ValidationError }),
        /whole number/,
    );
    assert.throws(
        () => config.resolvePlan({ planId: "nope", amount: 500, ValidationError }),
        /Unknown pledge plan/,
    );
    assert.throws(
        () => config.resolvePlan({ planId: "custom", amount: 20000, ValidationError }),
        /Maximum recurring amount|bank authentication/,
    );
});

test("autopay: web uses UPI collect, mobile uses UPI intent", () => {
    const web = autopay.buildPaymentMode({ channel: "web", vpa: "donor@okhdfcbank" });

    assert.equal(web.type, "UPI_COLLECT");
    assert.equal(web.details.vpa, "donor@okhdfcbank");

    const mobile = autopay.buildPaymentMode({ channel: "mobile" });
    assert.equal(mobile.type, "UPI_INTENT");
    assert.ok(mobile.targetApp);
});

test("autopay: endpoint paths match the documented v2 contract", () => {
    assert.equal(autopay.ENDPOINTS.setup, "/subscriptions/v2/setup");
    assert.equal(autopay.ENDPOINTS.notify, "/subscriptions/v2/notify");
    assert.equal(autopay.ENDPOINTS.redeem, "/subscriptions/v2/redeem");
    assert.equal(
        autopay.ENDPOINTS.subscriptionStatus("SLSUB-1"),
        "/subscriptions/v2/SLSUB-1/status",
    );
    assert.equal(
        autopay.ENDPOINTS.orderStatus("SLD-1"),
        "/subscriptions/v2/order/SLD-1/status",
    );
    assert.equal(
        autopay.ENDPOINTS.cancel("SLSUB-1"),
        "/subscriptions/v2/SLSUB-1/cancel",
    );
    assert.equal(autopay.HOSTS.PRODUCTION.pg, "https://api.phonepe.com/apis/pg");
});

test("autopay: webhook signature accepts only the exact sha256(username:password)", () => {
    const good = crypto
        .createHash("sha256")
        .update("satyalok:super-secret")
        .digest("hex");

    assert.equal(autopay.verifyWebhookSignature(good), true);
    assert.equal(autopay.verifyWebhookSignature(good.toUpperCase()), false);
    assert.equal(autopay.verifyWebhookSignature("deadbeef"), false);
    assert.equal(autopay.verifyWebhookSignature(null), false);
});

test("webhook: event ids are stable for retries but differ per event", () => {
    const body = {
        event: "subscription.redemption.order.completed",
        payload: { merchantOrderId: "SLD-ABC-c0001-a01", state: "COMPLETED" },
    };

    const first = webhook.buildEventId(body.event, "SLD-ABC-c0001-a01", body);
    const retry = webhook.buildEventId(body.event, "SLD-ABC-c0001-a01", body);
    const different = webhook.buildEventId(
        "subscription.redemption.order.failed",
        "SLD-ABC-c0001-a01",
        body,
    );

    assert.equal(first, retry, "a gateway retry must map to the same event");
    assert.notEqual(first, different);
});

test("webhook: identifiers are read from both payload shapes", () => {
    const identifiers = webhook.extractIdentifiers({
        event: "subscription.setup.completed",
        payload: {
            merchantOrderId: "SLA-1-c0001",
            paymentFlow: { merchantSubscriptionId: "SLSUB-1" },
        },
    });

    assert.equal(identifiers.merchantOrderId, "SLA-1-c0001");
    assert.equal(identifiers.merchantSubscriptionId, "SLSUB-1");
});
