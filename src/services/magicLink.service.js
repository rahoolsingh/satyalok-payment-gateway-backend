import crypto from "crypto";
import dotenv from "dotenv";
import { AppError } from "../utils/appError.util.js";
import { base64UrlEncode, base64UrlDecode } from "../utils/crypto.util.js";

dotenv.config();

/**
 * Donor self-service access without passwords.
 *
 * The donor gets a signed, expiring link by email. Holding the link proves
 * control of the mailbox that received it, which is the same assurance a
 * password reset would give — without creating a credential to steal.
 *
 * Cancel/pause through the portal is authorised by (a) a valid token and
 * (b) an additional email OTP for irreversible actions (see pledge controller).
 */

const TOKEN_VERSION = "v1";

const PORTAL_SCOPES = {
    MANAGE: "manage", // view + pause + resume + cancel
    RECEIPTS: "receipts", // download receipts only
};

const getSecret = () => {
    const secret = process.env.PLEDGE_PORTAL_SECRET || process.env.PLEDGE_ENCRYPTION_KEY;

    if (!secret || secret.length < 32) {
        throw new AppError(
            "PLEDGE_PORTAL_SECRET must be set to at least 32 characters.",
            500,
            "CONFIG_ERROR",
        );
    }

    return secret;
};

const sign = (payloadB64) =>
    crypto.createHmac("sha256", getSecret()).update(payloadB64, "utf8").digest("base64url");

const safeEqualStrings = (a, b) => {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);

    if (bufferA.length !== bufferB.length) {
        return false;
    }

    return crypto.timingSafeEqual(bufferA, bufferB);
};

/**
 * Create a portal token.
 * @param {object} params
 * @param {string} params.pledgeId
 * @param {string} [params.scope]
 * @param {number} [params.ttlSeconds] default 72 hours
 */
const createPortalToken = ({
    pledgeId,
    scope = PORTAL_SCOPES.MANAGE,
    ttlSeconds = 72 * 60 * 60,
}) => {
    const payload = {
        v: TOKEN_VERSION,
        pid: String(pledgeId),
        scope,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
        jti: crypto.randomBytes(12).toString("base64url"),
    };

    const payloadB64 = base64UrlEncode(JSON.stringify(payload));

    return `${payloadB64}.${sign(payloadB64)}`;
};

/**
 * Verify a portal token. Throws AppError(401) when invalid or expired.
 * @returns {{ pledgeId: string, scope: string, exp: number, jti: string }}
 */
const verifyPortalToken = (token) => {
    if (!token || typeof token !== "string") {
        throw new AppError("Missing access token.", 401, "INVALID_TOKEN");
    }

    const [payloadB64, signature] = token.split(".");

    if (!payloadB64 || !signature) {
        throw new AppError("Malformed access token.", 401, "INVALID_TOKEN");
    }

    if (!safeEqualStrings(sign(payloadB64), signature)) {
        throw new AppError("Invalid access token.", 401, "INVALID_TOKEN");
    }

    let payload;

    try {
        payload = JSON.parse(base64UrlDecode(payloadB64));
    } catch {
        throw new AppError("Malformed access token.", 401, "INVALID_TOKEN");
    }

    if (payload.v !== TOKEN_VERSION) {
        throw new AppError("Unsupported access token version.", 401, "INVALID_TOKEN");
    }

    if (!payload.exp || payload.exp * 1000 < Date.now()) {
        throw new AppError(
            "This link has expired. Request a new one from the pledge email.",
            401,
            "TOKEN_EXPIRED",
        );
    }

    return {
        pledgeId: payload.pid,
        scope: payload.scope,
        exp: payload.exp,
        jti: payload.jti,
    };
};

/** Build the full donor-facing URL for a pledge. */
const buildPortalUrl = (pledgeId, { scope = PORTAL_SCOPES.MANAGE, path = "" } = {}) => {
    const base =
        process.env.FRONTEND_URL || "https://donate.satyalok.in";
    const token = createPortalToken({ pledgeId, scope });

    return `${base.replace(/\/$/, "")}/pledge/manage/${token}${path}`;
};

export { PORTAL_SCOPES, createPortalToken, verifyPortalToken, buildPortalUrl };
