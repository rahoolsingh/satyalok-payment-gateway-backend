/**
 * Minimal fixed-window rate limiter.
 *
 * Deliberately dependency-free (the project has no Redis client). State lives in
 * process memory, so behind multiple instances the effective limit is
 * `max * instances`. That is acceptable for abuse control on public endpoints;
 * swap the `store` for Redis if a hard global limit is ever required.
 */

const createStore = () => {
    const buckets = new Map();

    return {
        hit(key, windowMs) {
            const now = Date.now();
            const bucket = buckets.get(key);

            if (!bucket || bucket.resetAt <= now) {
                const fresh = { count: 1, resetAt: now + windowMs };
                buckets.set(key, fresh);
                return { count: 1, resetAt: fresh.resetAt };
            }

            bucket.count += 1;
            return { count: bucket.count, resetAt: bucket.resetAt };
        },

        /** Drop expired buckets so a long lived process does not leak keys. */
        sweep() {
            const now = Date.now();

            for (const [key, bucket] of buckets.entries()) {
                if (bucket.resetAt <= now) {
                    buckets.delete(key);
                }
            }
        },

        reset() {
            buckets.clear();
        },

        size() {
            return buckets.size;
        },
    };
};

const defaultStore = createStore();

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const cleanupTimer = setInterval(() => defaultStore.sweep(), CLEANUP_INTERVAL_MS);

// Do not keep the event loop alive because of a limiter.
cleanupTimer.unref?.();

/**
 * @param {object} options
 * @param {number} options.windowMs
 * @param {number} options.max
 * @param {string} options.name used in the response body/headers
 * @param {(req)=>string} [options.keyGenerator]
 */
const rateLimit = ({
    windowMs = 60_000,
    max = 30,
    name = "request",
    keyGenerator = (req) => req.ip || req.socket?.remoteAddress || "unknown",
    store = defaultStore,
} = {}) => (req, res, next) => {
    const key = `${name}:${keyGenerator(req)}`;
    const { count, resetAt } = store.hit(key, windowMs);
    const remaining = Math.max(max - count, 0);

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

    if (count > max) {
        res.setHeader("Retry-After", String(Math.ceil((resetAt - Date.now()) / 1000)));

        return res.status(429).json({
            success: false,
            code: "RATE_LIMITED",
            message: "Too many requests. Please wait a moment and try again.",
        });
    }

    return next();
};

export { rateLimit, createStore, defaultStore };
