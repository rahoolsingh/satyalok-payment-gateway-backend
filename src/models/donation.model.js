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
        
    },
    { timestamps: true }
);

const Donation = mongoose.model("Donation", donationSchema);

export default Donation;
