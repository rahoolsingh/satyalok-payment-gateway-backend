import crypto from "crypto";
import asyncHandler from "../utils/asyncHandler.util.js";
import PaymentEvent from "../models/paymentEvent.model.js";
import Pledge, { PLEDGE_STATUS } from "../models/pledge.model.js";
import PledgeDebit from "../models/pledgeDebit.model.js";
import {
    verifyWebhookSignature,
} from "../services/Razorpay/razorpay.service.js";
import {
    ensureCycleDebit,
    settleDebitSuccess,
    settleDebitFailure,
} from "../services/pledgeDebit.service.js";
import { settleOneTimeFromWebhook } from "../services/Razorpay/razorpayOneTime.service.js";

/**
 * Razorpay webhook receiver.
 *
 * Razorpay auto-charges subscriptions, so this webhook is the source of truth for
 * activation and for each month's debit. Signature verification uses the *raw*
 * body captured by the global JSON middleware, because re-serialising JSON would
 * change the bytes and break the HMAC.
 */

const PROVIDER = "razorpay";

const buildEventId = (headerId, type, payload) =>
    headerId ||
    crypto
        .createHash("sha256")
        .update(`${PROVIDER}|${type}|${JSON.stringify(payload)}`)
        .digest("hex");

const findPledgeForSubscription = async (subscription) => {
    if (!subscription) return null;

    if (subscription.id) {
        const byProvider = await Pledge.findOne({
            providerSubscriptionId: subscription.id,
        });
        if (byProvider) return byProvider;
    }

    const merchantSubscriptionId = subscription.notes?.merchantSubscriptionId;
    if (merchantSubscriptionId) {
        const byMerchant = await Pledge.findOne({ merchantSubscriptionId });
        if (byMerchant) return byMerchant;
    }

    const pledgeRef = subscription.notes?.pledgeRef;
    if (pledgeRef) return Pledge.findOne({ pledgeRef });

    return null;
};

const setPledgeStatus = async (pledge, nextStatus, extra = {}) => {
    if (!pledge || pledge.status === nextStatus) return pledge;

    return Pledge.findOneAndUpdate(
        { _id: pledge._id, status: { $ne: PLEDGE_STATUS.CANCELLED } },
        { $set: { status: nextStatus, ...extra } },
        { new: true },
    );
};

const activateSubscription = async (subscription) => {
    const pledge = await findPledgeForSubscription(subscription);

    if (!pledge) return { ignored: true };

    const startedAt =
        pledge.startedAt ||
        (subscription.current_start
            ? new Date(subscription.current_start * 1000)
            : new Date());

    const nextDebitAt = subscription.current_end
        ? new Date(subscription.current_end * 1000)
        : pledge.nextDebitAt;

    await Pledge.updateOne(
        { _id: pledge._id, status: { $ne: PLEDGE_STATUS.CANCELLED } },
        {
            $set: {
                status: PLEDGE_STATUS.ACTIVE,
                startedAt,
                nextDebitAt,
                providerSubscriptionId: subscription.id || pledge.providerSubscriptionId,
            },
        },
    );

    return { activated: true, pledgeRef: pledge.pledgeRef };
};

const recordCharge = async ({ subscription, payment, logger = console }) => {
    const pledge = await findPledgeForSubscription(subscription);

    if (!pledge) return { ignored: true };

    const cycleNumber =
        Number(subscription.paid_count) > 0
            ? Number(subscription.paid_count)
            : pledge.cyclesCompleted + 1;

    const scheduledFor = payment?.created_at
        ? new Date(payment.created_at * 1000)
        : new Date();

    const debit = await ensureCycleDebit({
        pledge,
        cycleNumber,
        attempt: 1,
        scheduledFor,
    });

    if (debit.status !== "SUCCESS") {
        const expectedPaise = Math.round(Number(pledge.amount) * 100);

        if (Number(payment?.amount) !== expectedPaise) {
            logger.error(
                `Razorpay amount mismatch for ${pledge.pledgeRef}: expected ${expectedPaise}, got ${payment?.amount}`,
            );
        }

        await settleDebitSuccess({
            debitId: debit._id,
            payload: {
                state: "COMPLETED",
                paymentDetails: [
                    {
                        state: "COMPLETED",
                        transactionId: payment?.id || null,
                        paymentMode: payment?.method || "razorpay",
                        rail: {
                            vpa: payment?.vpa || null,
                            utr:
                                payment?.acquirer_data?.rrn ||
                                payment?.acquirer_data?.bank_transaction_id ||
                                null,
                        },
                    },
                ],
            },
            logger,
        });
    }

    await PledgeDebit.updateOne(
        { _id: debit._id },
        { $set: { providerOrderId: payment?.order_id || null } },
    );

    await Pledge.updateOne(
        { _id: pledge._id, status: { $ne: PLEDGE_STATUS.CANCELLED } },
        {
            $set: {
                status: PLEDGE_STATUS.ACTIVE,
                consecutiveFailures: 0,
                ...(subscription.current_end
                    ? { nextDebitAt: new Date(subscription.current_end * 1000) }
                    : {}),
            },
        },
    );

    return { settled: true, cycleNumber, pledgeRef: pledge.pledgeRef };
};

/** Apply one persisted event. Exported for replays and support tooling. */
const processEvent = async ({ event, logger = console }) => {
    const body = event.payload || {};
    const type = String(event.type || "");
    const subscription = body?.payload?.subscription?.entity || null;
    const payment = body?.payload?.payment?.entity || null;

    if (type === "subscription.activated" || type === "subscription.authenticated") {
        return activateSubscription(subscription);
    }

    if (type === "subscription.charged") {
        return recordCharge({ subscription, payment, logger });
    }

    if (type === "payment.captured" || type === "order.paid") {
        // One-time checkout, or the first payment of a subscription. The latter
        // is also covered by subscription.charged; both are idempotent.
        if (payment && !payment.subscription_id) {
            return settleOneTimeFromWebhook({ payment, logger });
        }
        return { ignored: true };
    }

    if (type === "subscription.pending" || type === "subscription.halted") {
        const pledge = await findPledgeForSubscription(subscription);

        if (!pledge) return { ignored: true };

        return setPledgeStatus(pledge, PLEDGE_STATUS.PAST_DUE);
    }

    if (type === "subscription.paused") {
        const pledge = await findPledgeForSubscription(subscription);
        return setPledgeStatus(pledge, PLEDGE_STATUS.PAUSED, {
            pausedAt: new Date(),
            pauseReason: "Paused at the gateway",
        });
    }

    if (type === "subscription.resumed") {
        const pledge = await findPledgeForSubscription(subscription);
        return setPledgeStatus(pledge, PLEDGE_STATUS.ACTIVE, {
            pausedAt: null,
            pauseReason: null,
        });
    }

    if (type === "subscription.cancelled") {
        const pledge = await findPledgeForSubscription(subscription);

        if (!pledge || pledge.status === PLEDGE_STATUS.CANCELLED) {
            return { ignored: true };
        }

        await Pledge.updateOne(
            { _id: pledge._id },
            {
                $set: {
                    status: PLEDGE_STATUS.CANCELLED,
                    cancelledAt: new Date(),
                    cancelledBy: pledge.cancelledBy || "issuer",
                    cancellationReason:
                        pledge.cancellationReason || "Cancelled at the gateway",
                    providerCancelPending: false,
                },
            },
        );

        return { cancelled: true };
    }

    if (type === "subscription.completed" || type === "subscription.expired") {
        const pledge = await findPledgeForSubscription(subscription);
        return setPledgeStatus(pledge, PLEDGE_STATUS.COMPLETED, {
            completedAt: new Date(),
        });
    }

    if (type === "payment.failed") {
        // Razorpay retries a failed subscription charge itself; do not move the
        // pledge to PAST_DUE until it emits subscription.halted.
        return { noted: true };
    }

    return { ignored: true, type };
};

/** POST /webhook/razorpay */
const razorpayWebhook = asyncHandler(async (req, res) => {
    const signature = req.get("x-razorpay-signature");
    const rawBody = req.rawBody
        ? req.rawBody.toString("utf8")
        : JSON.stringify(req.body || {});

    const verified = verifyWebhookSignature({ rawBody, signature });
    const body = req.body || {};
    const type = String(body.event || "unknown");
    const subscription = body?.payload?.subscription?.entity || null;
    const payment = body?.payload?.payment?.entity || null;
    const merchantSubscriptionId = subscription?.id || null;
    const merchantOrderId = payment?.order_id || null;
    const eventId = buildEventId(
        req.get("x-razorpay-event-id"),
        type,
        body,
    );

    if (!verified) {
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
        if (!event) throw error;
    }

    // Razorpay retries non-2xx responses aggressively.
    res.status(200).json({ success: true, received: true });

    if (event.handled) return;

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
            console.error(`Razorpay webhook failed (${event.eventId}):`, error);

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

export { razorpayWebhook, processEvent, buildEventId, findPledgeForSubscription };
