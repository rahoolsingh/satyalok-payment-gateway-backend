import crypto from "crypto";
import dotenv from "dotenv";
import { AppError } from "./appError.util.js";

dotenv.config();

/**
 * Security primitives for the recurring donation module.
 *
 *  - PAN is encrypted at rest with AES-256-GCM (authenticated encryption).
 *  - Magic links for the donor self-service portal are HMAC signed, expiring and
 *    bound to a single pledge + scope.
 *  - Webhook/API comparisons use timing safe equality to avoid leaking secrets.
 *
 * Keys come from the environment and are validated lazily so that the process
 * can still boot for local one-time-payment work without the recurring module
 * being configured.
 */

const KEY_VERSION = "v1";
const ENCRYPTION_ALGO = "aes-256-gcm";

const requireSecret = (name, minLength = 32) => {
    const value = process.env[name];

    if (!value || value.length < minLength) {
        throw new AppError(
            `${name} must be set to at least ${minLength} characters to use recurring donations.`,
            500,
            "CONFIG_ERROR",
        );
    }

    return value;
};

/** Derive a 32 byte AES key from an arbitrary length secret. */
const deriveEncryptionKey = () =>
    crypto
        .createHash("sha256")
        .update(requireSecret("PLEDGE_ENCRYPTION_KEY"))
        .digest();

const sha256Hex = (value) =>
    crypto.createHash("sha256").update(value, "utf8").digest("hex");

/** Constant time string comparison that never throws on length mismatch. */
const safeCompare = (a, b) => {
    if (typeof a !== "string" || typeof b !== "string") {
        return false;
    }

    const bufferA = Buffer.from(a, "utf8");
    const bufferB = Buffer.from(b, "utf8");

    if (bufferA.length !== bufferB.length) {
        // Still perform a comparison to keep the timing profile flat.
        crypto.timingSafeEqual(
            crypto.createHash("sha256").update(bufferA).digest(),
            crypto.createHash("sha256").update(bufferB).digest(),
        );
        return false;
    }

    return crypto.timingSafeEqual(bufferA, bufferB);
};

/**
 * HMAC-SHA256 keyed hash. Used for donor lookup keys and as part of signed
 * tokens instead of storing raw email/phone as a searchable index.
 */
const hmacHex = (value) =>
    crypto
        .createHmac("sha256", requireSecret("PLEDGE_HASH_PEPPER"))
        .update(String(value), "utf8")
        .digest("hex");

/**
 * Encrypt a sensitive field (PAN) for storage.
 * Output format: v1:<iv-base64>:<authTag-base64>:<ciphertext-base64>
 */
const encryptField = (plainText) => {
    if (plainText === undefined || plainText === null || plainText === "") {
        return null;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, deriveEncryptionKey(), iv);
    const ciphertext = Buffer.concat([
        cipher.update(String(plainText), "utf8"),
        cipher.final(),
    ]);

    return [
        KEY_VERSION,
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        ciphertext.toString("base64"),
    ].join(":");
};

/** Decrypt a field produced by encryptField. Throws if tampered with. */
const decryptField = (encrypted) => {
    if (!encrypted) {
        return null;
    }

    const parts = String(encrypted).split(":");

    if (parts.length !== 4 || parts[0] !== KEY_VERSION) {
        throw new AppError("Unsupported encrypted payload", 500, "DECRYPT_ERROR");
    }

    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGO,
        deriveEncryptionKey(),
        Buffer.from(ivB64, "base64"),
    );

    decipher.setAuthTag(Buffer.from(tagB64, "base64"));

    return Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final(),
    ]).toString("utf8");
};

/** Only the last 4 characters of a PAN are retained for display. */
const maskPan = (pan) => {
    if (!pan) {
        return "";
    }

    const value = String(pan).toUpperCase();
    return `${"X".repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`;
};

/** 9876543210 -> 98******10 */
const maskPhone = (phone) => {
    const value = String(phone || "").replace(/\D/g, "");

    if (value.length < 4) {
        return "****";
    }

    return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`;
};

/** a****@gmail.com */
const maskEmail = (email) => {
    const [local, domain] = String(email || "").split("@");

    if (!local || !domain) {
        return "****";
    }

    const head = local.slice(0, Math.min(2, local.length));
    return `${head}${"*".repeat(Math.max(local.length - 2, 2))}@${domain}`;
};

/** Random URL-safe identifier, used for subscription/order references. */
const randomRef = (length = 8) =>
    crypto
        .randomBytes(length)
        .toString("base64url")
        .replace(/[^A-Za-z0-9]/g, "")
        .slice(0, length)
        .toUpperCase();

const base64UrlEncode = (value) => Buffer.from(value, "utf8").toString("base64url");
const base64UrlDecode = (value) => Buffer.from(value, "base64url").toString("utf8");

export {
    sha256Hex,
    safeCompare,
    hmacHex,
    encryptField,
    decryptField,
    maskPan,
    maskPhone,
    maskEmail,
    randomRef,
    base64UrlEncode,
    base64UrlDecode,
};
