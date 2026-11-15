import asyncHandler from "../utils/asyncHandler.util.js";
import { isRazorpayConfigured } from "../config/razorpay.config.js";
import { activeRecurringProvider } from "../config/recurring.config.js";
import {
    createRazorpayOneTimeOrder,
    verifyRazorpayOneTimePayment,
} from "../services/Razorpay/razorpayOneTime.service.js";

/**
 * Public payment capability + Razorpay one-time checkout endpoints.
 *
 * Capability answers let the donation page offer only rails that actually work
 * on this deployment. No secret is ever returned: the key id is public by
 * design; the key secret and webhook secret stay server-side.
 */

const isPhonePeConfigured = () =>
    Boolean(process.env.PROD_URL && process.env.SALT_KEY && process.env.MERCHANT_ID);

const getPaymentProviders = asyncHandler(async (req, res) => {
    res.set("Cache-Control", "public, max-age=60");

    res.json({
        success: true,
        oneTime: {
            phonepe: isPhonePeConfigured(),
            razorpay: isRazorpayConfigured(),
        },
        recurring: {
            available: Boolean(activeRecurringProvider()),
            provider: activeRecurringProvider(),
        },
    });
});

const createRazorpayOrderHandler = asyncHandler(async (req, res) => {
    const result = await createRazorpayOneTimeOrder({ input: req.body });
    res.status(201).json(result);
});

const verifyRazorpayPaymentHandler = asyncHandler(async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
        req.body || {};

    const result = await verifyRazorpayOneTimePayment({
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
    });

    res.json(result);
});

export {
    getPaymentProviders,
    createRazorpayOrderHandler,
    verifyRazorpayPaymentHandler,
};
