import { ValidationError } from "../utils/appError.util.js";

/**
 * Normalise the `Idempotency-Key` header.
 *
 * A donor double-tapping "Start my pledge" must not create two mandates. The key
 * is stored on the Pledge (unique index), so a replay returns the original
 * response instead of charging twice.
 */
const idempotency = (req, res, next) => {
    const raw = req.get("Idempotency-Key");

    if (!raw) {
        req.idempotencyKey = null;
        return next();
    }

    const key = String(raw).trim();

    if (key.length < 8 || key.length > 100 || !/^[A-Za-z0-9_-]+$/.test(key)) {
        return next(
            new ValidationError(
                "Idempotency-Key must be 8-100 characters using letters, digits, - or _.",
            ),
        );
    }

    req.idempotencyKey = key;

    return next();
};

export default idempotency;
