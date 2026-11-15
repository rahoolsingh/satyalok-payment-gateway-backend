import mongoose from "mongoose";

const donationSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            trim: true,
        },
        amount: {
            type: Number,
            required: true,
        },
        currency: {
            type: String,
            required: true,
            default: "INR",
        },
        mobile: {
            type: Number,
            required: true,
        },
        merchantTransactionId: {
            type: String,
            required: true,
            index: true,
            unique: true,
        },
        success: {
            type: Boolean,
            required: true,
            default: false,
        },
        pgResponse: {
            type: Object,
        },
        taxBenefit: {
            type: Boolean,
            required: true,
            default: false,
        },
        panNumber: {
            type: String,
            trim: true,
        },
        // Recurring pledges keep the real PAN encrypted at rest; `panNumber`
        // above only ever holds a masked value for these rows.
        panEncrypted: {
            type: String,
            default: null,
        },
        sendMail: {
            type: Boolean,
            required: true,
            default: false,
        },
        resendMail: {
            type: Boolean,
            required: true,
            default: false,
        },
        verificationRetryCount: {
            type: Number,
            required: true,
            default: 0,
        },
        verifiedFailed: {
            type: Boolean,
            required: true,
            default: false,
        },
        createdByAdmin: {
            type: Boolean,
            default: false,
        },
        paymentMethod: {
            type: String,
            default: "phonepe",
        },
        isDeleted: {
            type: Boolean,
            default: false,
        },
        externalTransactionId: {
            type: String,
            trim: true,
        },
        donationDate: {
            type: Date,
            default: Date.now,
        },
        donationTime: {
            type: String, // "HH:MM" format, optional — if absent time is not printed on cert
            trim: true,
        },

        // ── Recurring pledge linkage (additive, safe for existing documents) ──
        source: {
            type: String,
            enum: ["one_time", "recurring", "offline", "admin"],
            default: "one_time",
        },
        pledgeId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Pledge",
            default: null,
        },
        pledgeRef: {
            type: String,
            default: null,
            index: true,
        },
        cycleNumber: {
            type: Number,
            default: null,
        },
        receiptSent: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true },
);

const Donation = mongoose.model("Donation", donationSchema);

export default Donation;
