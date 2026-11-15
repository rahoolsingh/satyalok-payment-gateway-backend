import express from "express";
import { rateLimit } from "../middleware/rateLimit.middleware.js";
import {
    getPaymentProviders,
    createRazorpayOrderHandler,
    verifyRazorpayPaymentHandler,
} from "../controllers/razorpay.controller.js";

/**
 * Razorpay one-time checkout.
 *
 * Mounted at /payment. Orders are rate limited because each call consumes a
 * gateway API quota; verification is limited separately.
 */

const router = express.Router();

const readLimiter = rateLimit({ windowMs: 60_000, max: 90, name: "payment-read" });

const orderLimiter = rateLimit({
    windowMs: 10 * 60_000,
    max: 12,
    name: "razorpay-order",
});

const verifyLimiter = rateLimit({
    windowMs: 10 * 60_000,
    max: 30,
    name: "razorpay-verify",
});

router.get("/providers", readLimiter, getPaymentProviders);
router.post("/razorpay/order", orderLimiter, createRazorpayOrderHandler);
router.post("/razorpay/verify", verifyLimiter, verifyRazorpayPaymentHandler);

export default router;
