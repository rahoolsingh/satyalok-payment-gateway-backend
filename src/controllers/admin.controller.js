import mongoose from "mongoose";
import Admin from "../models/admin.model.js";
import QuizChamp from "../models/quizchamp.model.js";
import { sendMail, sendWithAttachment } from "../services/sendmail.service.js";
import {
    admitCardEmailTemplate,
    paymentEmailTemplate,
    otpEmailTemplate,
    donationReceiptEmailTemplate,
} from "../services/emailTemplate.js";
import generateAdmitCard, {
    deleteFiles,
} from "../services/generateAdmitCard.service.js";
import generate80GPDF from "../services/generate80gCertificate.service.js";
import Verification from "../models/verification.model.js";
import Donation from "../models/donation.model.js";

const adminLogin = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required.",
            });
        }

        // Find admin by email
        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        // Compare password
        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password.",
            });
        }

        // Generate OTP
        const generatedOtp = Math.floor(
            100000 + Math.random() * 900000,
        ).toString();

        // Check if an OTP already exists for this email
        let verificationRecord = await Verification.findOne({ email });

        if (verificationRecord) {
            // Update the existing record with the new OTP
            verificationRecord.otp = generatedOtp;
            verificationRecord.createdAt = Date.now();
        } else {
            // Create a new record
            verificationRecord = new Verification({
                email: email,
                otp: generatedOtp,
            });
        }
        await verificationRecord.save();

        // Send OTP via email
        const emailTemplate = otpEmailTemplate(generatedOtp);
        await sendMail(
            email,
            "Admin Login OTP - Satyalok",
            `Your OTP is ${generatedOtp}`,
            emailTemplate,
        );

        res.status(200).json({
            success: true,
            message: "OTP sent to your email.",
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const verifyAdminOTP = async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ message: "Email and OTP are required." });
    }

    try {
        const verificationRecord = await Verification.findOne({ email, otp });

        if (!verificationRecord) {
            return res.status(400).json({ message: "Invalid or expired OTP." });
        }

        // Find admin to generate token
        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res.status(400).json({ message: "Admin not found." });
        }

        const token = admin.generateAuthToken();

        // Update last login
        admin.lastLogin = Date.now();
        await admin.save();

        // Delete verification record
        await Verification.deleteOne({ email, otp });

        res.cookie("satTkn", token, {
            secure: process.env.NODE_ENV === "production" ? true : false,
            httpOnly: true,
            sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
            maxAge: 24 * 60 * 60 * 1000, // 1 day
        });

        res.status(200).json({
            success: true,
            message: "Login successful.",
        });
    } catch (error) {
        console.error("OTP Verification error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const adminLogout = async (req, res) => {
    try {
        // Clear the cookie
        res.clearCookie("satTkn", {
            secure: process.env.NODE_ENV === "production" ? true : false,
            httpOnly: true,
            sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
            maxAge: 0, // Set maxAge to 0 to delete the cookie
        });
        // Respond with success message
        res.status(200).json({
            success: true,
            message: "Logout successful.",
        });
    } catch (error) {
        console.error("Logout error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error during logout.",
        });
    }
};

const listStudents = async (req, res) => {
    try {
        // Fetch students from the database
        const students = await QuizChamp.find({});

        const filteredStudents = students.filter(
            (student) => student.success === true,
        );

        // Respond with the list of students
        res.status(200).json({
            data: filteredStudents,
            success: true,
            message: "Students fetched successfully.",
        });
    } catch (error) {
        console.error("Error fetching students:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const resendEmail = async (req, res) => {
    try {
        const { id } = req.query; // Get student ID from query parameter

        // Validate ID
        if (!id || !mongoose.isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing student ID",
            });
        }

        // Find student in QuizChamp collection
        const student = await QuizChamp.findById(id);
        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found",
            });
        }

        // If payment is not successful, send only payment receipt email
        if (!student.success) {
            const emailTemplate = paymentEmailTemplate(
                student.amount,
                student.merchantTransactionId,
                student.createdAt,
                student.pgResponse?.data?.transactionId || "N/A",
                student.name,
                student.success,
            );

            await sendMail(
                student.email,
                "Payment Receipt From Satyalok - A New Hope",
                `Thank you for your payment! INR ${student.amount} has been received from ${student.name} on ${student.createdAt}.`,
                emailTemplate,
            );

            // Update sendMail flag
            await QuizChamp.updateOne({ _id: id }, { sendMail: true });

            return res.status(200).json({
                success: true,
                message: "Payment receipt mail resent successfully",
            });
        }

        // For successful payment, send payment receipt
        const emailTemplate = paymentEmailTemplate(
            student.amount,
            student.merchantTransactionId,
            student.createdAt,
            student.pgResponse?.data?.transactionId || "N/A",
            student.name,
            student.success,
        );

        await sendMail(
            student.email,
            "Payment Receipt From Satyalok - A New Hope",
            `Thank you for your payment! INR ${student.amount} has been received from ${student.name} on ${student.createdAt}.`,
            emailTemplate,
        );

        // Generate and send admit card
        const admitCardResponse = await generateAdmitCard(
            student.merchantTransactionId,
            student.success,
            student.name,
            student.roll,
            student.aadhaarNumber,
            student.fatherName,
            student.motherName,
            student.schoolName,
            student.mediumOfStudy,
            student.group,
            student.class,
            student.photo,
            student.pgResponse,
        );

        if (admitCardResponse !== "Payment not verified") {
            const admitCardEmail = admitCardEmailTemplate(
                student.roll,
                student.name,
                student.group,
            );

            await sendWithAttachment(
                student.email,
                "Admit Card for Quiz Competition",
                `Your admit card for the quiz competition is attached. Please keep it safe.`,
                admitCardEmail,
                [
                    {
                        filename: `${student.roll}.pdf`,
                        path: admitCardResponse,
                    },
                    { filename: `Instructions.pdf`, path: `./must_read.pdf` },
                ],
            );
        }

        // Remove the admit card PDF and QR code image after sending email
        await deleteFiles(student.merchantTransactionId);

        // Update sendMail flag
        await QuizChamp.updateOne({ _id: id }, { sendMail: true });

        // Respond with success
        return res.status(200).json({
            success: true,
            message: "Payment receipt and admit card mail resent successfully",
        });
    } catch (error) {
        console.error("Error resending mail:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while resending mail",
        });
    }
};

// Function to mark attendance for a student with timestamp and get the group from frontend
const markAttendance = async (req, res) => {
    const { roll, admitId, group } = req.body;

    console.log("Marking attendance for:", roll, admitId, group);

    try {
        // Validate input
        if (!roll || !admitId || !group) {
            return res.status(400).json({
                success: false,
                message: "Roll number, transaction ID, and group are required.",
            });
        }

        // Find student by roll number
        const student = await QuizChamp.findOne({
            roll,
            group,
        });

        if (!student) {
            return res.status(404).json({
                success: false,
                message: "Student not found or Group mismatch.",
            });
        }

        // check txnId match with merchantTransactionId
        if (student.merchantTransactionId !== admitId) {
            return res.status(400).json({
                success: false,
                message: "Reference ID does not match.",
            });
        }

        // Update attendance in IST (Indian Standard Time)
        student.attendance = true;
        student.attendanceTimeStamp = new Date().toLocaleString("en-US", {
            timeZone: "Asia/Kolkata",
        });

        await student.save();

        res.status(200).json({
            success: true,
            message: "Attendance marked successfully.",
        });
    } catch (error) {
        console.error("Error marking attendance:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const checkAdminAuth = async (req, res) => {
    // If request reaches here, verifyAdmin middleware already passed
    res.status(200).json({ success: true, message: "Authenticated." });
};

const getDonations = async (req, res) => {
    try {
        const {
            search,
            startDate,
            endDate,
            minAmount,
            maxAmount,
            paymentMethod,
            status, // "success" | "failed"
        } = req.query;

        let query = { isDeleted: { $ne: true } };

        // Default date range: last 7 days if no dates provided
        const end = endDate ? new Date(endDate) : new Date();
        end.setHours(23, 59, 59, 999);
        const start = startDate
            ? new Date(startDate)
            : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
        start.setHours(0, 0, 0, 0);
        query.createdAt = { $gte: start, $lte: end };

        if (search) {
            const orConditions = [
                { name: { $regex: search, $options: "i" } },
                { email: { $regex: search, $options: "i" } },
                { merchantTransactionId: { $regex: search, $options: "i" } },
                { externalTransactionId: { $regex: search, $options: "i" } },
            ];
            if (!isNaN(search)) {
                orConditions.push({ mobile: Number(search) });
            }
            query.$or = orConditions;
        }

        if (minAmount || maxAmount) {
            query.amount = {};
            if (minAmount) query.amount.$gte = Number(minAmount);
            if (maxAmount) query.amount.$lte = Number(maxAmount);
        }

        if (paymentMethod) {
            query.paymentMethod = paymentMethod;
        }

        if (status === "success") {
            query.success = true;
        } else if (status === "failed") {
            query.success = false;
        }

        // Only send required fields — exclude raw pg response to keep payload light
        const projection = {
            name: 1,
            email: 1,
            mobile: 1,
            amount: 1,
            merchantTransactionId: 1,
            externalTransactionId: 1,
            success: 1,
            taxBenefit: 1,
            panNumber: 1,
            paymentMethod: 1,
            createdByAdmin: 1,
            donationDate: 1,
            createdAt: 1,
        };

        const donations = await Donation.find(query, projection).sort({
            createdAt: -1,
        });

        // Compute summary stats
        const successDonations = donations.filter((d) => d.success);
        const totalAmount = successDonations.reduce(
            (sum, d) => sum + (d.amount || 0),
            0,
        );
        const avgAmount =
            successDonations.length > 0
                ? Math.round(totalAmount / successDonations.length)
                : 0;

        res.status(200).json({
            success: true,
            data: donations,
            stats: {
                total: donations.length,
                successCount: successDonations.length,
                failedCount: donations.length - successDonations.length,
                totalAmount,
                avgAmount,
            },
            dateRange: { start, end },
            message: "Donations fetched successfully.",
        });
    } catch (error) {
        console.error("Error fetching donations:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const generate80GCertificate = async (req, res) => {
    try {
        const { id } = req.params;
        const donation = await Donation.findById(id);

        if (!donation) {
            return res
                .status(404)
                .json({ success: false, message: "Donation not found." });
        }
        if (!donation.taxBenefit || !donation.panNumber) {
            return res.status(400).json({
                success: false,
                message:
                    "This donation is not eligible for an 80G certificate (no taxBenefit or PAN).",
            });
        }

        const pdfBuffer = await generate80GPDF(donation);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="80G_${donation.merchantTransactionId}.pdf"`,
        );
        res.setHeader("Content-Length", pdfBuffer.length);
        res.end(pdfBuffer);
    } catch (error) {
        console.error("Error generating 80G certificate:", error);
        res.status(500).json({
            success: false,
            message: "Failed to generate certificate.",
        });
    }
};

const createOfflineDonation = async (req, res) => {
    try {
        const {
            name,
            email,
            amount,
            mobile,
            paymentMethod,
            panNumber,
            taxBenefit,
            externalTransactionId,
            donationDate,
        } = req.body;

        if (!name || !email || !amount || !mobile) {
            return res.status(400).json({
                success: false,
                message: "Required fields are missing.",
            });
        }

        if (taxBenefit && !panNumber) {
            return res.status(400).json({
                success: false,
                message: "PAN number is required for 80G tax benefit.",
            });
        }

        // Generate a unique receipt ID similar to PhonePe format but suffixed with -M
        // Retry up to 5 times to guarantee uniqueness
        let merchantTransactionId;
        let attempts = 0;
        while (attempts < 5) {
            const ts = Date.now();
            const rand = Math.floor(Math.random() * 9000) + 1000;
            const candidate = `OMO${ts}${rand}-M`;
            const existing = await Donation.findOne({
                merchantTransactionId: candidate,
            }).lean();
            if (!existing) {
                merchantTransactionId = candidate;
                break;
            }
            attempts++;
        }
        if (!merchantTransactionId) {
            // Absolute failsafe: use a UUID-style random string
            merchantTransactionId = `OMO-M-${mongoose.Types.ObjectId()}`;
        }

        const newDonation = new Donation({
            name,
            email,
            amount: Number(amount),
            mobile: Number(mobile),
            merchantTransactionId,
            externalTransactionId: externalTransactionId || null,
            donationDate: donationDate ? new Date(donationDate) : new Date(),
            success: true,
            createdByAdmin: true,
            paymentMethod: paymentMethod || "cash",
            panNumber: panNumber || null,
            taxBenefit: taxBenefit || false,
            sendMail: true,
            pgResponse: { adminCreated: true },
        });

        await newDonation.save();

        const emailTemplate = donationReceiptEmailTemplate(
            newDonation.amount,
            newDonation.merchantTransactionId,
            new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }),
            "N/A",
            newDonation.name,
            true,
            newDonation.taxBenefit,
        );

        await sendMail(
            newDonation.email,
            "Donation Receipt - Satyalok",
            `Thank you for your generous donation of INR ${newDonation.amount}.`,
            emailTemplate,
        );

        res.status(201).json({
            success: true,
            message: "Donation added successfully.",
            data: newDonation,
        });
    } catch (error) {
        console.error("Error creating offline donation:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const deleteAdminDonation = async (req, res) => {
    try {
        const { id } = req.params;
        const donation = await Donation.findById(id);

        if (req.user.email !== process.env.SUPER_ADMIN_EMAIL) {
            return res.status(403).json({
                success: false,
                message:
                    "You are not authorized to delete this donation. Contact Super Admin.",
            });
        }

        if (!donation) {
            return res
                .status(404)
                .json({ success: false, message: "Donation not found." });
        }

        if (!donation.createdByAdmin) {
            return res.status(403).json({
                success: false,
                message: "Can only delete admin-created donations.",
            });
        }

        donation.isDeleted = true;
        await donation.save();

        res.status(200).json({
            success: true,
            message: "Donation deleted successfully.",
        });
    } catch (error) {
        console.error("Error deleting donation:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const resendDonationReceipt = async (req, res) => {
    try {
        const { id } = req.params;
        const donation = await Donation.findById(id);

        if (!donation) {
            return res
                .status(404)
                .json({ success: false, message: "Donation not found." });
        }

        const donationDateDisplay = new Date(
            donation.donationDate || donation.createdAt,
        ).toLocaleString("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });

        // Determine transaction ID for display (PG txn ID for PhonePe, external for manual, fallback to receipt ID)
        const pgTxnId = donation.pgResponse?.data?.transactionId || null;
        const displayTxnId = donation.externalTransactionId || pgTxnId || "N/A";

        const emailTemplate = donationReceiptEmailTemplate(
            donation.amount,
            donation.merchantTransactionId,
            donationDateDisplay,
            displayTxnId,
            donation.name,
            donation.success,
            donation.taxBenefit,
        );

        // Build optional 80G attachment
        let attachments = undefined;
        if (donation.taxBenefit && donation.panNumber) {
            try {
                const pdfBuffer = await generate80GPDF(donation);
                attachments = [
                    {
                        filename: `80G_${donation.merchantTransactionId}.pdf`,
                        content: pdfBuffer,
                        contentType: "application/pdf",
                    },
                ];
            } catch (pdfErr) {
                console.error(
                    "Failed to generate 80G PDF for attachment, sending receipt without it:",
                    pdfErr,
                );
            }
        }

        await sendMail(
            donation.email,
            "Donation Receipt - Satyalok",
            `Thank you for your generous donation of INR ${donation.amount}.`,
            emailTemplate,
            attachments,
        );

        res.status(200).json({
            success: true,
            message: "Receipt resent successfully.",
        });
    } catch (error) {
        console.error("Error resending receipt:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const adminForgotPassword = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res
            .status(400)
            .json({ success: false, message: "Email is required." });
    }

    try {
        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res
                .status(404)
                .json({ success: false, message: "Admin not found." });
        }

        const generatedOtp = Math.floor(
            100000 + Math.random() * 900000,
        ).toString();

        let verificationRecord = await Verification.findOne({ email });

        if (verificationRecord) {
            verificationRecord.otp = generatedOtp;
            verificationRecord.createdAt = Date.now();
        } else {
            verificationRecord = new Verification({
                email,
                otp: generatedOtp,
            });
        }
        await verificationRecord.save();

        const emailTemplate = otpEmailTemplate(generatedOtp);
        await sendMail(
            email,
            "Admin Password Reset OTP - Satyalok",
            `Your password reset OTP is ${generatedOtp}`,
            emailTemplate,
        );

        res.status(200).json({
            success: true,
            message: "Password reset OTP sent to your email.",
        });
    } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

const adminResetPassword = async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
        return res.status(400).json({
            success: false,
            message: "Email, OTP, and new password are required.",
        });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            message: "Password must be at least 6 characters long.",
        });
    }

    try {
        const verificationRecord = await Verification.findOne({ email, otp });

        if (!verificationRecord) {
            return res
                .status(400)
                .json({ success: false, message: "Invalid or expired OTP." });
        }

        const admin = await Admin.findOne({ email });
        if (!admin) {
            return res
                .status(404)
                .json({ success: false, message: "Admin not found." });
        }

        admin.password = newPassword;
        await admin.save(); // Password will be hashed by pre-save hook

        await Verification.deleteOne({ email, otp });

        res.status(200).json({
            success: true,
            message: "Password reset successful.",
        });
    } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error.",
        });
    }
};

export {
    adminLogin,
    verifyAdminOTP,
    listStudents,
    resendEmail,
    adminLogout,
    markAttendance,
    getDonations,
    createOfflineDonation,
    deleteAdminDonation,
    resendDonationReceipt,
    adminForgotPassword,
    adminResetPassword,
    checkAdminAuth,
    generate80GCertificate,
};
