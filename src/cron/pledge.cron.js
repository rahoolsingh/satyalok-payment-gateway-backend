import cron from "node-cron";
import Pledge, { PLEDGE_STATUS } from "../models/pledge.model.js";
import { isRecurringEnabled } from "../config/recurring.config.js";
import {
    planAndNotify,
    executeRedemptions,
    reconcileInFlight,
} from "../services/pledgeDebit.service.js";
import { retryProviderCancels } from "../services/pledge.service.js";

/**
 * Recurring donation workers.
 *
 * All schedules are Asia/Kolkata so a "monthly on the 5th" pledge debits on a
 * predictable Indian calendar day. Workers are safe to run on every instance:
 * each unit of work is claimed with an atomic conditional update.
 */

const ENABLED = process.env.PLEDGE_CRON_ENABLED !== "false";
const TZ = { timezone: "Asia/Kolkata" };

const log = (message) => console.log(`[pledge-cron] ${message}`);

const guarded = (name, fn) => async () => {
    const startedAt = Date.now();

    try {
        const summary = await fn();

        log(`${name} done in ${Date.now() - startedAt}ms ${JSON.stringify(summary)}`);
    } catch (error) {
        console.error(`[pledge-cron] ${name} failed:`, error);
    }
};

/**
 * Abandon mandates the donor never approved. Without this, abandoned setup
 * attempts would sit in PENDING_AUTH forever and block the donor's pledge limit.
 */
const expireStaleMandates = async ({ hours = 48 } = {}) => {
    const cutoff = new Date(Date.now() - hours * 3600_000);

    const result = await Pledge.updateMany(
        {
            status: PLEDGE_STATUS.PENDING_AUTH,
            createdAt: { $lt: cutoff },
        },
        {
            $set: {
                status: PLEDGE_STATUS.AUTH_FAILED,
                authError: "Mandate was not approved in time.",
            },
        },
    );

    return { expired: result.modifiedCount || 0 };
};

if (ENABLED) {
    if (!isRecurringEnabled()) {
        log("Autopay credentials missing — recurring workers stay idle.");
    } else {
        // Pre-debit notifications: every hour at :05.
        cron.schedule("5 * * * *", guarded("planAndNotify", () => planAndNotify()), TZ);

        // Debits: every hour at :40 (after the 24h notice window has elapsed).
        cron.schedule(
            "40 * * * *",
            guarded("executeRedemptions", () => executeRedemptions()),
            TZ,
        );

        // Resolve anything stuck in flight.
        cron.schedule(
            "*/10 * * * *",
            guarded("reconcileInFlight", () => reconcileInFlight()),
            TZ,
        );

        // Retry gateway cancellations that failed.
        cron.schedule(
            "15 */6 * * *",
            guarded("retryProviderCancels", () => retryProviderCancels()),
            TZ,
        );

        // Housekeeping.
        cron.schedule("0 3 * * *", guarded("expireStaleMandates", expireStaleMandates), TZ);

        log("Recurring donation workers scheduled.");
    }
}

export { expireStaleMandates };
