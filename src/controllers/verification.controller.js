import jwt from "jsonwebtoken";
import Verification from "../models/verification.model.js";
import { otpEmailTemplate } from "../services/emailTemplate.js";
import { sendMail } from "../services/sendmail.service.js";
import QuizChamp from "../models/quizchamp.model.js";

const sendEmailVerificationOTP = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ message: "Email is required" });
    }

    try {
        const generatedOtp = Math.floor(
            100000 + Math.random() * 900000
        ).toString();

        // Check if an OTP already exists for this email
        let verificationRecord = await Verification.findOne({
            email: email,
        });

        if (verificationRecord) {
            // Update the existing record with the new OTP
            verificationRecord.otp = generatedOtp;
            verificationRecord.createdAt = Date.now(); // Reset the timestamp
        } else {
            // Create a new record if it doesn't exist
            verificationRecord = new Verification({
                email: email,
                otp: generatedOtp,
            });
        }
        await verificationRecord.save();

        // check if email exists in QuizChamp and success is true
        const quizChampRecord = await QuizChamp.findOne({
            email: email,
            success: true,
        });

        if (quizChampRecord) {
            // If the email exists in QuizChamp, return response already a participant check your mail for admit card
            return res.status(400).json({
                message:
                    "You are already a participant. Check your email for the admit card.",
            });
        }

        // Send the OTP via email
        const emailTemplate = otpEmailTemplate(generatedOtp);

        await sendMail(
            email,
            "Email Verification OTP",
            `Your OTP is ${generatedOtp}`,
            emailTemplate
        );

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully",
        });
    } catch (error) {
        console.error("Error sending OTP email:", error);
        return res.status(500).json({ message: "Failed to send OTP email" });
    }
};

const verifyEmailOTP = async (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ message: "Email and OTP are required" });
    }

    try {
        const verificationRecord = await Verification.findOne({
            email: email,
            otp: otp,
        });

        if (!verificationRecord) {
            return res.status(400).json({ message: "Invalid OTP" });
        }

        // jwt token
        const token = jwt.sign(
            { email: verificationRecord.email },
            process.env.JWT_SECRET_KEY,
            { expiresIn: "1h" }
        );

        // Delete the verification record after successful verification
        await Verification.deleteOne({ email: email, otp: otp });
        return res.status(200).json({
            success: true,
            message: "OTP verified successfully",
            token: token,
        });
    } catch (error) {
        console.error("Error verifying OTP:", error);
        return res.status(500).json({ message: "Failed to verify OTP" });
    }
};

// token verification middleware
const verifyToken = (req, res, next) => {
    //bearer token
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res
            .status(401)
            .json({ message: "Access denied. No token provided." });
    }

    jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
        if (err) {
            return res.status(400).json({ message: "Invalid token" });
        }
        req.user = decoded;
        next();
    });
};

export { sendEmailVerificationOTP, verifyEmailOTP, verifyToken };
