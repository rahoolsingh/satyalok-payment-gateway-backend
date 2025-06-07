import mongoose from "mongoose";
import Admin from "../models/admin.model.js";
import QuizChamp from "../models/quizchamp.model.js";
import { sendMail, sendWithAttachment } from "../services/sendmail.service.js";
import {
    admitCardEmailTemplate,
    paymentEmailTemplate,
} from "../services/emailTemplate.js";
import generateAdmitCard, {
    deleteFiles,
} from "../services/generateAdmitCard.service.js";

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

        // Generate token
        const token = admin.generateAuthToken();

        // Update last login time
        admin.lastLogin = Date.now();
        await admin.save();

        // Set token in cookies
        res.cookie("satTkn", token, {
            secure: process.env.NODE_ENV === "production" ? true : false,
            httpOnly: true,
            sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
            maxAge: 24 * 60 * 60 * 1000, // 1 day
        });

        // Respond with admin data and token
        res.status(200).json({
            // data: {
            //     id: admin._id,
            //     name: admin.name,
            //     email: admin.email,
            //     lastLogin: admin.lastLogin,
            // },
            success: true,
            message: "Login successful.",
        });
    } catch (error) {
        console.error("Login error:", error);
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
            (student) => student.success === true
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
                student.success
            );

            await sendMail(
                student.email,
                "Payment Receipt From Satyalok - A New Hope",
                `Thank you for your payment! INR ${student.amount} has been received from ${student.name} on ${student.createdAt}.`,
                emailTemplate
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
            student.success
        );

        await sendMail(
            student.email,
            "Payment Receipt From Satyalok - A New Hope",
            `Thank you for your payment! INR ${student.amount} has been received from ${student.name} on ${student.createdAt}.`,
            emailTemplate
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
            student.pgResponse
        );

        if (admitCardResponse !== "Payment not verified") {
            const admitCardEmail = admitCardEmailTemplate(
                student.roll,
                student.name,
                student.group
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
                ]
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
    const { roll, txnId, group } = req.body;

    console.log("Marking attendance for:", roll, txnId, group);

    try {
        // Validate input
        if (!roll || !txnId || !group) {
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

export { adminLogin, listStudents, resendEmail, adminLogout, markAttendance };
