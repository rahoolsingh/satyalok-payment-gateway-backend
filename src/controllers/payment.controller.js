import dotenv from "dotenv";
import {
    createOrder,
    paymentStatus,
} from "../services/PhonePe/payment.service.js";
import Donation from "../models/donation.model.js";
import {
    generateCertificate,
    deleteFiles,
} from "../services/generateCertificate.service.js";
import { sendMail, sendWithAttachment } from "../services/sendmail.service.js";

dotenv.config();

const frontendURL = process.env.FRONTEND_URL;

const randomChar = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return chars.charAt(Math.floor(Math.random() * chars.length));
};

const initiatePayment = async (req, res) => {
    const merchantTransactionId = `HOPE${Date.now()}${randomChar()}`;
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
    let updatedData = {};
    if (status.success) {
        await Donation.updateOne(
            { merchantTransactionId: req.query.id },
            {
                success: true,
                pgResponse: status,
            }
        );

        updatedData = await Donation.findOne({
            merchantTransactionId: req.query.id,
        });
        if (!updatedData.sendMail) {
            if (updatedData.taxBenefit) {
                await generateCertificate(updatedData);

                await sendWithAttachment(
                    updatedData.email,
                    "Tax Benefit Donation Receipt From Satyalok - A New Hope",
                    "Thank you for your donation!",
                    `<p>Thank you for your donation!
                ${updatedData.amount} has been received from ${updatedData.name} on ${updatedData.createdAt}.</p>
                <p>Please find the attached donation receipt for your reference.</p>`,

                    `${updatedData.merchantTransactionId}.pdf`,
                    `./${updatedData.merchantTransactionId}.pdf`
                );

                await deleteFiles(updatedData.merchantTransactionId);
            } else {
                await sendMail(
                    updatedData.email,
                    "Donation Receipt From Satyalok - A New Hope",
                    "Thank you for your donation!",
                    `<p>Thank you for your donation!
                ${updatedData.amount} has been received from ${updatedData.name} on ${updatedData.createdAt}.</p>`
                );
            }

            await Donation.updateOne(
                { merchantTransactionId: req.query.id },
                {
                    sendMail: true,
                }
            );
        }
    }

    // console.log("Payment confirmation data", updatedData);

    return res.redirect(`${frontendURL}/status/${req.query.id}`);
};

const checkStatus = async (req, res) => {
    const status = await paymentStatus(req.query.id);

    return res.json(status);
};

export { initiatePayment, checkStatus, paymentConfirmation };
