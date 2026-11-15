import Pledge, { PLEDGE_STATUS } from "../models/pledge.model.js";
import PledgeDebit, { DEBIT_STATUS } from "../models/pledgeDebit.model.js";
import Donor from "../models/donor.model.js";
import Donation from "../models/donation.model.js";
import {
    RECURRING_RULES,
    AUTOPAY_CONFIG,
    resolvePlan,
    isRecurringEnabled,
} from "../config/recurring.config.js";
import {
    AppError,
    ConflictError,
    ValidationError,
    ProviderError,
} from "../utils/appError.util.js";
import { encryptField, maskPan, hmacHex, maskPhone } from "../utils/crypto.util.js";
import {
    newPledgeRef,
    newMerchantSubscriptionId,
    setupOrderId,
} from "../utils/reference.util.js";
import { toPaise } from "../utils/money.util.js";
import { addMonthsClamped, addYears, addHours } from "../utils/schedule.util.js";
import {
    setupSubscription,
    cancelSubscription,
    getSubscriptionStatus,
} from "./PhonePe/autopay.service.js";
import {
    classifyOrderStatus,
    settleDebitSuccess,
} from "./pledgeDebit.service.js";
import { sendPledgeActivated, sendPledgeCancelled } from "./pledgeEmail.service.js";

/**
 * Pledge lifecycle: create -> mandate approved -> active -> (paused | past due)
 * -> cancelled/completed.
 *
 * All amounts come from the server-side plan catalogue; the client can only pick
 * a plan id. Every mutation is guarded by a status precondition so a stale admin
 * tab or a double click cannot skip states.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const VPA_RE = /^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/;

const normalisePhone = (phone) => {
    const digits = String(phone || "").replace(/\D/g, "");
    return digits.length > 10 ? digits.slice(-10) : digits;
};

const normaliseEmail = (email) => String(email || "").trim().toLowerCase();

/** Validate everything the donor typed. Returns normalised values. */
const validatePledgeInput = (input) => {
    const name = String(input.name || "").trim();
    const email = normaliseEmail(input.email);
    const phone = normalisePhone(input.phone);
    const panRaw = String(input.pan || "").trim().toUpperCase();
    const vpa = String(input.vpa || "").trim();

    if (name.length < 2 || name.length > 80) {
        throw new ValidationError("Please enter your full name.");
    }

    if (!EMAIL_RE.test(email)) {
        throw new ValidationError("Please enter a valid email address.");
    }

    if (!PHONE_RE.test(phone)) {
        throw new ValidationError("Please enter a valid 10 digit Indian mobile number.");
    }

    if (panRaw && !PAN_RE.test(panRaw)) {
        throw new ValidationError(
            "PAN should look like ABCDE1234F. Leave it blank if you don't need an 80G receipt.",
        );
    }

    if (input.consent !== true) {
        throw new ValidationError(
            "Please accept the auto-debit authorisation to continue.",
        );
    }

    const channel = input.channel === "mobile" ? "mobile" : "web";

    // UPI intent hands off to an app, so we don't need (or want) the VPA.
    if (channel === "web" && AUTOPAY_CONFIG.setupMode !== "UPI_INTENT") {
        if (!VPA_RE.test(vpa)) {
            throw new ValidationError(
                "Please enter the UPI ID (like yourname@bank) that should be debited each month.",
            );
        }
    }

    return { name, email, phone, pan: panRaw || null, vpa, channel };
};

const buildConsentRecord = ({ context, version }) => ({
    version,
    acceptedAt: new Date(),
    text:
        "I authorise Satyalok to debit my UPI account the amount shown every month until I cancel, " +
        "and I understand I will receive a notification at least 24 hours before each debit.",
    ip: context?.ip || null,
    userAgent: String(context?.userAgent || "").slice(0, 255),
});

/**
 * Create a pledge and push the mandate to the donor's UPI app.
 *
 * @returns {Promise<{pledge: object, authorization: object}>}
 */
const createPledge = async ({ input, context = {}, logger = console }) => {
    if (!isRecurringEnabled()) {
        throw new AppError(
            "Monthly giving is not open yet. You can still make a one-time donation.",
            503,
            "RECURRING_COMING_SOON",
        );
    }

    // Idempotency: replay the original response instead of creating a second mandate.
    if (context.idempotencyKey) {
        const existing = await Pledge.findOne({ idempotencyKey: context.idempotencyKey });

        if (existing) {
            return {
                pledge: existing,
                authorization: buildAuthorization(existing, null),
                replayed: true,
            };
        }
    }

    const donorInput = validatePledgeInput(input);
    const plan = resolvePlan({
        planId: input.planId,
        amount: input.amount,
        frequency: input.frequency || "MONTHLY",
        ValidationError,
    });

    const donorKey = hmacHex(donorInput.email);

    const donor = await Donor.findOne({ donorKey });

    if (donor?.isBlocked) {
        throw new ConflictError(
            "This donor account is on hold. Please contact us to continue.",
        );
    }

    const livePledges = await Pledge.countDocuments({
        "donor.donorKey": donorKey,
        status: { $in: [PLEDGE_STATUS.PENDING_AUTH, PLEDGE_STATUS.ACTIVE] },
    });

    if (livePledges >= RECURRING_RULES.maxActivePledgesPerDonor) {
        throw new ConflictError(
            `You already have ${livePledges} active monthly pledges. Please manage them before starting another.`,
        );
    }

    const now = new Date();
    const merchantSubscriptionId = newMerchantSubscriptionId();
    const amountPaise = toPaise(plan.amount);

    const panEncrypted = donorInput.pan ? encryptField(donorInput.pan) : null;

    const pledge = new Pledge({
        pledgeRef: newPledgeRef(),
        status: PLEDGE_STATUS.PENDING_AUTH,
        donor: {
            name: donorInput.name,
            email: donorInput.email,
            phone: donorInput.phone,
            panEncrypted,
            panMasked: donorInput.pan ? maskPan(donorInput.pan) : null,
            taxBenefit: Boolean(donorInput.pan),
            donorKey,
            maskedVpa: donorInput.vpa ? `${donorInput.vpa.slice(0, 2)}****${donorInput.vpa.split("@")[1] ? `@${donorInput.vpa.split("@")[1]}` : ""}` : null,
        },
        amount: plan.amount,
        currency: RECURRING_RULES.currency,
        frequency: plan.frequency,
        planId: plan.planId,
        provider: "phonepe_autopay",
        merchantSubscriptionId,
        amountType: "FIXED",
        maxAmountPaise: amountPaise,
        expiresAt: addYears(now, RECURRING_RULES.mandateValidityYears),
        consent: buildConsentRecord({
            context,
            version: RECURRING_RULES.consentVersion,
        }),
        idempotencyKey: context.idempotencyKey || null,
    });

    try {
        await pledge.save();
    } catch (error) {
        // Concurrent duplicate with the same idempotency key.
        if (error?.code === 11000 && context.idempotencyKey) {
            const existing = await Pledge.findOne({
                idempotencyKey: context.idempotencyKey,
            });

            if (existing) {
                return {
                    pledge: existing,
                    authorization: buildAuthorization(existing, null),
                    replayed: true,
                };
            }
        }

        throw error;
    }

    // Upsert the donor record (consent + identity for future consolidated 80G).
    await Donor.updateOne(
        { donorKey },
        {
            $setOnInsert: {
                donorKey,
                totalDonatedPaise: 0,
            },
            $set: {
                name: donorInput.name,
                email: donorInput.email,
                phone: donorInput.phone,
                ...(panEncrypted
                    ? {
                          panEncrypted,
                          panMasked: maskPan(donorInput.pan),
                          taxBenefit: true,
                      }
                    : {}),
                consentVersion: RECURRING_RULES.consentVersion,
            },
        },
        { upsert: true },
    );

    // Ask the gateway to create the mandate.
    try {
        const response = await setupSubscription({
            merchantOrderId: setupOrderId(merchantSubscriptionId),
            merchantSubscriptionId,
            amountPaise,
            maxAmountPaise: amountPaise,
            frequency: plan.frequency,
            subscriptionExpireAt: pledge.expiresAt.getTime(),
            orderExpireAt: addHours(now, 1).getTime(),
            metaInfo: {
                udf1: pledge.pledgeRef,
                udf2: `pledge-${plan.planId}`,
                udf3: donorInput.channel,
            },
            channel: donorInput.channel,
            vpa: donorInput.vpa,
            targetApp: input.targetApp,
        });

        pledge.providerSubscriptionId = response?.orderId || null;

        await pledge.save();

        return {
            pledge,
            authorization: buildAuthorization(pledge, response),
            replayed: false,
        };
    } catch (error) {
        pledge.status = PLEDGE_STATUS.AUTH_FAILED;
        pledge.authError = error?.message || "Mandate setup failed";
        await pledge.save({ validateBeforeSave: false });

        logger.error(
            `Mandate setup failed for ${pledge.pledgeRef}:`,
            error?.message || error,
        );

        if (error instanceof AppError) {
            throw error;
        }

        throw new ProviderError(
            "We could not reach the payment gateway to set up your mandate. Please try again.",
            { pledgeRef: pledge.pledgeRef },
        );
    }
};

/** Shape the response the frontend uses to hand off to the UPI app / gateway. */
const buildAuthorization = (pledge, response) => {
    const redirectUrl = response?.redirectUrl || null;
    const intentUrl = response?.intentUrl || null;

    return {
        pledgeRef: pledge.pledgeRef,
        merchantSubscriptionId: pledge.merchantSubscriptionId,
        status: pledge.status,
        amount: pledge.amount,
        frequency: pledge.frequency,
        mode: redirectUrl ? "REDIRECT" : intentUrl ? "INTENT" : "COLLECT",
        redirectUrl,
        intentUrl,
        orderId: response?.orderId || null,
        // For UPI collect the donor approves in their own app; the frontend
        // polls the status endpoint until the mandate is live.
        nextAction: redirectUrl
            ? "REDIRECT_TO_GATEWAY"
            : intentUrl
              ? "OPEN_UPI_APP"
              : "APPROVE_IN_UPI_APP",
    };
};

/**
 * Activate a pledge after the donor approved the mandate.
 *
 * The authorisation transaction is cycle 1, so we record it as a debit and run
 * it through the normal settlement path — one code path for "money arrived".
 */
const completeSetup = async ({ pledge, payload, logger = console }) => {
    if (pledge.status === PLEDGE_STATUS.ACTIVE) {
        return { alreadyActive: true };
    }

    const { outcome, payment, errorCode, errorMessage } = classifyOrderStatus(payload);

    if (outcome !== "SUCCESS") {
        await Pledge.updateOne(
            { _id: pledge._id, status: PLEDGE_STATUS.PENDING_AUTH },
            {
                $set: {
                    status: PLEDGE_STATUS.AUTH_FAILED,
                    authError: errorMessage || errorCode || "Mandate not approved",
                },
            },
        );

        return { activated: false, reason: errorMessage || errorCode };
    }

    const now = new Date();

    const activated = await Pledge.findOneAndUpdate(
        { _id: pledge._id, status: { $ne: PLEDGE_STATUS.ACTIVE } },
        {
            $set: {
                status: PLEDGE_STATUS.ACTIVE,
                startedAt: now,
                nextDebitAt: addMonthsClamped(now, 1),
                providerSubscriptionId:
                    payload?.orderId || pledge.providerSubscriptionId || null,
                providerMandateId:
                    payment?.rail?.umn || pledge.providerMandateId || null,
                maskedInstrument:
                    payment?.rail?.vpa ||
                    payment?.instrument?.maskedAccountNumber ||
                    pledge.maskedInstrument ||
                    null,
                authError: null,
            },
        },
        { new: true },
    );

    if (!activated) {
        return { alreadyActive: true };
    }

    const setupOrder = setupOrderId(activated.merchantSubscriptionId);
    const amountPaise = toPaise(activated.amount);

    let debit = await PledgeDebit.findOne({ merchantOrderId: setupOrder });

    if (!debit) {
        try {
            debit = await PledgeDebit.create({
                pledgeId: activated._id,
                pledgeRef: activated.pledgeRef,
                merchantSubscriptionId: activated.merchantSubscriptionId,
                merchantOrderId: setupOrder,
                cycleNumber: 1,
                attempt: 1,
                amount: activated.amount,
                amountPaise,
                currency: activated.currency,
                scheduledFor: now,
                status: DEBIT_STATUS.REDEEMING,
                notifiedAt: now,
            });
        } catch (error) {
            if (error?.code !== 11000) throw error;
            debit = await PledgeDebit.findOne({ merchantOrderId: setupOrder });
        }
    }

    if (debit) {
        await settleDebitSuccess({ debitId: debit._id, payload, logger });
    }

    const fresh = await Pledge.findById(activated._id);

    await sendPledgeActivated({ pledge: fresh, debit, logger });

    return { activated: true, pledge: fresh, debit };
};

/**
 * Poll the gateway for the mandate state and mirror it locally.
 * Used by the frontend status page (so the donor sees "active" without waiting
 * for the webhook) and by reconciliation.
 */
const refreshPledgeStatus = async ({ pledge }) => {
    if (!pledge?.merchantSubscriptionId) {
        return { pledge, changed: false };
    }

    const status = await getSubscriptionStatus(pledge.merchantSubscriptionId);
    const state = String(status?.state || "").toUpperCase();

    const map = {
        ACTIVE: PLEDGE_STATUS.ACTIVE,
        PAUSED: PLEDGE_STATUS.PAUSED,
        REVOKED: PLEDGE_STATUS.CANCELLED,
        CANCELLED: PLEDGE_STATUS.CANCELLED,
        EXPIRED: PLEDGE_STATUS.COMPLETED,
    };

    const nextStatus = map[state];

    if (!nextStatus || nextStatus === pledge.status) {
        return { pledge, changed: false, state };
    }

    // Never resurrect a locally cancelled pledge from a stale gateway state.
    if (
        pledge.status === PLEDGE_STATUS.CANCELLED ||
        pledge.status === PLEDGE_STATUS.COMPLETED
    ) {
        return { pledge, changed: false, state };
    }

    const updated = await Pledge.findByIdAndUpdate(
        pledge._id,
        {
            $set: {
                status: nextStatus,
                ...(nextStatus === PLEDGE_STATUS.CANCELLED
                    ? { cancelledAt: new Date(), cancelledBy: "issuer" }
                    : {}),
            },
        },
        { new: true },
    );

    return { pledge: updated, changed: true, state };
};

/**
 * Cancel a pledge.
 *
 * The local state flips first — that guarantees our debit engine stops
 * immediately — then we ask the gateway to revoke the mandate. If the gateway
 * call fails we flag it for a cron retry; because every debit is driven by us
 * (CUSTOM retry strategy), a lingering mandate cannot charge the donor on its own.
 */
const cancelPledge = async ({ pledge, by = "donor", reason = null, logger = console }) => {
    const cancelled = await Pledge.findOneAndUpdate(
        {
            _id: pledge._id,
            status: { $nin: [PLEDGE_STATUS.CANCELLED, PLEDGE_STATUS.COMPLETED] },
        },
        {
            $set: {
                status: PLEDGE_STATUS.CANCELLED,
                cancelledAt: new Date(),
                cancelledBy: by,
                cancellationReason: reason,
                providerCancelPending: true,
            },
        },
        { new: true },
    );

    if (!cancelled) {
        throw new ConflictError("This pledge is already closed.");
    }

    try {
        await cancelSubscription(cancelled.merchantSubscriptionId);

        await Pledge.updateOne(
            { _id: cancelled._id },
            { $set: { providerCancelPending: false } },
        );
    } catch (error) {
        logger.error(
            `Gateway cancellation pending for ${cancelled.pledgeRef}:`,
            error?.message || error,
        );
    }

    await sendPledgeCancelled({ pledge: cancelled, reason, logger });

    return cancelled;
};

/** Pause future debits. The mandate stays alive so resuming is one click. */
const pausePledge = async ({ pledge, reason = "Paused by donor" }) => {
    const updated = await Pledge.findOneAndUpdate(
        {
            _id: pledge._id,
            status: { $in: [PLEDGE_STATUS.ACTIVE, PLEDGE_STATUS.PAST_DUE] },
        },
        {
            $set: {
                status: PLEDGE_STATUS.PAUSED,
                pausedAt: new Date(),
                pauseReason: reason,
            },
        },
        { new: true },
    );

    if (!updated) {
        throw new ConflictError("This pledge cannot be paused in its current state.");
    }

    return updated;
};

/** Resume a paused pledge; the next debit is re-scheduled one cycle out. */
const resumePledge = async ({ pledge }) => {
    const nextDebitAt =
        pledge.nextDebitAt && pledge.nextDebitAt > new Date()
            ? pledge.nextDebitAt
            : addMonthsClamped(new Date(), 1);

    const updated = await Pledge.findOneAndUpdate(
        { _id: pledge._id, status: PLEDGE_STATUS.PAUSED },
        {
            $set: {
                status: PLEDGE_STATUS.ACTIVE,
                pausedAt: null,
                pauseReason: null,
                nextDebitAt,
            },
        },
        { new: true },
    );

    if (!updated) {
        throw new ConflictError("Only paused pledges can be resumed.");
    }

    return updated;
};


/** Everything the donor portal renders. */
const getPortalData = async ({ pledgeId }) => {
    const pledge = await Pledge.findById(pledgeId);

    if (!pledge) {
        throw new AppError("Pledge not found.", 404, "NOT_FOUND");
    }

    const [debits, donations] = await Promise.all([
        PledgeDebit.find({ pledgeId: pledge._id })
            .sort({ cycleNumber: -1, attempt: -1 })
            .limit(24)
            .lean(),
        Donation.find({ pledgeId: pledge._id, success: true })
            .sort({ createdAt: -1 })
            .limit(24)
            .lean(),
    ]);

    return {
        pledge: {
            pledgeRef: pledge.pledgeRef,
            status: pledge.status,
            amount: pledge.amount,
            frequency: pledge.frequency,
            currency: pledge.currency,
            startedAt: pledge.startedAt,
            nextDebitAt: pledge.nextDebitAt,
            expiresAt: pledge.expiresAt,
            cyclesCompleted: pledge.cyclesCompleted,
            totalDonated: pledge.totalDonatedPaise / 100,
            consecutiveFailures: pledge.consecutiveFailures,
            maskedInstrument: pledge.maskedInstrument,
            donor: {
                name: pledge.donor.name,
                phone: maskPhone(pledge.donor.phone),
                taxBenefit: pledge.donor.taxBenefit,
                panMasked: pledge.donor.panMasked,
            },
            consent: {
                version: pledge.consent?.version,
                acceptedAt: pledge.consent?.acceptedAt,
            },
            cancelledAt: pledge.cancelledAt,
            cancellationReason: pledge.cancellationReason,
        },
        debits: debits.map((debit) => ({
            cycleNumber: debit.cycleNumber,
            attempt: debit.attempt,
            amount: debit.amount,
            scheduledFor: debit.scheduledFor,
            status: debit.status,
            failedReason: debit.errorMessage,
            maskedInstrument: debit.maskedInstrument,
            utr: debit.utr,
            receiptAvailable: Boolean(debit.donationId),
        })),
        donations: donations.map((donation) => ({
            transactionId: donation.merchantTransactionId,
            amount: donation.amount,
            donatedAt: donation.donationDate || donation.createdAt,
            certificate: donation.taxBenefit,
        })),
    };
};

/** Admin listing with light filtering. */
const listPledges = async ({ status, search, page = 1, limit = 25 } = {}) => {
    const query = {};

    if (status) {
        query.status = status;
    }

    if (search) {
        const safe = String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        query.$or = [
            { pledgeRef: new RegExp(safe, "i") },
            { "donor.email": new RegExp(safe, "i") },
            { "donor.phone": new RegExp(safe, "i") },
            { "donor.name": new RegExp(safe, "i") },
            { merchantSubscriptionId: new RegExp(safe, "i") },
        ];
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const safePage = Math.max(Number(page) || 1, 1);

    const [items, total, grouped] = await Promise.all([
        Pledge.find(query)
            .select("-donor.panEncrypted -donor.donorKey")
            .sort({ createdAt: -1 })
            .skip((safePage - 1) * safeLimit)
            .limit(safeLimit)
            .lean(),
        Pledge.countDocuments(query),
        Pledge.aggregate([
            {
                $group: {
                    _id: "$status",
                    count: { $sum: 1 },
                    // Committed monthly rupees only counts live mandates.
                    amount: {
                        $sum: {
                            $cond: [
                                { $eq: ["$status", PLEDGE_STATUS.ACTIVE] },
                                "$amount",
                                0,
                            ],
                        },
                    },
                },
            },
        ]),
    ]);

    const statuses = Object.fromEntries(
        grouped.map((row) => [row._id, row.count]),
    );
    const monthlyCommitted = grouped.reduce(
        (sum, row) => sum + (row.amount || 0),
        0,
    );

    return {
        items,
        total,
        page: safePage,
        pages: Math.ceil(total / safeLimit) || 1,
        stats: {
            statuses,
            monthlyCommitted,
        },
    };
};

/** Retry gateway cancellations that failed earlier (cron). */
const retryProviderCancels = async ({ limit = 50, logger = console } = {}) => {
    const pending = await Pledge.find({
        providerCancelPending: true,
        status: PLEDGE_STATUS.CANCELLED,
    }).limit(limit);

    let resolved = 0;

    for (const pledge of pending) {
        try {
            await cancelSubscription(pledge.merchantSubscriptionId);
            await Pledge.updateOne(
                { _id: pledge._id },
                { $set: { providerCancelPending: false } },
            );
            resolved += 1;
        } catch (error) {
            logger.error(
                `Cancel retry failed for ${pledge.pledgeRef}:`,
                error?.message || error,
            );
        }
    }

    return { scanned: pending.length, resolved };
};

export {
    validatePledgeInput,
    buildAuthorization,
    createPledge,
    completeSetup,
    refreshPledgeStatus,
    cancelPledge,
    pausePledge,
    resumePledge,
    getPortalData,
    listPledges,
    retryProviderCancels,
};


