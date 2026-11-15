import mongoose from "mongoose";

/**
 * Append-only log of every inbound gateway callback.
 *
 * Written *before* any business logic runs, keyed by a deterministic event id so
 * that provider retries (PhonePe retries callbacks) are processed exactly once.
 * Also serves as the audit trail for disputes and reconciliation.
 */
const paymentEventSchema = new mongoose.Schema(
    {
        provider: { type: String, required: true, index: true }, // phonepe_autopay

        // sha256(provider + type + payload) — the idempotency key.
        eventId: { type: String, required: true, unique: true },

        type: { type: String, required: true, index: true }, // e.g. subscription.redemption.order.completed

        merchantSubscriptionId: { type: String, default: null, index: true },
        merchantOrderId: { type: String, default: null, index: true },

        signatureVerified: { type: Boolean, default: false },
        sourceIp: { type: String, default: null },

        payload: { type: Object, required: true },

        handled: { type: Boolean, default: false, index: true },
        handledAt: { type: Date, default: null },
        attempts: { type: Number, default: 0 },
        processingError: { type: String, default: null },
    },
    { timestamps: true },
);

paymentEventSchema.index({ handled: 1, createdAt: 1 });

const PaymentEvent = mongoose.model("PaymentEvent", paymentEventSchema);

export default PaymentEvent;
