import mongoose from "mongoose";

/**
 * Razorpay monthly plan cache.
 *
 * Razorpay subscriptions must reference a pre-created Plan, and plans cannot be
 * edited. We therefore create one plan per distinct monthly amount and reuse it
 * forever. The unique index makes concurrent first-time creation safe: the loser
 * reads the winner's plan.
 */
const razorpayPlanSchema = new mongoose.Schema(
    {
        amountPaise: { type: Number, required: true, unique: true, index: true },
        currency: { type: String, default: "INR" },
        planId: { type: String, required: true, unique: true },
        period: { type: String, default: "monthly" },
        interval: { type: Number, default: 1 },
    },
    { timestamps: true },
);

const RazorpayPlan = mongoose.model("RazorpayPlan", razorpayPlanSchema);

export default RazorpayPlan;