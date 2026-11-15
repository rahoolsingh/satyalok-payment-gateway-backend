import { randomRef } from "../utils/crypto.util.js";

/**
 * Deterministic, provider-safe reference generators.
 *
 * PhonePe limits ids to 63 characters and allows only letters, digits, `_` and
 * `-`. Reusing the *same* order id for a retry of the same attempt is what makes
 * our debit engine idempotent end to end.
 */

const PREFIX = {
    subscription: "SLSUB",
    cycleOrder: "SLD",
    setupOrder: "SLA",
    pledge: "PLG",
    recurringDonation: "HOPER",
};

const compactTime = (date = new Date()) => date.getTime().toString(36).toUpperCase();

/** PS-8F3K2A style public pledge reference. */
const newPledgeRef = () => `${PREFIX.pledge}-${randomRef(6)}`;

/**
 * Merchant subscription id, e.g. SLSUB-MC4X9T-8KQ2WD.
 * Immutable for the life of the mandate.
 */
const newMerchantSubscriptionId = () =>
    `${PREFIX.subscription}-${compactTime()}-${randomRef(6)}`;

/**
 * Order id for the first debit (which happens during mandate setup).
 */
const setupOrderId = (merchantSubscriptionId) =>
    `${PREFIX.setupOrder}-${suffix(merchantSubscriptionId)}-c0001`;

/**
 * Order id for cycle N attempt M, e.g. SLD-8KQ2WD-c0003-a2.
 *
 * Deterministic on purpose: if the redeem call times out and we retry, we send
 * the identical order id so the gateway can de-duplicate instead of double
 * charging. A genuinely new attempt (after a terminal failure) increments `a`.
 */
const cycleOrderId = ({ merchantSubscriptionId, cycleNumber, attempt = 1 }) => {
    const cycle = String(cycleNumber).padStart(4, "0");
    const tryNumber = String(attempt).padStart(2, "0");

    return `${PREFIX.cycleOrder}-${suffix(merchantSubscriptionId)}-c${cycle}-a${tryNumber}`;
};

/** Merchant transaction id written onto the Donation record for a debit. */
const recurringDonationTxnId = ({ merchantSubscriptionId, cycleNumber, attempt = 1 }) =>
    `${PREFIX.recurringDonation}-${suffix(merchantSubscriptionId)}-c${String(
        cycleNumber,
    ).padStart(4, "0")}-a${String(attempt).padStart(2, "0")}`;

const suffix = (merchantSubscriptionId) =>
    String(merchantSubscriptionId).split("-").pop().slice(0, 10);

export {
    PREFIX,
    newPledgeRef,
    newMerchantSubscriptionId,
    setupOrderId,
    cycleOrderId,
    recurringDonationTxnId,
};
