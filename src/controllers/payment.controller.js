import dotenv from "dotenv";
import {
    createOrder,
    paymentStatus,
} from "../services/PhonePe/payment.service.js";
import Donation from "../models/donation.model.js";

dotenv.config();

const frontendURL = process.env.FRONTEND_URL;

const initiatePayment = async (req, res) => {
    const merchantTransactionId = `HOPE${Date.now()}`;
    const donation = new Donation({
        name: req.body.name,
        email: req.body.email,
        amount: req.body.amount,
        mobile: req.body.phone,
        panNumber: req.body.pan,
        taxBenefit: req.body?.pan ? true : false,
        merchantTransactionId: merchantTransactionId,
    });

    try {
        const response = await createOrder(
            req.body.name,
            req.body.amount,
            req.body.phone,
            merchantTransactionId
        );
        await donation.save();
        return res.json(response);
    } catch (error) {
        console.error("Error in /order:", error);
        return res.status(500).json({
            error: "An error occurred while initiating the payment.",
        });
    }
};

const paymentConfirmation = async (req, res) => {
    const status = await paymentStatus(req.query.id);

    if (status.success) {
        await Donation.updateOne(
            { merchantTransactionId: req.query.id },
            {
                success: true,
                pgResponse: status,
            }
        );
    }

    return res.redirect(`${frontendURL}/status/${req.query.id}`);
};

const checkStatus = async (req, res) => {
    const status = await paymentStatus(req.query.id);

    return res.json(status);
};

export { initiatePayment, checkStatus, paymentConfirmation };
