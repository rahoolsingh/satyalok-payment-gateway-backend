import Admin from "../models/admin.model.js";

const verifyAdmin = async (req, res, next) => {
    const token = req?.cookies?.satTkn;

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Authentication token is missing.",
        });
    }

    try {
        const decoded = await Admin.verifyToken(token);
        req.admin = decoded; // Attach admin info to request object
        next(); // Proceed to the next middleware or route handler
    } catch (error) {
        console.error("Token verification failed:", error);
        return res.status(403).json({
            success: false,
            message: "Invalid or expired authentication token.",
        });
    }
};

export default verifyAdmin;
