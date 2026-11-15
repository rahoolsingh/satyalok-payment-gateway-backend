import express from "express";
import { rateLimit } from "../middleware/rateLimit.middleware.js";
import idempotency from "../middleware/idempotency.middleware.js";
import {
    getPlans,
    createPledgeHandler,
    getPledgeStatus,
    getPortal,
    pausePledgeHandler,
    resumePledgeHandler,
    cancelPledgeHandler,
    skipCycleHandler,
    requestPortalLink,
} from "../controllers/pledge.controller.js";

/**
 * Public pledge API.
 *
 * Mounted at /pledge. Every route is rate limited; the create route additionally
 * requires an Idempotency-Key so a double submit cannot create two mandates.
 */

const router = express.Router();

const createLimiter = rateLimit({
    windowMs: 10 * 60_000,
    max: 8,
    name: "pledge-create",
});

const readLimiter = rateLimit({ windowMs: 60_000, max: 90, name: "pledge-read" });

const actionLimiter = rateLimit({ windowMs: 60_000, max: 20, name: "pledge-action" });

const recoverLimiter = rateLimit({
    windowMs: 60 * 60_000,
    max: 5,
    name: "pledge-recover",
});

router.get("/plans", readLimiter, getPlans);

router.post("/", createLimiter, idempotency, createPledgeHandler);

// Donor self-service. The token is the credential, so these are hammer-limited.
router.get("/manage/:token", readLimiter, getPortal);
router.post("/manage/:token/pause", actionLimiter, pausePledgeHandler);
router.post("/manage/:token/resume", actionLimiter, resumePledgeHandler);
router.post("/manage/:token/skip", actionLimiter, skipCycleHandler);
router.post("/manage/:token/cancel", actionLimiter, cancelPledgeHandler);

router.post("/recover", recoverLimiter, requestPortalLink);

router.get("/:pledgeRef/status", readLimiter, getPledgeStatus);

export default router;
