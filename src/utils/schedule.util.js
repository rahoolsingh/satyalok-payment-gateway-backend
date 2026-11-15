/**
 * Billing schedule helpers.
 *
 * Recurring mandates are monthly, so all arithmetic is UTC based to avoid the
 * server timezone shifting a debit across midnight. `addMonthsClamped` keeps the
 * donor's original day-of-month (e.g. a pledge started on the 31st debits on the
 * 28th/30th in shorter months instead of drifting into the next month).
 */

const addMonthsClamped = (date, months) => {
    const source = new Date(date);
    const originalDay = source.getUTCDate();

    const shifted = new Date(
        Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months, 1),
    );

    const daysInTargetMonth = new Date(
        Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0),
    ).getUTCDate();

    shifted.setUTCDate(Math.min(originalDay, daysInTargetMonth));

    // Preserve the time of day from the source date.
    shifted.setUTCHours(
        source.getUTCHours(),
        source.getUTCMinutes(),
        source.getUTCSeconds(),
        source.getUTCMilliseconds(),
    );

    return shifted;
};

const addYears = (date, years) => addMonthsClamped(date, years * 12);

const addDays = (date, days) => new Date(new Date(date).getTime() + days * 86400_000);

const addHours = (date, hours) => new Date(new Date(date).getTime() + hours * 3600_000);

const addMinutes = (date, minutes) => new Date(new Date(date).getTime() + minutes * 60_000);

/**
 * Next debit timestamp for a pledge.
 *
 * The first debit already happened during mandate setup, so the next one is one
 * full cycle later.
 */
const computeNextDebitAt = ({ from, cyclesCompleted }) => addMonthsClamped(from, 1);

/** True when the pledge's mandate validity has elapsed. */
const isMandateExpired = (expiresAt, at = new Date()) =>
    Boolean(expiresAt) && new Date(expiresAt).getTime() <= new Date(at).getTime();

/** Whole days between two dates (used for retry backoff decisions). */
const daysBetween = (from, to) =>
    Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400_000);

export {
    addMonthsClamped,
    addYears,
    addDays,
    addHours,
    addMinutes,
    computeNextDebitAt,
    isMandateExpired,
    daysBetween,
};
