import crypto from "crypto";
import asyncHandler from "../utils/asyncHandler.util.js";
import PaymentEvent from "../models/paymentEvent.model.js";
import Pledge, { PLEDGE_STATUS } from "../models/pledge.model.js";
import PledgeDebit from "../models/pledgeDebit.model.js";
import { verifyWebhookSignature } from "../services/PhonePe/autopay.service.js";
import { completeSetup } from "../services/pledge.service.js";
import {
    settleDebitSuccess,
    settleDebitFailure,
} from "../services/pledgeDebit.service.js";

/**
 * PhonePe Autopay callback receiver.
 *
 * Design rules:
 *  1. Acknowledge fast (the gateway retries aggressively on non-2xx), then work.
 *  2. Persist before acting, keyed by a deterministic event id, so retries are
 *     processed exactly once.
 *  3. Never trust the callback for money: settlement is confirmed against the
 *     order status API by the service layer.
 */

const PROVIDER = "phonepe_autopay";

const buildEventId = (type, merchantOrderId, payload) =>
    crypto
        .createHash("sha256")
        .update(`${PROVIDER}|${type}|${merchantOrderId || ""}|${JSON.stringify(payload)}`)
        .digest("hex");

const isFailureType = (type) => String(type).toLowerCase().endsWith("failed");

const isSuccessType = (type) =>
    String(type).toLowerCase().endsWith("completed") ||
    String(type).toLowerCase().endsWith("success");

const extractIdentifiers = (body) => {
    const inner = body?.payload || {};

    return {
        merchantSubscriptionId:
            inner?.paymentFlow?.merchantSubscriptionId ||
            inner?.merchantSubscriptionId ||
            null,
        merchantOrderId: inner?.merchantOrderId || inner?.merchantTransactionId || null,
    };
};

/**
 * Apply one persisted event to the domain.
 * Exported so it can be replayed by reconciliation/support tooling.
 */
const processEvent = async ({ event, logger = console }) => {
    const inner = event.payload?.payload || {};
    const type = String(event.type || "");

    // ── Mandate set-up ───────────────────────────────────────────────────────
    if (type.startsWith("subscription.setup")) {
        const pledge = await Pledge.findOne({
            merchantSubscriptionId: event.merchantSubscriptionId,
        });

        if (!pledge) {
            logger.warn(
                `Webhook for unknown subscription ${event.merchantSubscriptionId}`,
            );
            return { ignored: true };
        }

        return completeSetup({ pledge, payload: inner, logger });
    }

    // ── Redemption (order and transaction level events) ─────────────────────
    if (type.startsWith("subscription.redemption")) {
        const debit = await PledgeDebit.findOne({
            merchantOrderId: event.merchantOrderId,
        });

        if (!debit) {
            logger.warn(`Webhook for unknown order ${event.merchantOrderId}`);
            return { ignored: true };
        }

        if (isSuccessType(type)) {
            return settleDebitSuccess({
                debitId: debit._id,
                payload: inner,
                logger,
            });
        }

        if (isFailureType(type)) {
            return settleDebitFailure({
                debitId: debit._id,
                errorCode: inner?.errorCode || "PAYMENT_FAILED",
                errorMessage:
                    inner?.paymentDetails?.[0]?.detailedErrorCode ||
                    "The bank declined this debit.",
                payload: inner,
                logger,
            });
        }

        // subscription.notification.completed etc. — informational only.
        return { ignored: true, type };
    }

    // ── Mandate lifecycle changes initiated by the donor at their bank ──────
    if (
        type.includes("revoked") ||
        type.includes("cancelled") ||
        type.includes("paused") ||
        type.includes("unpaused")
    ) {
        const pledge = await Pledge.findOne({
            merchantSubscriptionId: event.merchantSubscriptionId,
        });

        if (!pledge) {
            return { ignored: true };
        }

        let nextStatus = pledge.status;

        if (type.includes("revoked") || type.includes("cancelled")) {
            nextStatus = PLEDGE_STATUS.CANCELLED;
        } else if (type.includes("unpaused")) {
            nextStatus = PLEDGE_STATUS.ACTIVE;
        } else if (type.includes("paused")) {
            nextStatus = PLEDGE_STATUS.PAUSED;
        }

        if (nextStatus !== pledge.status) {
            await Pledge.updateOne(
                { _id: pledge._id },
                {
                    $set: {
                        status: nextStatus,
                        ...(nextStatus === PLEDGE_STATUS.CANCELLED
                            ? {
                                  cancelledAt: new Date(),
                                  cancelledBy: "issuer",
                                  cancellationReason: "Revoked from the UPI app",
                              }
                            : {}),
                    },
                },
            );
        }

        return { updated: nextStatus };
    }

    return { ignored: true, type };
};

/** POST /webhook/phonepe/autopay */
const phonepeAutopayWebhook = asyncHandler(async (req, res) => {
    const authorization = req.get("authorization") || null;

    const verified = verifyWebhookSignature(authorization);
    const body = req.body || {};
    const type = String(body.event || "unknown");
    const { merchantSubscriptionId, merchantOrderId } = extractIdentifiers(body);

    const eventId = buildEventId(type, merchantOrderId, body);

    if (!verified) {
        // Keep the attempt for forensics but never act on it.
        await PaymentEvent.updateOne(
            { eventId },
            {
                $setOnInsert: {
                    provider: PROVIDER,
                    eventId,
                    type,
                    merchantSubscriptionId,
                    merchantOrderId,
                    signatureVerified: false,
                    sourceIp: req.ip,
                    payload: body,
                    processingError: "Invalid signature",
                },
            },
            { upsert: true },
        ).catch(() => {});

        return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    let event;

    try {
        event = await PaymentEvent.findOneAndUpdate(
            { eventId },
            {
                $setOnInsert: {
                    provider: PROVIDER,
                    eventId,
                    type,
                    merchantSubscriptionId,
                    merchantOrderId,
                    signatureVerified: true,
                    sourceIp: req.ip,
                    payload: body,
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
    } catch (error) {
        event = await PaymentEvent.findOne({ eventId });

        if (!event) {
            throw error;
        }
    }

    // Acknowledge immediately: PhonePe retries on anything slower than a few seconds.
    res.status(200).json({ success: true, received: true });

    if (event.handled) {
        return;
    }

    setImmediate(async () => {
        try {
            await processEvent({ event });
            await PaymentEvent.updateOne(
                { _id: event._id },
                {
                    $set: { handled: true, handledAt: new Date() },
                    $inc: { attempts: 1 },
                },
            );
        } catch (error) {
            console.error(`Webhook processing failed (${event.eventId}):`, error);

            await PaymentEvent.updateOne(
                { _id: event._id },
                {
                    $inc: { attempts: 1 },
                    $set: {
                        processingError: String(error?.message || error).slice(0, 500),
                    },
                },
            ).catch(() => {});
        }
    });
});

export { phonepeAutopayWebhook, processEvent, buildEventId, extractIdentifiers };
