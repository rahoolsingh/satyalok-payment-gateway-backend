/**
 * Middleware: verifyApiKey
 * Validates the x-api-key header against the QCB_API_KEY environment variable.
 * Used for server-to-server calls from the Quiz Champ Backend.
 */
const verifyApiKey = (req, res, next) => {
    const apiKey = req.headers["x-api-key"];

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            message: "API key is missing.",
        });
    }

    if (apiKey !== process.env.QCB_API_KEY) {
        return res.status(401).json({
            success: false,
            message: "Invalid API key.",
        });
    }

    next();
};

export default verifyApiKey;
