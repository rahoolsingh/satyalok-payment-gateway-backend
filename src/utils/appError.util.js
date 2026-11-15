/**
 * Application level error with an HTTP status attached.
 *
 * Controllers convert these into a JSON response so that domain code can throw
 * meaningful errors without depending on express.
 */
class AppError extends Error {
    constructor(message, statusCode = 500, code = "INTERNAL_ERROR", meta = {}) {
        super(message);
        this.name = "AppError";
        this.statusCode = statusCode;
        this.code = code;
        this.meta = meta;
        this.isOperational = true;
        Error.captureStackTrace?.(this, AppError);
    }
}

class ValidationError extends AppError {
    constructor(message, meta = {}) {
        super(message, 400, "VALIDATION_ERROR", meta);
        this.name = "ValidationError";
    }
}

class NotFoundError extends AppError {
    constructor(message = "Resource not found") {
        super(message, 404, "NOT_FOUND");
        this.name = "NotFoundError";
    }
}

class ConflictError extends AppError {
    constructor(message, meta = {}) {
        super(message, 409, "CONFLICT", meta);
        this.name = "ConflictError";
    }
}

class ProviderError extends AppError {
    constructor(message, meta = {}) {
        super(message, 502, "PROVIDER_ERROR", meta);
        this.name = "ProviderError";
    }
}

/**
 * Express error handler for AppError instances. Anything unexpected becomes a
 * generic 500 without leaking internals to the client.
 */
const errorHandler = (error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    const isOperational = error instanceof AppError;

    if (!isOperational) {
        console.error("Unhandled error:", error);
    }

    return res.status(isOperational ? error.statusCode : 500).json({
        success: false,
        code: isOperational ? error.code : "INTERNAL_ERROR",
        message: isOperational
            ? error.message
            : "An unexpected error occurred. Please try again.",
    });
};

export {
    AppError,
    ValidationError,
    NotFoundError,
    ConflictError,
    ProviderError,
    errorHandler,
};
