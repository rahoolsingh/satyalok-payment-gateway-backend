// auth routes
import express from "express";
import {
    adminLogin,
    adminLogout,
    listStudents,
    markAttendance,
    resendEmail,
} from "../controllers/admin.controller.js";
import Admin from "../models/admin.model.js";
import verifyAdmin from "../middleware/verifyAdmin.middleware.js";

const router = express.Router();

router.post("/login", adminLogin);

router.post("/logout", verifyAdmin, adminLogout);

router.get("/students", verifyAdmin, listStudents);

router.post("/resend", verifyAdmin, resendEmail);

router.post("/attendance", verifyAdmin, markAttendance);

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
