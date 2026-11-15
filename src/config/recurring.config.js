import dotenv from "dotenv";

dotenv.config();

/**
 * Single source of truth for everything the recurring donation programme is
 * allowed to charge. Nothing here is ever taken from the client — the request
 * only carries a plan id (or a custom amount that is clamped to these limits).
 */
export const RECURRING_RULES = {
    currency: "INR",

    // Hard bounds for any recurring debit.
    minAmount: Number(process.env.PLEDGE_MIN_AMOUNT || 100),
    maxAmount: Number(process.env.PLEDGE_MAX_AMOUNT || 10000),

    // RBI e-mandate framework 2026: recurring debits up to this value do not
    // need additional factor authentication after mandate registration.
    // Amounts above this would require per-debit AFA, so we refuse them.
    afaFreeLimitPerDebit: 15000,

    // How many active pledges a single donor (email/phone) may hold.
    maxActivePledgesPerDonor: 3,

    // Billing attempts before a pledge moves to PAST_DUE.
    maxRetriesPerCycle: 3,
    retryOffsetsDays: [1, 3, 7],

    // Mandate validity. RBI 2026 requires an explicit validity period.
    mandateValidityYears: Number(process.env.PLEDGE_VALIDITY_YEARS || 5),

    // Pre-debit notification lead time (RBI requires at least 24 hours).
    notifyLeadHours: Number(process.env.PLEDGE_NOTIFY_LEAD_HOURS || 26),
    // A redemption may only be executed inside this window after notify.
    redemptionWindowHours: 48,

    // Consent record version. Bump when terms change so consent is re-collected.
    consentVersion: process.env.PLEDGE_CONSENT_VERSION || "2026-11-v1",

    // Public pages used in emails / redirects.
    termsUrl: process.env.PLEDGE_TERMS_URL || "https://donate.satyalok.in/terms",
    privacyUrl: process.env.PLEDGE_PRIVACY_URL || "https://donate.satyalok.in/privacy",
    grievanceEmail: process.env.PLEDGE_GRIEVANCE_EMAIL || "support@satyalok.in",
};

/**
 * Pre-approved monthly giving tiers shown on the pledge page.
 * `impact` is donor-facing copy.
 */
export const RECURRING_PLANS = [
    {
        id: "monthly_500",
        amount: 500,
        frequency: "MONTHLY",
        label: "₹500 / month",
        title: "Sponsor a child's education",
        description: "Covers books, stationery and study material for one child.",
        impact: "1 child supported every month",
        highlighted: true,
    },
    {
        id: "monthly_1000",
        amount: 1000,
        frequency: "MONTHLY",
        label: "₹1,000 / month",
        title: "Fund a study centre day",
        description: "Helps run a community study centre for a full month.",
        impact: "2 children supported every month",
        highlighted: false,
    },
    {
        id: "monthly_2500",
        amount: 2500,
        frequency: "MONTHLY",
        label: "₹2,500 / month",
        title: "Sustain a mentor",
        description: "Contributes towards a mentor's monthly honorarium.",
        impact: "5 children supported every month",
        highlighted: false,
    },
];

/** Frequencies the pledge API accepts today. */
export const SUPPORTED_FREQUENCIES = ["MONTHLY"];

/**
 * Resolve a requested plan into the amount/frequency the server will charge.
 * Throws a ValidationError (status 400) for anything that is not allowed.
 *
 * The ValidationError class is injected so this module stays free of HTTP
 * concerns while pure domain logic remains unit-testable.
 */
export const resolvePlan = ({ planId, amount, frequency = "MONTHLY", ValidationError }) => {
    const preset = RECURRING_PLANS.find((plan) => plan.id === planId);

    let resolvedAmount;
    let resolvedFrequency = frequency;

    if (preset) {
        resolvedAmount = preset.amount;
        resolvedFrequency = preset.frequency;
    } else if (planId === "custom" || planId === undefined) {
        if (amount === undefined || amount === null || amount === "") {
            throw new ValidationError("An amount is required for a custom pledge.");
        }

        const numeric = Number(amount);

        if (!Number.isInteger(numeric)) {
            throw new ValidationError("Pledge amount must be a whole number of rupees.");
        }

        resolvedAmount = numeric;
    } else {
        throw new ValidationError("Unknown pledge plan.");
    }

    if (!SUPPORTED_FREQUENCIES.includes(resolvedFrequency)) {
        throw new ValidationError(
            `Unsupported frequency. Allowed: ${SUPPORTED_FREQUENCIES.join(", ")}.`,
        );
    }

    if (resolvedAmount < RECURRING_RULES.minAmount) {
        throw new ValidationError(
            `Minimum recurring amount is ₹${RECURRING_RULES.minAmount}.`,
        );
    }

    if (resolvedAmount > RECURRING_RULES.maxAmount) {
        throw new ValidationError(
            `Maximum recurring amount is ₹${RECURRING_RULES.maxAmount}.`,
        );
    }

    if (resolvedAmount > RECURRING_RULES.afaFreeLimitPerDebit) {
        throw new ValidationError(
            "Amounts above ₹15,000 need bank authentication on every debit, so they cannot be set up as an automatic monthly pledge.",
        );
    }

    return {
        amount: resolvedAmount,
        frequency: resolvedFrequency,
        planId: preset?.id || "custom",
    };
};

/**
 * PhonePe Autopay configuration. Kept separate from the legacy v1 (one-time)
 * PhonePe credentials in SALT_KEY / MERCHANT_ID because Autopay v2 uses OAuth2
 * client credentials instead of the checksum based v1 auth.
 */
export const AUTOPAY_CONFIG = {
    enabled: process.env.PHONEPE_AUTOPAY_ENABLED === "true",
    env: process.env.PHONEPE_AUTOPAY_ENV || "SANDBOX", // SANDBOX | PRODUCTION
    clientId: process.env.PHONEPE_AUTOPAY_CLIENT_ID,
    clientSecret: process.env.PHONEPE_AUTOPAY_CLIENT_SECRET,
    clientVersion: Number(process.env.PHONEPE_AUTOPAY_CLIENT_VERSION || 1),

    // Webhook username/password configured on the PhonePe dashboard.
    webhookUsername: process.env.PHONEPE_AUTOPAY_WEBHOOK_USERNAME,
    webhookPassword: process.env.PHONEPE_AUTOPAY_WEBHOOK_PASSWORD,

    // UPI_COLLECT works on desktop (donor enters UPI id);
    // UPI_INTENT works on mobile (opens the UPI app).
    setupMode: process.env.PHONEPE_AUTOPAY_SETUP_MODE || "UPI_COLLECT",

    redirectUrl:
        process.env.PLEDGE_REDIRECT_URL ||
        `${process.env.FRONTEND_URL || "https://donate.satyalok.in"}/pledge/status`,
};

/** True when every credential the Autopay adapter needs is present. */
export const isAutopayConfigured = () =>
    Boolean(AUTOPAY_CONFIG.clientId && AUTOPAY_CONFIG.clientSecret);
