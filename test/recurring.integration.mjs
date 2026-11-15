/**
 * Integration tests for the recurring donation money path.
 *
 * Runs against a real (in-memory) MongoDB so unique indexes, atomic updates and
 * the idempotency guarantees are actually exercised — those are exactly the
 * things that protect donors from being charged twice.
 */

process.env.PLEDGE_ENCRYPTION_KEY = "test-encryption-key-with-32-plus-chars!!";
process.env.PLEDGE_HASH_PEPPER = "test-hash-pepper-with-32-plus-characters!";
process.env.PLEDGE_PORTAL_SECRET = "test-portal-secret-with-32-plus-chars!!!";
process.env.FRONTEND_URL = "https://donate.test";
process.env.PHONEPE_AUTOPAY_CLIENT_ID = "test-client";
process.env.PHONEPE_AUTOPAY_CLIENT_SECRET = "test-secret";
process.env.PHONEPE_AUTOPAY_WEBHOOK_USERNAME = "satyalok";
process.env.PHONEPE_AUTOPAY_WEBHOOK_PASSWORD = "super-secret";
// Port 1 refuses instantly, so receipt emails fail fast instead of hanging.
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = "1";
process.env.PLEDGE_CRON_ENABLED = "false";

// Tiny sequential harness.
//
// node:test's runner does not flush when mongodb-memory-server keeps a helper
// child process open, so this suite runs as a plain script instead. Assertions
// use node:assert, and the exit code reflects the result.
const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongo;
let Pledge;
let PledgeDebit;
let Donation;
let PLEDGE_STATUS;
let DEBIT_STATUS;
let completeSetup;
let settleDebitSuccess;
let settleDebitFailure;
let skipOpenCycle;
let cancelPledge;
let issueReceiptForDebit;
let listPledges;
let reference;
let scheduleUtil;

const silentLogger = { log() {}, warn() {}, error() {} };

const makePledge = (overrides = {}) => {
    const now = new Date();

    return new Pledge({
        pledgeRef: `PLG-TEST${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        status: PLEDGE_STATUS.PENDING_AUTH,
        donor: {
            name: "Test Donor",
            email: `donor${Math.random().toString(36).slice(2, 7)}@example.com`,
            phone: "9876543210",
            taxBenefit: false,
            donorKey: `key-${Math.random().toString(36).slice(2, 10)}`,
            maskedVpa: "do****@okhdfcbank",
        },
        amount: 500,
        currency: "INR",
        frequency: "MONTHLY",
        planId: "monthly_500",
        provider: "phonepe_autopay",
        merchantSubscriptionId: `SLSUB-TEST-${Math.random()
            .toString(36)
            .slice(2, 8)
            .toUpperCase()}`,
        amountType: "FIXED",
        maxAmountPaise: 50000,
        expiresAt: scheduleUtil.addYears(now, 5),
        consent: {
            version: "test",
            acceptedAt: now,
            text: "test consent",
        },
        ...overrides,
    });
};

const successPayload = ({ amountPaise = 50000, txnId = "TXN123" } = {}) => ({
    state: "COMPLETED",
    paymentDetails: [
        {
            state: "COMPLETED",
            transactionId: txnId,
            paymentMode: "UPI_AUTOPAY",
            rail: { type: "UPI", utr: "UTR123", vpa: "donor@okhdfcbank", umn: "UMN123" },
        },
    ],
    amount: amountPaise,
});

const setup = async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri(), { dbName: "satyalok-test" });

    Pledge = (await import("../src/models/pledge.model.js")).default;
    ({ PLEDGE_STATUS } = await import("../src/models/pledge.model.js"));
    PledgeDebit = (await import("../src/models/pledgeDebit.model.js")).default;
    ({ DEBIT_STATUS } = await import("../src/models/pledgeDebit.model.js"));
    Donation = (await import("../src/models/donation.model.js")).default;

    ({ completeSetup, cancelPledge, listPledges } = await import("../src/services/pledge.service.js"));
    ({ settleDebitSuccess, settleDebitFailure, skipOpenCycle } = await import(
        "../src/services/pledgeDebit.service.js"
    ));
    ({ issueReceiptForDebit } = await import("../src/services/pledgeReceipt.service.js"));
    reference = await import("../src/utils/reference.util.js");
    scheduleUtil = await import("../src/utils/schedule.util.js");

    await Promise.all([Pledge.init(), PledgeDebit.init(), Donation.init()]);
};

const teardown = async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    await mongo.stop();
};

const resetState = async () => {
    await Promise.all([
        Pledge.deleteMany({}),
        PledgeDebit.deleteMany({}),
        Donation.deleteMany({}),
    ]);
};

scenario("completeSetup activates the pledge and books cycle 1 as a donation", async () => {
    const pledge = await makePledge().save();

    const result = await completeSetup({
        pledge,
        payload: successPayload(),
        logger: silentLogger,
    });

    assert.equal(result.activated, true);

    const stored = await Pledge.findById(pledge._id);
    assert.equal(stored.status, PLEDGE_STATUS.ACTIVE);
    assert.equal(stored.cyclesCompleted, 1, "cycle 1 is counted");
    assert.equal(stored.totalDonatedPaise, 50000);
    assert.equal(stored.providerMandateId, "UMN123");
    assert.equal(stored.maskedInstrument, "donor@okhdfcbank");
    assert.ok(stored.nextDebitAt > new Date(), "next debit is in the future");

    const debit = await PledgeDebit.findOne({
        merchantSubscriptionId: stored.merchantSubscriptionId,
    });

    assert.equal(debit.status, DEBIT_STATUS.SUCCESS);
    assert.equal(debit.cycleNumber, 1);
    assert.ok(debit.donationId, "debit links to the donation");

    const donation = await Donation.findOne({ pledgeId: pledge._id });

    assert.ok(donation, "a Donation row exists for the debit");
    assert.equal(donation.amount, 500);
    assert.equal(donation.source, "recurring");
    assert.equal(donation.success, true);
    assert.equal(donation.paymentMethod, "phonepe_autopay");
    assert.equal(donation.sendMail, true, "legacy resend cron must skip this row");
    assert.equal(donation.pgResponse.data.amount, 50000, "paise preserved for 80G");
    assert.ok(
        debit.donationId.equals(donation._id),
        "the debit is linked to exactly this donation",
    );
    assert.match(donation.merchantTransactionId, /^HOPER-/);
});

scenario("replaying the setup webhook does not create a second donation", async () => {
    const pledge = await makePledge().save();

    await completeSetup({ pledge, payload: successPayload(), logger: silentLogger });
    await completeSetup({ pledge, payload: successPayload(), logger: silentLogger });

    const debits = await PledgeDebit.countDocuments({ pledgeId: pledge._id });
    const donations = await Donation.countDocuments({ pledgeId: pledge._id });
    const stored = await Pledge.findById(pledge._id);

    assert.equal(debits, 1);
    assert.equal(donations, 1, "exactly one donation for one real debit");
    assert.equal(stored.cyclesCompleted, 1, "totals are not double counted");
    assert.equal(stored.totalDonatedPaise, 50000);
});

scenario("settleDebitSuccess is idempotent for webhook + reconciliation races", async () => {
    const pledge = await makePledge().save();
    await completeSetup({ pledge, payload: successPayload(), logger: silentLogger });

    const debit = await PledgeDebit.findOne({ pledgeId: pledge._id });

    const results = await Promise.all([
        settleDebitSuccess({
            debitId: debit._id,
            payload: successPayload(),
            logger: silentLogger,
        }),
        settleDebitSuccess({
            debitId: debit._id,
            payload: successPayload(),
            logger: silentLogger,
        }),
    ]);

    assert.ok(
        results.some((r) => r.alreadySettled === true),
        "the second settlement is rejected by the status guard",
    );

    const stored = await Pledge.findById(pledge._id);
    assert.equal(stored.cyclesCompleted, 1);
    assert.equal(await Donation.countDocuments({ pledgeId: pledge._id }), 1);
});

scenario("a failed debit schedules a retry and keeps the pledge active", async () => {
    const pledge = await makePledge().save();
    await completeSetup({ pledge, payload: successPayload(), logger: silentLogger });

    const debit = await PledgeDebit.create({
        pledgeId: pledge._id,
        pledgeRef: pledge.pledgeRef,
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        merchantOrderId: reference.cycleOrderId({
            merchantSubscriptionId: pledge.merchantSubscriptionId,
            cycleNumber: 2,
            attempt: 1,
        }),
        cycleNumber: 2,
        attempt: 1,
        amount: 500,
        amountPaise: 50000,
        currency: "INR",
        scheduledFor: scheduleUtil.addMonthsClamped(new Date(), 1),
        status: DEBIT_STATUS.REDEEMING,
    });

    await settleDebitFailure({
        debitId: debit._id,
        errorCode: "INSUFFICIENT_FUNDS",
        errorMessage: "Not enough balance",
        logger: silentLogger,
    });

    const updatedDebit = await PledgeDebit.findById(debit._id);
    assert.equal(updatedDebit.status, DEBIT_STATUS.FAILED);
    assert.ok(updatedDebit.nextRetryAt, "a retry is scheduled");
    assert.equal(updatedDebit.errorCode, "INSUFFICIENT_FUNDS");

    const stored = await Pledge.findById(pledge._id);
    assert.equal(stored.status, PLEDGE_STATUS.ACTIVE, "still active after one failure");
    assert.equal(stored.consecutiveFailures, 1);
});


scenario("exhausting retries moves the pledge to PAST_DUE and skips to next month", async () => {
    const pledge = await makePledge().save();
    await completeSetup({ pledge, payload: successPayload(), logger: silentLogger });

    const before = await Pledge.findById(pledge._id);

    const debit = await PledgeDebit.create({
        pledgeId: pledge._id,
        pledgeRef: pledge.pledgeRef,
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        merchantOrderId: reference.cycleOrderId({
            merchantSubscriptionId: pledge.merchantSubscriptionId,
            cycleNumber: 2,
            attempt: 3,
        }),
        cycleNumber: 2,
        attempt: 3,
        amount: 500,
        amountPaise: 50000,
        currency: "INR",
        scheduledFor: before.nextDebitAt,
        status: DEBIT_STATUS.REDEEMING,
    });

    const result = await settleDebitFailure({
        debitId: debit._id,
        errorCode: "DECLINED",
        errorMessage: "Declined",
        logger: silentLogger,
    });

    assert.equal(result.exhausted, true);

    const stored = await Pledge.findById(pledge._id);
    assert.equal(stored.status, PLEDGE_STATUS.PAST_DUE);
    assert.ok(
        stored.nextDebitAt > before.nextDebitAt,
        "the failed month is skipped so next month can be attempted",
    );
});

scenario("an ambiguous timeout is parked as UNKNOWN instead of retried blindly", async () => {
    const pledge = await makePledge().save();
    await completeSetup({ pledge, payload: successPayload(), logger: silentLogger });

    const debit = await PledgeDebit.create({
        pledgeId: pledge._id,
        pledgeRef: pledge.pledgeRef,
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        merchantOrderId: reference.cycleOrderId({
            merchantSubscriptionId: pledge.merchantSubscriptionId,
            cycleNumber: 2,
            attempt: 1,
        }),
        cycleNumber: 2,
        attempt: 1,
        amount: 500,
        amountPaise: 50000,
        currency: "INR",
        scheduledFor: scheduleUtil.addMonthsClamped(new Date(), 1),
        status: DEBIT_STATUS.REDEEMING,
    });

    await settleDebitFailure({
        debitId: debit._id,
        errorCode: "TIMEOUT",
        errorMessage: "Gateway timeout",
        ambiguous: true,
        logger: silentLogger,
    });

    const updated = await PledgeDebit.findById(debit._id);

    assert.equal(updated.status, DEBIT_STATUS.UNKNOWN);
    assert.equal(updated.nextRetryAt, null, "no automatic retry for an unknown outcome");
});

scenario("skipping a cycle marks the debit SKIPPED and pushes the schedule out", async () => {
    const pledge = await makePledge().save();
    await completeSetup({ pledge, payload: successPayload(), logger: silentLogger });

    const before = await Pledge.findById(pledge._id);

    const debit = await PledgeDebit.create({
        pledgeId: pledge._id,
        pledgeRef: pledge.pledgeRef,
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        merchantOrderId: reference.cycleOrderId({
            merchantSubscriptionId: pledge.merchantSubscriptionId,
            cycleNumber: 2,
            attempt: 1,
        }),
        cycleNumber: 2,
        attempt: 1,
        amount: 500,
        amountPaise: 50000,
        currency: "INR",
        scheduledFor: before.nextDebitAt,
        status: DEBIT_STATUS.NOTIFIED,
        notifiedAt: new Date(),
    });

    const result = await skipOpenCycle({ pledge: before });

    assert.equal(result.skipped, true);
    assert.equal((await PledgeDebit.findById(debit._id)).status, DEBIT_STATUS.SKIPPED);

    const afterSkip = await Pledge.findById(pledge._id);
    assert.ok(afterSkip.nextDebitAt > before.nextDebitAt);
});

scenario("cancelling stops future debits even when the gateway call fails", async () => {
    const pledge = await makePledge().save();
    await completeSetup({ pledge, payload: successPayload(), logger: silentLogger });

    const stored = await Pledge.findById(pledge._id);

    // No reachable gateway in tests, so cancelSubscription throws.
    const cancelled = await cancelPledge({
        pledge: stored,
        by: "donor",
        reason: "Too expensive",
        logger: silentLogger,
    });

    assert.equal(cancelled.status, PLEDGE_STATUS.CANCELLED);
    assert.equal(cancelled.cancelledBy, "donor");

    const afterCancel = await Pledge.findById(pledge._id);
    assert.equal(afterCancel.status, PLEDGE_STATUS.CANCELLED);
    assert.equal(
        afterCancel.providerCancelPending,
        true,
        "a cron retries the gateway cancellation",
    );
});

scenario("the debit unique index blocks a duplicate attempt for the same cycle", async () => {
    const pledge = await makePledge().save();

    const base = {
        pledgeId: pledge._id,
        pledgeRef: pledge.pledgeRef,
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        cycleNumber: 2,
        attempt: 1,
        amount: 500,
        amountPaise: 50000,
        currency: "INR",
        scheduledFor: new Date(),
        status: DEBIT_STATUS.SCHEDULED,
    };

    const merchantOrderId = reference.cycleOrderId({
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        cycleNumber: 2,
        attempt: 1,
    });

    await PledgeDebit.create({ ...base, merchantOrderId });

    await assert.rejects(
        () => PledgeDebit.create({ ...base, merchantOrderId: `${merchantOrderId}X` }),
        (error) => error.code === 11000,
    );
});

scenario("the same idempotency key cannot create two pledges", async () => {
    const key = "idem-key-123456";

    await makePledge({ idempotencyKey: key }).save();

    await assert.rejects(
        () => makePledge({ idempotencyKey: key }).save(),
        (error) => error.code === 11000,
    );
});


scenario("pledge listing returns filtered rows plus programme stats", async () => {
    await makePledge({
        status: PLEDGE_STATUS.ACTIVE,
        amount: 500,
        donor: {
            name: "Asha Verma",
            email: "asha@example.com",
            phone: "9876543210",
            taxBenefit: false,
            donorKey: "key-asha",
            maskedVpa: "as****@okhdfcbank",
        },
    }).save();

    await makePledge({
        status: PLEDGE_STATUS.ACTIVE,
        amount: 1000,
        donor: {
            name: "Ravi Kumar",
            email: "ravi@example.com",
            phone: "9876543211",
            taxBenefit: false,
            donorKey: "key-ravi",
            maskedVpa: "ra****@okhdfcbank",
        },
    }).save();

    await makePledge({
        status: PLEDGE_STATUS.CANCELLED,
        amount: 2500,
        donor: {
            name: "Meera Nair",
            email: "meera@example.com",
            phone: "9876543212",
            taxBenefit: false,
            donorKey: "key-meera",
            maskedVpa: "me****@okhdfcbank",
        },
    }).save();

    const all = await listPledges({ page: 1, limit: 10 });
    assert.equal(all.total, 3);
    assert.equal(all.stats.statuses.ACTIVE, 2);
    assert.equal(all.stats.statuses.CANCELLED, 1);
    // Cancelled mandates must not inflate the committed monthly amount.
    assert.equal(all.stats.monthlyCommitted, 1500);

    const searched = await listPledges({ search: "ravi@example.com" });
    assert.equal(searched.total, 1);
    assert.equal(searched.items[0].donor.name, "Ravi Kumar");

    const filtered = await listPledges({ status: PLEDGE_STATUS.ACTIVE });
    assert.equal(filtered.total, 2);
});


// ── Runner ──────────────────────────────────────────────────────────────────
const main = async () => {
    let passed = 0;
    let failed = 0;

    await setup();

    for (const { name, fn } of scenarios) {
        try {
            await resetState();
            await fn();
            passed += 1;
            console.log(`  \u2714 ${name}`);
        } catch (error) {
            failed += 1;
            console.error(`  \u2716 ${name}`);
            console.error(`    ${error.message}`);
        }
    }

    await teardown();

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
};

main().catch((error) => {
    console.error('Integration suite crashed:', error);
    process.exit(1);
});
