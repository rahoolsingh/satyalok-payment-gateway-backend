import PledgeDebit, { DEBIT_STATUS } from "../models/pledgeDebit.model.js";
import Pledge, { PLEDGE_STATUS } from "../models/pledge.model.js";
import { RECURRING_RULES } from "../config/recurring.config.js";
import { cycleOrderId } from "../utils/reference.util.js";
import { toPaise } from "../utils/money.util.js";
import { addDays, addHours, addMonthsClamped } from "../utils/schedule.util.js";
import {
    notifyRedemption,
    redeem,
    getRedemptionOrderStatus,
} from "./PhonePe/autopay.service.js";
import { issueReceiptForDebit } from "./pledgeReceipt.service.js";
import {
    sendPledgeDebitNotice,
    sendPledgeDebitFailure,
    sendPledgePastDue,
} from "./pledgeEmail.service.js";

/**
 * The debit engine.
 *
 * Three workers cooperate:
 *   1. planAndNotify — decides what is due, creates exactly one open debit per
 *      cycle, and sends the RBI-mandated pre-debit notification.
 *   2. executeRedemptions — 24h later, claims a notified debit and charges it.
 *   3. reconcile — resolves anything stuck in flight by asking the gateway.
 *
 * Every state change is an atomic conditional update, so running several API
 * instances (or overlapping cron ticks) can never double charge a donor.
 */

const INSTANCE_ID = `${process.env.HOSTNAME || "local"}-${process.pid}`;
const LOCK_TTL_MS = 10 * 60 * 1000;

const isLockFree = () => ({
    $or: [{ lockedAt: null }, { lockedAt: { $lt: new Date(Date.now() - LOCK_TTL_MS) } }],
});

/** Atomic claim: only the first worker to flip the status wins. */
const claimDebit = async (debit, statuses, nextStatus) =>
    PledgeDebit.findOneAndUpdate(
        { _id: debit._id, status: { $in: statuses }, ...isLockFree() },
        { $set: { status: nextStatus, lockedAt: new Date(), lockOwner: INSTANCE_ID } },
        { new: true },
    );

const releaseDebit = (debitId) =>
    PledgeDebit.updateOne({ _id: debitId }, { $set: { lockedAt: null, lockOwner: null } });

/**
 * Create (or reuse) the open debit for a pledge's current cycle.
 *
 * The deterministic order id + unique index makes this safe to call from
 * multiple workers at once: the loser gets a duplicate-key error and re-reads.
 */
const ensureCycleDebit = async ({ pledge, cycleNumber, attempt = 1, scheduledFor }) => {
    const merchantOrderId = cycleOrderId({
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        cycleNumber,
        attempt,
    });

    try {
        return await PledgeDebit.create({
            pledgeId: pledge._id,
            pledgeRef: pledge.pledgeRef,
            merchantSubscriptionId: pledge.merchantSubscriptionId,
            merchantOrderId,
            cycleNumber,
            attempt,
            amount: pledge.amount,
            amountPaise: toPaise(pledge.amount),
            currency: pledge.currency,
            scheduledFor,
            status: DEBIT_STATUS.SCHEDULED,
        });
    } catch (error) {
        if (error?.code === 11000) {
            return PledgeDebit.findOne({ merchantOrderId });
        }
        throw error;
    }
};

/**
 * Work out which debit (if any) the pledge needs right now.
 * Returns `null` when the pledge is not due yet.
 */
const selectDueDebit = async (pledge, now) => {
    const notifyAt = addHours(pledge.nextDebitAt, -RECURRING_RULES.notifyLeadHours);

    if (notifyAt > now) {
        return null;
    }

    const cycleNumber = pledge.cyclesCompleted + 1;
    const latest = await PledgeDebit.findOne({
        pledgeId: pledge._id,
        cycleNumber,
    }).sort({ attempt: -1 });

    if (!latest) {
        return ensureCycleDebit({
            pledge,
            cycleNumber,
            attempt: 1,
            scheduledFor: pledge.nextDebitAt,
        });
    }

    switch (latest.status) {
        case DEBIT_STATUS.SUCCESS:
        case DEBIT_STATUS.SKIPPED:
            // The schedule advances on success; nothing left for this cycle.
            return null;

        case DEBIT_STATUS.SCHEDULED:
        case DEBIT_STATUS.NOTIFIED:
        case DEBIT_STATUS.REDEEMING:
            return latest;

        case DEBIT_STATUS.FAILED:
        case DEBIT_STATUS.UNKNOWN: {
            if (latest.attempt >= RECURRING_RULES.maxRetriesPerCycle) {
                return null;
            }

            const retryAt =
                latest.nextRetryAt ||
                addDays(
                    latest.scheduledFor,
                    RECURRING_RULES.retryOffsetsDays[latest.attempt - 1] || 1,
                );

            if (addHours(retryAt, -RECURRING_RULES.notifyLeadHours) > now) {
                return null;
            }

            return ensureCycleDebit({
                pledge,
                cycleNumber,
                attempt: latest.attempt + 1,
                scheduledFor: retryAt,
            });
        }

        default:
            return null;
    }
};

/** Translate a PhonePe order/status payload into SUCCESS | FAILED | PENDING. */
const classifyOrderStatus = (payload) => {
    const payment = Array.isArray(payload?.paymentDetails)
        ? payload.paymentDetails[0]
        : null;

    const orderState = String(payload?.state || "").toUpperCase();
    const txnState = String(payment?.state || "").toUpperCase();

    if (txnState === "COMPLETED" || orderState === "COMPLETED") {
        return { outcome: "SUCCESS", payment };
    }

    if (txnState === "FAILED" || orderState === "FAILED") {
        return {
            outcome: "FAILED",
            payment,
            errorCode: payment?.errorCode || payload?.errorCode || "PAYMENT_FAILED",
            errorMessage:
                payment?.detailedErrorCode ||
                payload?.message ||
                "The bank declined this debit.",
        };
    }

    return { outcome: "PENDING", payment };
};

/** Extract the useful bits from a provider payment detail object. */
const extractPaymentMeta = (payment) => ({
    providerTransactionId: payment?.transactionId || null,
    utr: payment?.rail?.utr || null,
    maskedInstrument:
        payment?.rail?.vpa || payment?.instrument?.maskedAccountNumber || null,
    paymentMode: payment?.paymentMode || null,
});

/**
 * Mark a debit as paid and book the donation.
 *
 * The guard `status: { $ne: SUCCESS }` makes this idempotent, so a webhook, the
 * post-redeem status check and the reconciliation sweep can all call it.
 */
const settleDebitSuccess = async ({ debitId, payload, logger = console }) => {
    const payment = Array.isArray(payload?.paymentDetails)
        ? payload.paymentDetails[0]
        : null;

    const settled = await PledgeDebit.findOneAndUpdate(
        { _id: debitId, status: { $ne: DEBIT_STATUS.SUCCESS } },
        {
            $set: {
                status: DEBIT_STATUS.SUCCESS,
                redeemedAt: new Date(),
                ...extractPaymentMeta(payment),
                rawStatus: payload || null,
                lockedAt: null,
                lockOwner: null,
                errorCode: null,
                errorMessage: null,
            },
        },
        { new: true },
    );

    if (!settled) {
        return { alreadySettled: true };
    }

    const pledge = await Pledge.findById(settled.pledgeId);

    if (!pledge) {
        logger.error(`Pledge missing for settled debit ${settled.merchantOrderId}`);
        return { alreadySettled: false, pledge: null };
    }

    const donation = await issueReceiptForDebit({
        pledge,
        debit: settled,
        payment,
        logger,
    });

    await PledgeDebit.updateOne(
        { _id: settled._id },
        {
            $set: {
                donationId: donation?._id || null,
                receiptSentAt: donation?.receiptSent ? new Date() : null,
            },
        },
    );

    // Advance the schedule from the *scheduled* date (not "now") so a slow
    // retry never permanently shifts a donor's debit date.
    const nextDebitAt = addMonthsClamped(settled.scheduledFor, 1);
    const mandateDone = !pledge.expiresAt || nextDebitAt > new Date(pledge.expiresAt);

    await Pledge.updateOne(
        { _id: pledge._id },
        {
            $set: {
                status: mandateDone ? PLEDGE_STATUS.COMPLETED : PLEDGE_STATUS.ACTIVE,
                nextDebitAt,
                consecutiveFailures: 0,
                lastDebitAt: settled.redeemedAt,
                ...(mandateDone ? { completedAt: new Date() } : {}),
            },
        },
    );

    return { alreadySettled: false, pledge, donation };
};

/**
 * Mark a debit as failed, schedule a retry, or close out the pledge.
 */
const settleDebitFailure = async ({
    debitId,
    errorCode = "PAYMENT_FAILED",
    errorMessage = "The bank declined this debit.",
    payload = null,
    ambiguous = false,
    logger = console,
}) => {
    const debit = await PledgeDebit.findById(debitId);

    if (!debit || debit.status === DEBIT_STATUS.SUCCESS) {
        return { ignored: true };
    }

    // Ambiguous outcome (timeout / 5xx): never retry blindly. Park the debit so
    // the reconciliation sweep can ask the gateway what really happened.
    if (ambiguous) {
        await PledgeDebit.updateOne(
            { _id: debitId },
            {
                $set: {
                    status: DEBIT_STATUS.UNKNOWN,
                    errorCode,
                    errorMessage,
                    rawStatus: payload || null,
                    lockedAt: null,
                    lockOwner: null,
                },
            },
        );

        return { status: DEBIT_STATUS.UNKNOWN };
    }

    const exhausted = debit.attempt >= RECURRING_RULES.maxRetriesPerCycle;
    const retryOffset = RECURRING_RULES.retryOffsetsDays[debit.attempt - 1] || 1;
    const nextRetryAt = addDays(debit.scheduledFor, retryOffset);

    await PledgeDebit.updateOne(
        { _id: debitId },
        {
            $set: {
                status: DEBIT_STATUS.FAILED,
                errorCode,
                errorMessage,
                rawStatus: payload || null,
                nextRetryAt: exhausted ? null : nextRetryAt,
                lockedAt: null,
                lockOwner: null,
            },
        },
    );

    const pledge = await Pledge.findById(debit.pledgeId);

    if (!pledge) {
        return { status: DEBIT_STATUS.FAILED };
    }

    if (exhausted) {
        // Skip the failed month and try the next one; the mandate itself is
        // still valid, so a recovered account can resume automatically.
        await Pledge.updateOne(
            { _id: pledge._id },
            {
                $inc: { consecutiveFailures: 1 },
                $set: {
                    status: PLEDGE_STATUS.PAST_DUE,
                    nextDebitAt: addMonthsClamped(debit.scheduledFor, 1),
                },
            },
        );

        await sendPledgePastDue({ pledge, debit, errorMessage, logger }).catch(() => {});
    } else {
        await Pledge.updateOne(
            { _id: pledge._id },
            { $inc: { consecutiveFailures: 1 } },
        );

        await sendPledgeDebitFailure({ pledge, debit, errorMessage, logger }).catch(
            () => {},
        );
    }

    return { status: DEBIT_STATUS.FAILED, exhausted };
};

/** Send the pre-debit notification for a scheduled debit. */
const notifyDebit = async ({ pledge, debit, logger = console }) => {
    const claimed = await claimDebit(debit, [DEBIT_STATUS.SCHEDULED], DEBIT_STATUS.NOTIFYING);

    if (!claimed) {
        return { skipped: true };
    }

    const now = new Date();

    try {
        const response = await notifyRedemption({
            merchantOrderId: claimed.merchantOrderId,
            merchantSubscriptionId: claimed.merchantSubscriptionId,
            amountPaise: claimed.amountPaise,
            expireAt: addHours(claimed.scheduledFor, RECURRING_RULES.redemptionWindowHours).getTime(),
            metaInfo: {
                udf1: pledge.pledgeRef,
                udf2: `cycle-${claimed.cycleNumber}`,
                udf3: `attempt-${claimed.attempt}`,
            },
        });

        const notifiedAt = new Date();

        await PledgeDebit.updateOne(
            { _id: claimed._id },
            {
                $set: {
                    status: DEBIT_STATUS.NOTIFIED,
                    notifiedAt,
                    notifyOrderId: response?.orderId || null,
                    // Hard floor: the RBI requires 24h between notice and debit.
                    redemptionValidAfter: addHours(notifiedAt, 24),
                    redemptionValidUpto: addHours(
                        claimed.scheduledFor,
                        RECURRING_RULES.redemptionWindowHours,
                    ),
                    lockedAt: null,
                    lockOwner: null,
                },
            },
        );

        await Pledge.updateOne(
            { _id: pledge._id },
            { $set: { lastNotifiedAt: notifiedAt } },
        );

        await sendPledgeDebitNotice({ pledge, debit: claimed, logger }).catch(() => {});

        return { notified: true };
    } catch (error) {
        logger.error(
            `Pre-debit notification failed for ${claimed.merchantOrderId}:`,
            error?.message || error,
        );

        await PledgeDebit.updateOne(
            { _id: claimed._id },
            {
                $set: {
                    status: DEBIT_STATUS.SCHEDULED,
                    errorCode: error?.meta?.providerCode || "NOTIFY_FAILED",
                    errorMessage: error?.message || "Notification failed",
                    lockedAt: null,
                    lockOwner: null,
                },
            },
        );

        return { notified: false };
    }
};

/**
 * Planner + notifier. Runs hourly.
 * Only touches pledges that are actually due, and never creates a second open
 * debit for the same cycle.
 */
const planAndNotify = async ({ now = new Date(), limit = 200, logger = console } = {}) => {
    const duePledges = await Pledge.find({
        status: { $in: [PLEDGE_STATUS.ACTIVE, PLEDGE_STATUS.PAST_DUE] },
        nextDebitAt: { $lte: addHours(now, RECURRING_RULES.notifyLeadHours) },
    })
        .sort({ nextDebitAt: 1 })
        .limit(limit);

    const summary = { scanned: duePledges.length, notified: 0, skipped: 0, failed: 0 };

    for (const pledge of duePledges) {
        try {
            if (!pledge.expiresAt || new Date(pledge.expiresAt) <= now) {
                await Pledge.updateOne(
                    { _id: pledge._id },
                    {
                        $set: {
                            status: PLEDGE_STATUS.COMPLETED,
                            completedAt: now,
                        },
                    },
                );
                summary.skipped += 1;
                continue;
            }

            const debit = await selectDueDebit(pledge, now);

            if (!debit || debit.status !== DEBIT_STATUS.SCHEDULED) {
                summary.skipped += 1;
                continue;
            }

            const result = await notifyDebit({ pledge, debit, logger });

            if (result.notified) {
                summary.notified += 1;
            } else if (result.skipped) {
                summary.skipped += 1;
            } else {
                summary.failed += 1;
            }
        } catch (error) {
            summary.failed += 1;
            logger.error(`Planner error for pledge ${pledge.pledgeRef}:`, error);
        }
    }

    return summary;
};

/** Apply a provider order-status payload to a debit. */
const settleFromStatus = async ({ debitId, payload, logger = console }) => {
    const { outcome, errorCode, errorMessage } = classifyOrderStatus(payload);

    if (outcome === "SUCCESS") {
        return settleDebitSuccess({ debitId, payload, logger });
    }

    if (outcome === "FAILED") {
        return settleDebitFailure({
            debitId,
            errorCode,
            errorMessage,
            payload,
            logger,
        });
    }

    // Still pending at the bank. Keep it in REDEEMING so the reconciliation
    // sweep polls again instead of firing a second debit.
    await PledgeDebit.updateOne(
        { _id: debitId },
        {
            $set: {
                status: DEBIT_STATUS.REDEEMING,
                rawStatus: payload || null,
                lockedAt: null,
                lockOwner: null,
            },
        },
    );

    return { status: "PENDING" };
};

/**
 * Execute the redemption for every notified debit whose 24h notice has elapsed.
 */
const executeRedemptions = async ({ now = new Date(), limit = 100, logger = console } = {}) => {
    const candidates = await PledgeDebit.find({
        status: DEBIT_STATUS.NOTIFIED,
        notifiedAt: { $lte: addHours(now, -24) },
        scheduledFor: { $lte: addHours(now, 24) },
    })
        .sort({ scheduledFor: 1 })
        .limit(limit);

    const summary = { scanned: candidates.length, redeemed: 0, failed: 0, skipped: 0 };

    for (const candidate of candidates) {
        try {
            if (candidate.redemptionValidUpto && candidate.redemptionValidUpto < now) {
                // The notification window lapsed without a debit; treat it as a
                // normal failure so the retry ladder notifies again.
                await settleDebitFailure({
                    debitId: candidate._id,
                    errorCode: "NOTIFICATION_EXPIRED",
                    errorMessage:
                        "The pre-debit notification expired before the debit could be executed.",
                    logger,
                });
                summary.failed += 1;
                continue;
            }

            const claimed = await claimDebit(
                candidate,
                [DEBIT_STATUS.NOTIFIED],
                DEBIT_STATUS.REDEEMING,
            );

            if (!claimed) {
                summary.skipped += 1;
                continue;
            }

            const pledge = await Pledge.findById(claimed.pledgeId);

            if (!pledge) {
                await releaseDebit(claimed._id);
                summary.skipped += 1;
                continue;
            }

            if (
                pledge.status === PLEDGE_STATUS.CANCELLED ||
                pledge.status === PLEDGE_STATUS.PAUSED ||
                pledge.status === PLEDGE_STATUS.COMPLETED
            ) {
                await PledgeDebit.updateOne(
                    { _id: claimed._id },
                    {
                        $set: {
                            status: DEBIT_STATUS.SKIPPED,
                            errorCode: "PLEDGE_NOT_ACTIVE",
                            errorMessage: `Pledge is ${pledge.status}`,
                            lockedAt: null,
                            lockOwner: null,
                        },
                    },
                );
                summary.skipped += 1;
                continue;
            }

            await redeemAndSettle({ claimed, logger });

            summary.redeemed += 1;
        } catch (error) {
            summary.failed += 1;
            logger.error(
                `Redemption worker error for ${candidate.merchantOrderId}:`,
                error,
            );
        }
    }

    return summary;
};
/**
 * Fire the debit and settle the outcome.
 *
 * We always confirm with the status API rather than trusting the redeem
 * response: the gateway can return 200 while the bank is still deciding.
 */
const redeemAndSettle = async ({ claimed, logger = console }) => {
    try {
        await redeem({ merchantOrderId: claimed.merchantOrderId });
    } catch (error) {
        await settleDebitFailure({
            debitId: claimed._id,
            errorCode: error?.meta?.providerCode || "REDEEM_FAILED",
            errorMessage: error?.message || "Redemption failed",
            ambiguous: Boolean(error?.meta?.isAmbiguous),
            logger,
        });

        return { status: "FAILED" };
    }

    let statusPayload = null;

    try {
        statusPayload = await getRedemptionOrderStatus(claimed.merchantOrderId);
    } catch (statusError) {
        logger.warn(
            `Status check after redeem failed for ${claimed.merchantOrderId}: ${statusError?.message}`,
        );
    }

    if (!statusPayload) {
        // Leave it in REDEEMING; reconciliation will resolve it.
        await releaseDebit(claimed._id);
        return { status: "UNKNOWN" };
    }

    return settleFromStatus({ debitId: claimed._id, payload: statusPayload, logger });
};

/**
 * Resolve debits stuck in flight (worker crash, network partition, pending bank).
 * Runs every 10 minutes.
 */
const reconcileInFlight = async ({ now = new Date(), limit = 200, logger = console } = {}) => {
    const stuck = await PledgeDebit.find({
        status: {
            $in: [DEBIT_STATUS.REDEEMING, DEBIT_STATUS.UNKNOWN, DEBIT_STATUS.NOTIFYING],
        },
        updatedAt: { $lt: addMinutes(now, -5) },
    }).limit(limit);

    const summary = { scanned: stuck.length, resolved: 0, reset: 0, failed: 0 };

    for (const debit of stuck) {
        try {
            if (debit.status === DEBIT_STATUS.NOTIFYING) {
                // The notify call never completed; retry it on the next tick.
                await PledgeDebit.updateOne(
                    { _id: debit._id },
                    {
                        $set: {
                            status: DEBIT_STATUS.SCHEDULED,
                            lockedAt: null,
                            lockOwner: null,
                        },
                    },
                );
                summary.reset += 1;
                continue;
            }

            const payload = await getRedemptionOrderStatus(debit.merchantOrderId);
            const settled = await settleFromStatus({
                debitId: debit._id,
                payload,
                logger,
            });

            if (settled?.status === DEBIT_STATUS.SUCCESS || settled?.donation) {
                summary.resolved += 1;
            }
        } catch (error) {
            summary.failed += 1;
            logger.error(
                `Reconciliation failed for ${debit.merchantOrderId}:`,
                error?.message || error,
            );
        }
    }

    return summary;
};







/** Donor chose to skip the next cycle. */
const skipOpenCycle = async ({ pledge, reason = "Skipped by donor" }) => {
    const cycleNumber = pledge.cyclesCompleted + 1;

    const debit = await PledgeDebit.findOne({
        pledgeId: pledge._id,
        cycleNumber,
        status: {
            $in: [DEBIT_STATUS.SCHEDULED, DEBIT_STATUS.NOTIFIED, DEBIT_STATUS.NOTIFYING],
        },
    });

    if (debit) {
        await PledgeDebit.updateOne(
            { _id: debit._id, status: { $ne: DEBIT_STATUS.SUCCESS } },
            {
                $set: {
                    status: DEBIT_STATUS.SKIPPED,
                    errorCode: "SKIPPED_BY_DONOR",
                    errorMessage: reason,
                    lockedAt: null,
                    lockOwner: null,
                },
            },
        );
    }

    await Pledge.updateOne(
        { _id: pledge._id },
        { $set: { nextDebitAt: addMonthsClamped(pledge.nextDebitAt, 1) } },
    );

    return { skipped: Boolean(debit) };
};

export {
    INSTANCE_ID,
    claimDebit,
    releaseDebit,
    ensureCycleDebit,
    selectDueDebit,
    classifyOrderStatus,
    extractPaymentMeta,
    settleDebitSuccess,
    settleDebitFailure,
    settleFromStatus,
    notifyDebit,
    planAndNotify,
    redeemAndSettle,
    executeRedemptions,
    reconcileInFlight,
    skipOpenCycle,
};
