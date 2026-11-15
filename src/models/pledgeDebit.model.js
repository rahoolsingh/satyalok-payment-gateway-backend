import mongoose from "mongoose";

/**
 * One row per billing attempt.
 *
 * `merchantOrderId` is deterministic (pledge + cycle + attempt) and uniquely
 * indexed. That single constraint is what stops the debit engine from charging
 * a donor twice: a duplicate insert fails instead of debiting, and the provider
 * de-duplicates retries that reuse the same order id.
 */

export const DEBIT_STATUS = {
    SCHEDULED: "SCHEDULED", // created, not yet notified to the issuer
    NOTIFYING: "NOTIFYING", // notification call in flight (worker locked)
    NOTIFIED: "NOTIFIED", // pre-debit notification sent (RBI 24h rule satisfied)
    REDEEMING: "REDEEMING", // redemption call in flight (claimed by a worker)
    SUCCESS: "SUCCESS",
    FAILED: "FAILED",
    SKIPPED: "SKIPPED", // donor skipped this cycle
    UNKNOWN: "UNKNOWN", // outcome not known — must be reconciled
};

const pledgeDebitSchema = new mongoose.Schema(
    {
        pledgeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Pledge",
            required: true,
            index: true,
        },
        pledgeRef: { type: String, required: true },
        merchantSubscriptionId: { type: String, required: true, index: true },

        // Deterministic: SLD-<pledgeSuffix>-c0001-a1
        merchantOrderId: { type: String, required: true, unique: true },

        cycleNumber: { type: Number, required: true, min: 1 },
        attempt: { type: Number, required: true, default: 1, min: 1 },

        amount: { type: Number, required: true }, // rupees
        amountPaise: { type: Number, required: true },
        currency: { type: String, default: "INR" },

        scheduledFor: { type: Date, required: true, index: true },
        status: {
            type: String,
            enum: Object.values(DEBIT_STATUS),
            default: DEBIT_STATUS.SCHEDULED,
            index: true,
        },

        // ── Notify (pre-debit) ───────────────────────────────────────────────
        notifiedAt: { type: Date, default: null },
        notifyOrderId: { type: String, default: null },
        redemptionValidAfter: { type: Date, default: null },
        redemptionValidUpto: { type: Date, default: null },

        // ── Redemption ───────────────────────────────────────────────────────
        redeemedAt: { type: Date, default: null },
        providerOrderId: { type: String, default: null },
        providerTransactionId: { type: String, default: null },
        utr: { type: String, default: null },
        maskedInstrument: { type: String, default: null },
        paymentMode: { type: String, default: null },

        errorCode: { type: String, default: null },
        errorMessage: { type: String, default: null },
        nextRetryAt: { type: Date, default: null, index: true },

        // ── Resulting donation ───────────────────────────────────────────────
        donationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Donation",
            default: null,
        },
        receiptSentAt: { type: Date, default: null },

        // ── Worker locking (prevents concurrent double redeem) ───────────────
        lockedAt: { type: Date, default: null },
        lockOwner: { type: String, default: null },

        // Last raw provider payload, kept for support/audit.
        rawStatus: { type: Object, default: null },
    },
    { timestamps: true },
);

// One attempt per cycle per attempt-number; also guards the scheduler.
pledgeDebitSchema.index(
    { pledgeId: 1, cycleNumber: 1, attempt: 1 },
    { unique: true },
);

// Reconciliation sweep: rows stuck in flight.
pledgeDebitSchema.index({ status: 1, updatedAt: 1 });

const PledgeDebit = mongoose.model("PledgeDebit", pledgeDebitSchema);

export default PledgeDebit;
