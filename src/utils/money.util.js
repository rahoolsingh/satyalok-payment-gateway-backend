/**
 * Money helpers.
 *
 * The existing Donation collection stores rupees (e.g. amount: 500), while the
 * PhonePe APIs expect paise. Every conversion in the recurring module goes
 * through these helpers so the two units never get mixed up.
 */

const PAISE_PER_RUPEE = 100;

/** Convert rupees (may be fractional) to integer paise. */
const toPaise = (rupees) => Math.round(Number(rupees) * PAISE_PER_RUPEE);

/** Convert integer paise to rupees. */
const toRupees = (paise) => Math.round(Number(paise)) / PAISE_PER_RUPEE;

/**
 * True when the value is a whole-rupee amount we are willing to charge.
 * Recurring mandates must be fixed amounts, so fractional rupees are rejected
 * outright instead of being silently rounded.
 */
const isWholeRupeeAmount = (value) => {
    const num = Number(value);
    return Number.isFinite(num) && Number.isInteger(num) && num > 0;
};

/** Format paise as an Indian-format rupee string, e.g. 125000 -> "1,250". */
const formatPaiseINR = (paise) => {
    const rupees = Math.round(Number(paise)) / PAISE_PER_RUPEE;
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    }).format(rupees);
};

/** Format a rupee value for display, e.g. 500 -> "₹500". */
const formatRupeesINR = (rupees) =>
    new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
    }).format(Number(rupees));

export {
    PAISE_PER_RUPEE,
    toPaise,
    toRupees,
    isWholeRupeeAmount,
    formatPaiseINR,
    formatRupeesINR,
};
