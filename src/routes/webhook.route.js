import express from "express";
import { phonepeAutopayWebhook } from "../controllers/pledgeWebhook.controller.js";
import { razorpayWebhook } from "../controllers/razorpayWebhook.controller.js";

/**
 * Gateway callbacks.
 *
 * Kept in its own router so it can be:
 *   - excluded from CORS/CSRF concerns (it is server-to-server), and
 *   - rate limited separately or bypassed at the proxy layer if needed.
 */
const router = express.Router();

router.post("/phonepe/autopay", phonepeAutopayWebhook);
router.post("/razorpay", razorpayWebhook);

export default router;
