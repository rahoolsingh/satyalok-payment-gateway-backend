import axios from "axios";
import { AUTOPAY_CONFIG, isAutopayConfigured } from "../../config/recurring.config.js";
import { AppError, ProviderError } from "../../utils/appError.util.js";
import { sha256Hex, safeCompare } from "../../utils/crypto.util.js";

/**
 * PhonePe Autopay (subscriptions) v2 adapter.
 *
 * Auth differs from the legacy v1 one-time integration: Autopay v2 uses OAuth2
 * client credentials and an `Authorization: O-Bearer <token>` header, instead of
 * the `X-VERIFY` payload checksum.
 *
 * Every function here is a thin translation of one HTTP call. All business rules
 * (amounts, state transitions, retries) live in services/pledge.service.js.
 */

const HOSTS = {
    PRODUCTION: {
        pg: "https://api.phonepe.com/apis/pg",
        oauth: "https://api.phonepe.com/apis/identity-manager",
    },
    SANDBOX: {
        pg: "https://api-preprod.phonepe.com/apis/pg-sandbox",
        oauth: "https://api-preprod.phonepe.com/apis/pg-sandbox",
    },
};

const ENDPOINTS = {
    token: "/v1/oauth/token",
    setup: "/subscriptions/v2/setup",
    notify: "/subscriptions/v2/notify",
    redeem: "/subscriptions/v2/redeem",
    subscriptionStatus: (id) => `/subscriptions/v2/${encodeURIComponent(id)}/status`,
    orderStatus: (id) => `/subscriptions/v2/order/${encodeURIComponent(id)}/status`,
    cancel: (id) => `/subscriptions/v2/${encodeURIComponent(id)}/cancel`,
};

const REQUEST_TIMEOUT_MS = 15000;

const getHosts = () => HOSTS[AUTOPAY_CONFIG.env] || HOSTS.SANDBOX;

/** In-memory token cache. Refreshed 60s before expiry to avoid edge failures. */
let tokenCache = { accessToken: null, expiresAt: 0 };
let tokenInFlight = null;

const assertConfigured = () => {
    if (!isAutopayConfigured()) {
        throw new AppError(
            "Recurring donations are not enabled on this deployment yet.",
            503,
            "AUTOPAY_NOT_CONFIGURED",
        );
    }
};

/**
 * Normalise any axios/provider failure into a ProviderError carrying enough
 * context for the debit engine to choose between retry and terminal failure.
 */
const toProviderError = (operation, error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const providerCode = data?.code || error?.code || "UNKNOWN";
    const providerMessage =
        data?.message || error?.message || "Payment provider request failed";

    // A timeout/network error is ambiguous: the request may have been accepted.
    const isAmbiguous = !status || status >= 500;

    return new ProviderError(`PhonePe ${operation} failed: ${providerMessage}`, {
        operation,
        httpStatus: status || null,
        providerCode,
        providerMessage,
        isAmbiguous,
    });
};

/** Fetch (and cache) the OAuth access token. */
const getAccessToken = async ({ forceRefresh = false } = {}) => {
    assertConfigured();

    const now = Date.now();

    if (!forceRefresh && tokenCache.accessToken && tokenCache.expiresAt > now + 60_000) {
        return tokenCache.accessToken;
    }

    if (tokenInFlight) {
        return tokenInFlight;
    }

    const { oauth } = getHosts();

    tokenInFlight = (async () => {
        try {
            const body = new URLSearchParams({
                client_id: AUTOPAY_CONFIG.clientId,
                client_secret: AUTOPAY_CONFIG.clientSecret,
                client_version: String(AUTOPAY_CONFIG.clientVersion),
                grant_type: "client_credentials",
            });

            const { data } = await axios.post(`${oauth}${ENDPOINTS.token}`, body, {
                timeout: REQUEST_TIMEOUT_MS,
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });

            const accessToken = data?.access_token;

            if (!accessToken) {
                throw new ProviderError("PhonePe OAuth did not return an access token", {
                    operation: "authorize",
                });
            }

            tokenCache = {
                accessToken,
                expiresAt: now + Number(data?.expires_in || 900) * 1000,
            };

            return accessToken;
        } catch (error) {
            tokenCache = { accessToken: null, expiresAt: 0 };
            throw error instanceof ProviderError
                ? error
                : toProviderError("authorize", error);
        } finally {
            tokenInFlight = null;
        }
    })();

    return tokenInFlight;
};

/**
 * Authenticated POST/GET against the Autopay API, transparently refreshing the
 * access token once if it expired between calls.
 */
const call = async ({ method = "POST", path, data, query, operation, retry = 1 }) => {
    const send = async () => {
        const token = await getAccessToken();

        return axios({
            method,
            url: `${getHosts().pg}${path}`,
            data: method === "GET" ? undefined : data,
            params: query,
            timeout: REQUEST_TIMEOUT_MS,
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                Authorization: `O-Bearer ${token}`,
            },
        });
    };

    for (let attempt = 0; attempt <= retry; attempt += 1) {
        try {
            const response = await send();
            return response.data;
        } catch (error) {
            // PhonePe returns 401 when the token is no longer valid.
            if (error?.response?.status === 401 && attempt < retry) {
                await getAccessToken({ forceRefresh: true });
                continue;
            }

            throw toProviderError(operation, error);
        }
    }

    throw new ProviderError(`PhonePe ${operation} failed`, { operation });
};

/**
 * Build the `paymentFlow.paymentMode` block.
 *
 * UPI_COLLECT is what works in a desktop browser: the donor enters their UPI id
 * and approves the mandate in their app. UPI_INTENT is used on mobile where we
 * can hand off to a specific app.
 */
const buildPaymentMode = ({ channel, vpa, targetApp }) => {
    if (channel === "mobile" || AUTOPAY_CONFIG.setupMode === "UPI_INTENT") {
        return {
            type: "UPI_INTENT",
            targetApp: targetApp || "com.phonepe.app",
        };
    }

    return {
        type: "UPI_COLLECT",
        details: { vpa },
        message: "Satyalok monthly donation mandate",
    };
};

/**
 * Create a mandate (subscription setup).
 *
 * The first debit happens as part of authorisation because authWorkflowType is
 * TRANSACTION — the donor's first month is collected when the mandate is
 * approved, which is also the AFA step the RBI framework requires.
 */
const setupSubscription = async ({
    merchantOrderId,
    merchantSubscriptionId,
    amountPaise,
    maxAmountPaise,
    frequency,
    subscriptionExpireAt,
    orderExpireAt,
    metaInfo,
    channel,
    vpa,
    targetApp,
}) =>
    call({
        path: ENDPOINTS.setup,
        operation: "setup",
        data: {
            merchantOrderId,
            amount: amountPaise,
            expireAt: orderExpireAt,
            metaInfo,
            paymentFlow: {
                type: "SUBSCRIPTION_SETUP",
                merchantSubscriptionId,
                authWorkflowType: "TRANSACTION",
                amountType: "FIXED",
                maxAmount: maxAmountPaise,
                frequency,
                expireAt: subscriptionExpireAt,
                paymentMode: buildPaymentMode({ channel, vpa, targetApp }),
            },
        },
    });

/**
 * Pre-debit notification. Mandatory at least 24h before a debit and a
 * prerequisite for redemption.
 */
const notifyRedemption = async ({
    merchantOrderId,
    merchantSubscriptionId,
    amountPaise,
    expireAt,
    metaInfo,
}) =>
    call({
        path: ENDPOINTS.notify,
        operation: "notify",
        data: {
            merchantOrderId,
            amount: amountPaise,
            expireAt,
            metaInfo,
            paymentFlow: {
                type: "SUBSCRIPTION_REDEMPTION",
                merchantSubscriptionId,
                // CUSTOM = we drive each debit explicitly (auditable, and no
                // surprise back-to-back retries from the gateway).
                redemptionRetryStrategy: "CUSTOM",
                autoDebit: false,
            },
        },
    });

/** Execute the debit for a previously notified order. */
const redeem = async ({ merchantOrderId }) =>
    call({
        path: ENDPOINTS.redeem,
        operation: "redeem",
        data: { merchantOrderId },
    });

/** Current mandate state (state, amountType, maxAmount, frequency, expiry). */
const getSubscriptionStatus = async (merchantSubscriptionId) =>
    call({
        method: "GET",
        path: ENDPOINTS.subscriptionStatus(merchantSubscriptionId),
        query: { details: true },
        operation: "subscription-status",
        retry: 2,
    });

/** Redemption order status (covers both the notify and redeem steps). */
const getRedemptionOrderStatus = async (merchantOrderId) =>
    call({
        method: "GET",
        path: ENDPOINTS.orderStatus(merchantOrderId),
        query: { details: true },
        operation: "order-status",
        retry: 2,
    });

/** Merchant initiated cancellation. */
const cancelSubscription = async (merchantSubscriptionId) =>
    call({
        method: "POST",
        path: ENDPOINTS.cancel(merchantSubscriptionId),
        data: { merchantSubscriptionId },
        operation: "cancel",
    });

/**
 * Verify a PhonePe callback.
 *
 * PhonePe signs callbacks by sending `Authorization: sha256("<username>:<password>")`
 * using the credentials configured on the dashboard.
 */
const verifyWebhookSignature = (authorizationHeader) => {
    if (!AUTOPAY_CONFIG.webhookUsername || !AUTOPAY_CONFIG.webhookPassword) {
        console.error("Autopay webhook credentials are not configured; rejecting callback.");
        return false;
    }

    if (!authorizationHeader) {
        return false;
    }

    const expected = sha256Hex(
        `${AUTOPAY_CONFIG.webhookUsername}:${AUTOPAY_CONFIG.webhookPassword}`,
    );

    return safeCompare(expected, String(authorizationHeader).trim());
};

export {
    ENDPOINTS,
    HOSTS,
    getAccessToken,
    buildPaymentMode,
    setupSubscription,
    notifyRedemption,
    redeem,
    getSubscriptionStatus,
    getRedemptionOrderStatus,
    cancelSubscription,
    verifyWebhookSignature,
};


