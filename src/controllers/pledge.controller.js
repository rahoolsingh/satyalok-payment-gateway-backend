import asyncHandler from "../utils/asyncHandler.util.js";
import { recurringCapability } from "../config/recurring.config.js";
import {
    createPledge,
    completeSetup,
    refreshPledgeStatus,
    cancelPledge,
    pausePledge,
    resumePledge,
    getPortalData,
    listPledges,
    validatePledgeInput,
} from "../services/pledge.service.js";
import { skipOpenCycle, ensureCycleDebit } from "../services/pledgeDebit.service.js";
import { verifyPortalToken, PORTAL_SCOPES } from "../services/magicLink.service.js";
import Pledge, { PLEDGE_STATUS } from "../models/pledge.model.js";
import PledgeDebit from "../models/pledgeDebit.model.js";
import {
    AppError,
    ConflictError,
    NotFoundError,
    ValidationError,
} from "../utils/appError.util.js";
import { sendPortalLink } from "../services/pledgeEmail.service.js";

/**
 * HTTP surface for recurring pledges.
 *
 * Public endpoints (plan list, create, status) are rate limited and never accept
 * an amount that the server has not resolved itself. Donor self-service goes
 * through a signed magic-link token, and admin endpoints reuse the existing
 * cookie based admin auth.
 */

const publicPledgeView = (pledge) => ({
    pledgeRef: pledge.pledgeRef,
    status: pledge.status,
    amount: pledge.amount,
    currency: pledge.currency,
    frequency: pledge.frequency,
    startedAt: pledge.startedAt,
    nextDebitAt: pledge.nextDebitAt,
    expiresAt: pledge.expiresAt,
    cyclesCompleted: pledge.cyclesCompleted,
    maskedInstrument: pledge.maskedInstrument,
    donorFirstName: String(pledge.donor?.name || "").split(" ")[0],
});

/** GET /pledge/plans — public catalogue. Never fails, even with no config. */
const getPlans = asyncHandler(async (req, res) => {
    const capability = recurringCapability();

    // Short cache: the answer only changes when the deployment changes.
    res.set("Cache-Control", "public, max-age=60");

    res.json({
        success: true,
        available: capability.available,
        comingSoon: capability.comingSoon,
        plans: capability.plans,
        previewPlans: capability.previewPlans,
        rules: capability.rules,
    });
});

/** POST /pledge — create the mandate and hand off to the UPI app. */
const createPledgeHandler = asyncHandler(async (req, res) => {
    const { pledge, authorization, replayed } = await createPledge({
        input: req.body,
        context: {
            ip: req.ip,
            userAgent: req.get("user-agent"),
            idempotencyKey: req.idempotencyKey,
        },
    });

    res.status(replayed ? 200 : 201).json({
        success: true,
        message: replayed
            ? "This pledge request was already received."
            : "Approve the mandate in your UPI app to activate your monthly pledge.",
        data: {
            pledge: publicPledgeView(pledge),
            authorization,
        },
    });
});

/**
 * GET /pledge/:pledgeRef/status
 *
 * Polled by the frontend after the donor is sent to their UPI app. If the donor
 * approves in-app, the webhook usually lands first; this endpoint also reconciles
 * with the gateway so the UI is never stuck on "pending".
 */
const getPledgeStatus = asyncHandler(async (req, res) => {
    const { pledgeRef } = req.params;

    let pledge = await Pledge.findOne({ pledgeRef });

    if (!pledge) {
        throw new NotFoundError("Pledge not found.");
    }

    if (
        pledge.status === PLEDGE_STATUS.PENDING_AUTH ||
        pledge.status === PLEDGE_STATUS.AUTH_FAILED
    ) {
        try {
            const refreshed = await refreshPledgeStatus({ pledge });
            pledge = refreshed.pledge;
        } catch (error) {
            // Gateway hiccup must not break the status page.
            console.warn(
                `Status refresh failed for ${pledgeRef}:`,
                error?.message || error,
            );
        }
    }

    res.json({ success: true, data: publicPledgeView(pledge) });
});

/** Resolve the donor from a magic-link token. */
const loadPledgeFromToken = async (req, { requireManage = true } = {}) => {
    const token = req.params.token || req.get("X-Pledge-Token");
    const { pledgeId, scope } = verifyPortalToken(token);

    if (requireManage && scope !== PORTAL_SCOPES.MANAGE) {
        throw new AppError("This link is not authorised to change the pledge.", 403, "FORBIDDEN");
    }

    const pledge = await Pledge.findById(pledgeId);

    if (!pledge) {
        throw new NotFoundError("Pledge not found.");
    }

    return { pledge, scope };
};

/** GET /pledge/manage/:token */
const getPortal = asyncHandler(async (req, res) => {
    const { pledge } = await loadPledgeFromToken(req, { requireManage: false });
    const data = await getPortalData({ pledgeId: pledge._id });

    res.json({ success: true, data });
});

/** POST /pledge/manage/:token/pause */
const pausePledgeHandler = asyncHandler(async (req, res) => {
    const { pledge } = await loadPledgeFromToken(req);
    const updated = await pausePledge({ pledge, reason: req.body?.reason });

    res.json({
        success: true,
        message: "Your pledge is paused. You can resume any time.",
        data: publicPledgeView(updated),
    });
});

/** POST /pledge/manage/:token/resume */
const resumePledgeHandler = asyncHandler(async (req, res) => {
    const { pledge } = await loadPledgeFromToken(req);
    const updated = await resumePledge({ pledge });

    res.json({
        success: true,
        message: "Welcome back — your monthly pledge is active again.",
        data: publicPledgeView(updated),
    });
});

/** POST /pledge/manage/:token/cancel */
const cancelPledgeHandler = asyncHandler(async (req, res) => {
    const { pledge } = await loadPledgeFromToken(req);

    const reason =
        typeof req.body?.reason === "string" ? req.body.reason.slice(0, 500) : null;

    const cancelled = await cancelPledge({ pledge, by: "donor", reason });

    res.json({
        success: true,
        message: "Your pledge has been cancelled and no further debits will be made.",
        data: publicPledgeView(cancelled),
    });
});

/** POST /pledge/manage/:token/skip — skip exactly one upcoming cycle. */
const skipCycleHandler = asyncHandler(async (req, res) => {
    const { pledge } = await loadPledgeFromToken(req);

    if (pledge.status !== PLEDGE_STATUS.ACTIVE) {
        throw new ConflictError("Only active pledges can skip a month.");
    }

    const result = await skipOpenCycle({ pledge, reason: "Skipped by donor" });

    res.json({
        success: true,
        message: result.skipped
            ? "This month's donation has been skipped. Your next debit moves to next month."
            : "Nothing was due, so your schedule is unchanged.",
    });
});

/** POST /pledge/recover — email a fresh portal link (never reveals existence). */
const requestPortalLink = asyncHandler(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) {
        throw new ValidationError("Please enter the email you pledged with.");
    }

    await sendPortalLink({ email });

    res.json({
        success: true,
        message:
            "If a pledge exists for that email, we've sent the management link. It expires in 72 hours.",
    });
});

// ── Admin ────────────────────────────────────────────────────────────────────

/** GET /admin/pledges */
const adminListPledges = asyncHandler(async (req, res) => {
    const data = await listPledges({
        status: req.query.status,
        search: req.query.search,
        page: req.query.page,
        limit: req.query.limit,
    });

    res.json({ success: true, ...data });
});

/** GET /admin/pledges/:id */
const adminGetPledge = asyncHandler(async (req, res) => {
    const pledge = await Pledge.findById(req.params.id).select(
        "-donor.panEncrypted -donor.donorKey",
    );

    if (!pledge) {
        throw new NotFoundError("Pledge not found.");
    }

    const debits = await PledgeDebit.find({ pledgeId: pledge._id })
        .sort({ cycleNumber: -1, attempt: -1 })
        .limit(60)
        .lean();

    res.json({ success: true, data: { pledge, debits } });
});

/**
 * POST /admin/pledges/:id/cancel
 *
 * Admin cancellation always records who did it. There is no "delete" path:
 * mandates are financial records and must stay auditable.
 */
const adminCancelPledge = asyncHandler(async (req, res) => {
    const pledge = await Pledge.findById(req.params.id);

    if (!pledge) {
        throw new NotFoundError("Pledge not found.");
    }

    const reason =
        String(req.body?.reason || "").slice(0, 500) || "Cancelled by Satyalok admin";

    const cancelled = await cancelPledge({
        pledge,
        by: `admin:${req.admin?.email || req.admin?.id || "unknown"}`,
        reason,
    });

    res.json({ success: true, data: publicPledgeView(cancelled) });
});

/**
 * POST /admin/pledges/:id/retry
 *
 * Queues one more collection attempt for a failed cycle. Because our flow always
 * sends the RBI pre-debit notification first, the actual debit lands at least
 * 24h after this call — retries are never instant.
 */
const adminRetryDebit = asyncHandler(async (req, res) => {
    const pledge = await Pledge.findById(req.params.id);

    if (!pledge) {
        throw new NotFoundError("Pledge not found.");
    }

    if (
        pledge.status === PLEDGE_STATUS.CANCELLED ||
        pledge.status === PLEDGE_STATUS.COMPLETED
    ) {
        throw new ConflictError("This pledge is closed and cannot be retried.");
    }

    const latest = await PledgeDebit.findOne({ pledgeId: pledge._id }).sort({
        cycleNumber: -1,
        attempt: -1,
    });

    if (!latest) {
        throw new ValidationError("This pledge has no debits to retry yet.");
    }

    if (!["FAILED", "UNKNOWN"].includes(latest.status)) {
        throw new ConflictError(
            `The latest attempt is ${latest.status.toLowerCase()}; nothing to retry.`,
        );
    }

    const now = new Date();

    const debit = await ensureCycleDebit({
        pledge,
        cycleNumber: latest.cycleNumber,
        attempt: latest.attempt + 1,
        scheduledFor: now,
    });

    await Pledge.updateOne(
        { _id: pledge._id },
        {
            $set: {
                status: PLEDGE_STATUS.ACTIVE,
                nextDebitAt: now,
            },
        },
    );

    res.json({
        success: true,
        message:
            "Retry queued. A pre-debit notification goes out first, so the debit will execute ~24h from now.",
        data: {
            merchantOrderId: debit?.merchantOrderId,
            attempt: debit?.attempt,
            cycleNumber: debit?.cycleNumber,
        },
    });
});

/** POST /admin/pledges/sync-setup — manually settle a mandate the webhook missed. */
const adminSyncSetup = asyncHandler(async (req, res) => {
    const pledge = await Pledge.findOne({ pledgeRef: req.body?.pledgeRef });

    if (!pledge) {
        throw new NotFoundError("Pledge not found.");
    }

    const result = await refreshPledgeStatus({ pledge });

    res.json({ success: true, data: publicPledgeView(result.pledge) });
});

export {
    getPlans,
    createPledgeHandler,
    getPledgeStatus,
    getPortal,
    pausePledgeHandler,
    resumePledgeHandler,
    cancelPledgeHandler,
    skipCycleHandler,
    requestPortalLink,
    adminListPledges,
    adminGetPledge,
    adminCancelPledge,
    adminRetryDebit,
    adminSyncSetup,
};

