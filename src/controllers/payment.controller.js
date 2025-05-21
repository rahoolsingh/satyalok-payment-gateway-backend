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
import {
    donationReceiptEmailTemplate,
    paymentEmailTemplate,
} from "../services/emailTemplate.js";
import QuizChamp from "../models/quizchamp.model.js";

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

const initiateQuizChampPayment = async (req, res) => {
    const merchantTransactionId = `QC25${Date.now()}${randomChar()}`;
    const amount = req.body.group === "A" ? 1 : req.body.group === "B" ? 2 : 0;

    const donation = new QuizChamp({
        photo: req.files.photo[0].url,
        name: req.body.name,
        fatherName: req.body.fatherName,
        motherName: req.body.motherName,
        email: req.body.email,
        mobile: req.body.mobile,
        group: req.body.group,
        class: req.body.class,
        schoolName: req.body.schoolName,
        mediumOfStudy: req.body.mediumOfStudy,
        aadhaarNumber: req.body.aadhaarNumber,
        aadhaarCardPhoto: req.files.aadhaarCardPhoto[0].url,
        merchantTransactionId: merchantTransactionId,
        amount: amount,
    });



    try {
        const response = await createOrder(
            req.body.name,
            amount,
            req.body.mobile,
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
    if (status.success && req.query.id.startsWith("HOPE")) {
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
            const emailTemplate = donationReceiptEmailTemplate(
                updatedData.amount,
                updatedData.merchantTransactionId,
                updatedData.createdAt,
                updatedData.pgResponse.data.transactionId,
                updatedData.name,
                updatedData.success,
                updatedData.taxBenefit
            );

            if (updatedData.taxBenefit) {
                await generateCertificate(updatedData);

                await sendWithAttachment(
                    updatedData.email,
                    "Tax Benefit Donation Receipt From Satyalok - A New Hope",
                    `Thank you for your donation! INR ${updatedData.amount} has been received from ${updatedData.name} on ${updatedData.createdAt}.`,
                    emailTemplate,
                    `${updatedData.merchantTransactionId}.pdf`,
                    `./${updatedData.merchantTransactionId}.pdf`
                );

                await deleteFiles(updatedData.merchantTransactionId);
            } else {
                await sendMail(
                    updatedData.email,
                    "Donation Receipt From Satyalok - A New Hope",
                    `Thank you for your donation! INR ${updatedData.amount} has been received from ${updatedData.name} on ${updatedData.createdAt}.`,
                    emailTemplate
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

    if (status.success && req.query.id.startsWith("QC")) {
        await QuizChamp.updateOne(
            { merchantTransactionId: req.query.id },
            {
                success: true,
                pgResponse: status,
            }
        );

        updatedData = await QuizChamp.findOne({
            merchantTransactionId: req.query.id,
        });
        if (!updatedData.sendMail) {
            const emailTemplate = paymentEmailTemplate(
                updatedData.amount,
                updatedData.merchantTransactionId,
                updatedData.createdAt,
                updatedData.pgResponse.data.transactionId,
                updatedData.name,
                updatedData.success
            );

            await sendMail(
                updatedData.email,
                "Payment Receipt From Satyalok - A New Hope",
                `Thank you for your payment! INR ${updatedData.amount} has been received from ${updatedData.name} on ${updatedData.createdAt}.`,
                emailTemplate
            );

            await QuizChamp.updateOne(
                { merchantTransactionId: req.query.id },
                {
                    sendMail: true,
                }
            );
        }
    }

    return res.redirect(`https://quizchamp.satyalok.in/status/${req.query.id}`);
};

const checkStatus = async (req, res) => {
    const status = await paymentStatus(req.query.id);

    return res.json(status);
};

export {
    initiatePayment,
    initiateQuizChampPayment,
    checkStatus,
    paymentConfirmation,
};
