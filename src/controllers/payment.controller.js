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
    admitCardEmailTemplate,
    donationReceiptEmailTemplate,
    paymentEmailTemplate,
} from "../services/emailTemplate.js";
import QuizChamp from "../models/quizchamp.model.js";
import generateAdmitCard from "../services/generateAdmitCard.service.js";
import Roll from "../models/roll.model.js";

dotenv.config();

const frontendURL = process.env.FRONTEND_URL;
const quizchampUrl = process.env.QUIZCHAMP_URL;

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
    const amount =
        req.body.group === "A" ? 15 : req.body.group === "B" ? 20 : 0;

    // check email duplicate
    const existingRecord = await QuizChamp.findOne({
        email: req.body.email,
        success: true,
    });

    if (existingRecord) {
        return res.status(400).json({
            success: false,
            message: "Email already registered for Quiz Champ",
        });
    }

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
        await donation.save();
        return res.json({
            message: "Proceed to payment to complete the registration.",
            data: {
                instrumentResponse: {
                    redirectInfo: {
                        url: `${frontendURL}/payment-redirects/${merchantTransactionId}`,
                        method: "GET",
                    },
                },
            },
        });
    } catch (error) {
        console.error("Error in /order:", error);
        return res.status(500).json({
            error: "An error occurred while initiating the payment.",
        });
    }
};

const processPayment = async (req, res) => {
    const { id: txnId } = req.query;

    if (!txnId) {
        return res.status(400).json({
            success: false,
            message: "Transaction ID is required.",
        });
    } else if (txnId.startsWith("QC")) {
        const record = await QuizChamp.findOne({
            merchantTransactionId: txnId,
        });

        if (!record) {
            return res.status(404).json({
                success: false,
                message: "Transaction not found.",
            });
        }

        // if payment is already successful, redirect to quizchamp URL
        if (record.success) {
            return res.redirect(`${quizchampUrl}/status/${txnId}`);
        }
        // if payment is not successful, initiate payment
        try {
            const response = await createOrder(
                record.name,
                record.amount,
                record.mobile,
                txnId
            );
            return res.json(response);
        } catch (error) {
            console.error("Error in /order:", error);
            return res.status(500).json({
                error: "An error occurred while initiating the payment.",
            });
        }
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
                    [
                        {
                            filename: `${updatedData.merchantTransactionId}.pdf`,
                            path: `./${updatedData.merchantTransactionId}.pdf`,
                        },
                    ]
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

    if (status.success && req.query.id.startsWith("QC25")) {
        const rollEntry = await Roll.findByIdAndUpdate(
            { _id: "quizChampRoll" },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
        );

        await QuizChamp.updateOne(
            { merchantTransactionId: req.query.id },
            {
                success: true,
                roll: rollEntry.seq,
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

        // admit card generation and email
        const admitCardResponse = await generateAdmitCard(
            updatedData.merchantTransactionId,
            status.success,
            updatedData.name,
            updatedData.roll,
            updatedData.aadhaarNumber,
            updatedData.fatherName,
            updatedData.motherName,
            updatedData.schoolName,
            updatedData.mediumOfStudy,
            updatedData.group,
            updatedData.class,
            updatedData.photo,
            status
        );
        if (admitCardResponse !== "Payment not verified") {
            const admitCardEmail = admitCardEmailTemplate(
                updatedData.roll,
                updatedData.name,
                updatedData.group
            );

            await sendWithAttachment(
                updatedData.email,
                "Admit Card for Quiz Competition",
                `Your admit card for the quiz competition is attached. Please keep it safe.`,
                admitCardEmail,
                [
                    {
                        filename: `${updatedData.roll}.pdf`,
                        path: admitCardResponse,
                    },
                    { filename: `Instructions.pdf`, path: `./must_read.pdf` },
                ]
            );
        }

        // remove the admit card PDF and QR code image after sending email
        await deleteFiles(updatedData.merchantTransactionId);
    }

    if (req.query.id.startsWith("QC25")) {
        return res.redirect(`${quizchampUrl}/status/${req.query.id}`);
    }

    return res.redirect(`${frontendURL}/status/${req.query.id}`);
};

const checkStatus = async (req, res) => {

    try {
        const status = await paymentStatus(req.query.id);

        // get createdAt from database
        let createdAt = null;
        if (req.query.id.startsWith("HOPE")) {
            const record = await Donation.findOne({
                merchantTransactionId: req.query.id,
            });
            if (record) {
                createdAt = record.createdAt;
            }
        } else if (req.query.id.startsWith("QC25")) {
            const record = await QuizChamp.findOne({
                merchantTransactionId: req.query.id,
            });
            if (record) {
                createdAt = record.createdAt;
            }
        }

        // attach createdAt to status response
        if (createdAt) {
            status.createdAt = createdAt;
        }
    } catch (error) {
        console.error("Error in /status:", error);
        return res.status(500).json({
            error: "An error occurred while checking the payment status.",
        });
    }

    return res.json(status);
};

export {
    initiatePayment,
    initiateQuizChampPayment,
    processPayment,
    checkStatus,
    paymentConfirmation,
};
