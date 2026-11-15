import mongoose from "mongoose";

/**
 * A Pledge is the donor's intent + the auto-debit mandate that backs it.
 *
 * One Pledge == one RBI e-mandate == N monthly debits (PledgeDebit rows).
 * Nothing in this collection is trusted for authorisation decisions; it is the
 * record of truth our debit engine reads before every single charge.
 */

export const PLEDGE_STATUS = {
    PENDING_AUTH: "PENDING_AUTH", // setup sent, donor has not approved mandate yet
    ACTIVE: "ACTIVE", // mandate approved, auto-debit live
    PAUSED: "PAUSED", // temporarily stopped (donor or admin)
    PAST_DUE: "PAST_DUE", // retries exhausted for a cycle
    CANCELLED: "CANCELLED", // permanently stopped
    COMPLETED: "COMPLETED", // reached the end of its schedule
    AUTH_FAILED: "AUTH_FAILED", // mandate approval failed / expired
};

const donorSnapshotSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        email: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            index: true,
        },
        phone: { type: String, required: true, trim: true, index: true },

        // PAN is required only when the donor wants an 80G certificate.
        panEncrypted: { type: String, default: null },
        panMasked: { type: String, default: null },
        taxBenefit: { type: Boolean, default: false },

        // HMAC(email) — lets us find "this donor's pledges" without exposing
        // a searchable plaintext email index.
        donorKey: { type: String, required: true, index: true },

        // Only the masked VPA is stored; the full handle never leaves the
        // gateway round trip.
        maskedVpa: { type: String, default: null },
    },
    { _id: false },
);

const consentSchema = new mongoose.Schema(
    {
        version: { type: String, required: true },
        acceptedAt: { type: Date, required: true },
        text: { type: String, required: true }, // exact wording shown to donor
        ip: { type: String, default: null },
        userAgent: { type: String, default: null },
    },
    { _id: false },
);

const pledgeSchema = new mongoose.Schema(
    {
        pledgeRef: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },

        status: {
            type: String,
            enum: Object.values(PLEDGE_STATUS),
            default: PLEDGE_STATUS.PENDING_AUTH,
            index: true,
        },

        donor: { type: donorSnapshotSchema, required: true },

        // ── Money ────────────────────────────────────────────────────────────
        // Stored in rupees to stay consistent with the existing Donation model.
        amount: { type: Number, required: true, min: 1 },
        currency: { type: String, default: "INR" },
        frequency: {
            type: String,
            enum: ["MONTHLY"],
            default: "MONTHLY",
        },
        planId: { type: String, default: "custom" },

        // ── Provider / mandate ───────────────────────────────────────────────
        provider: { type: String, default: "phonepe_autopay" },

        // Our reference, sent to PhonePe. Unique per mandate and used for every
        // status/cancel call, so it must never be regenerated.
        merchantSubscriptionId: {
            type: String,
            required: true,
            unique: true,
        },
        providerSubscriptionId: { type: String, default: null },
        providerMandateId: { type: String, default: null }, // UMN / mandate id
        maskedInstrument: { type: String, default: null }, // ****1234 / vpa
        authWorkflowType: { type: String, default: "TRANSACTION" },
        amountType: { type: String, default: "FIXED" },
        maxAmountPaise: { type: Number, required: true }, // RBI cap on debit

        // ── Schedule ─────────────────────────────────────────────────────────
        startedAt: { type: Date, default: null },
        nextDebitAt: { type: Date, default: null, index: true },
        lastDebitAt: { type: Date, default: null },
        lastNotifiedAt: { type: Date, default: null },
        expiresAt: { type: Date, required: true },

        cyclesCompleted: { type: Number, default: 0 },
        consecutiveFailures: { type: Number, default: 0 },
        totalDonatedPaise: { type: Number, default: 0 },
        totalDebitsAttempted: { type: Number, default: 0 },

        // ── Lifecycle metadata ───────────────────────────────────────────────
        consent: { type: consentSchema, required: true },
        authError: { type: String, default: null },
        pausedAt: { type: Date, default: null },
        pauseReason: { type: String, default: null },
        cancelledAt: { type: Date, default: null },
        cancelledBy: { type: String, default: null }, // donor | admin | system
        cancellationReason: { type: String, default: null },
        completedAt: { type: Date, default: null },
        adminNotes: { type: String, default: null },

        // Set when we could not confirm cancellation with the gateway; a cron
        // retries it. Local debits are already stopped at this point.
        providerCancelPending: { type: Boolean, default: false },

        // Optional client supplied idempotency key so a double-tap on "Pledge"
        // returns the same mandate instead of creating two.
        idempotencyKey: { type: String, default: null },
    },
    { timestamps: true },
);

pledgeSchema.index(
    { idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);


// Supports "how many live pledges does this donor already have?".
pledgeSchema.index({ "donor.donorKey": 1, status: 1 });

// Debit engine scan: active pledges whose next debits are due.
pledgeSchema.index({ status: 1, nextDebitAt: 1 });

const Pledge = mongoose.model("Pledge", pledgeSchema);

export default Pledge;
