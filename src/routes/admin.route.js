// auth routes
import express from "express";
import {
    adminLogin,
    verifyAdminOTP,
    adminLogout,
    listStudents,
    markAttendance,
    resendEmail,
    getDonations,
    createOfflineDonation,
    deleteAdminDonation,
    resendDonationReceipt,
    adminForgotPassword,
    adminResetPassword,
    checkAdminAuth,
    generate80GCertificate,
} from "../controllers/admin.controller.js";
import Admin from "../models/admin.model.js";
import verifyAdmin from "../middleware/verifyAdmin.middleware.js";
import {
    adminListPledges,
    adminGetPledge,
    adminCancelPledge,
    adminRetryDebit,
    adminSyncSetup,
} from "../controllers/pledge.controller.js";

const router = express.Router();

router.post("/login", adminLogin);
router.post("/verify-login-otp", verifyAdminOTP);

router.post("/forgot-password", adminForgotPassword);
router.post("/reset-password", adminResetPassword);

router.post("/logout", verifyAdmin, adminLogout);

router.get("/students", verifyAdmin, listStudents);

router.post("/resend", verifyAdmin, resendEmail);

router.post("/attendance", verifyAdmin, markAttendance);

// Donation Management Routes
router.get("/donations", verifyAdmin, getDonations);
router.post("/donations", verifyAdmin, createOfflineDonation);
router.delete("/donations/:id", verifyAdmin, deleteAdminDonation);
router.post(
    "/donations/:id/resend-receipt",
    verifyAdmin,
    resendDonationReceipt,
);
router.get(
    "/donations/:id/80g-certificate",
    verifyAdmin,
    generate80GCertificate,
);

// ─── Recurring pledges (monthly auto-debit mandates) ─────────────────────────
router.get("/pledges", verifyAdmin, adminListPledges);
router.post("/pledges/sync-setup", verifyAdmin, adminSyncSetup);
router.get("/pledges/:id", verifyAdmin, adminGetPledge);
router.post("/pledges/:id/cancel", verifyAdmin, adminCancelPledge);
router.post("/pledges/:id/retry", verifyAdmin, adminRetryDebit);

// Auth check (for frontend page refresh guard)
router.get("/me", verifyAdmin, checkAdminAuth);

//get function to create a new admin
router.post("/create", async (req, res) => {
    const { email, password } = req.body;

    try {
        // Validate input
        if (!email || !password) {
            return res
                .status(400)
                .json({ message: "Email and password are required." });
        }

        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email });
        if (existingAdmin) {
            return res.status(400).json({ message: "Admin already exists." });
        }

        // Create new admin
        const newAdmin = new Admin({ email, password });
        await newAdmin.save();

        res.status(201).json({ message: "Admin created successfully." });
    } catch (error) {
        console.error("Error creating admin:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

export default router;
