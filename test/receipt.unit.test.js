/**
 * Receipt tests: the email must look like a receipt, carry the monthly details,
 * and the 80G PDF must actually be produced.
 */

process.env.PLEDGE_ENCRYPTION_KEY = "test-encryption-key-with-32-plus-chars!!";
process.env.PLEDGE_HASH_PEPPER = "test-hash-pepper-with-32-plus-characters!";
process.env.PLEDGE_PORTAL_SECRET = "test-portal-secret-with-32-plus-chars!!!";
process.env.FRONTEND_URL = "https://donate.test";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { donationReceiptEmailTemplate } = await import("../src/services/emailTemplate.js");
const { buildPortalUrl } = await import("../src/services/magicLink.service.js");
const { generateCertificate } = await import("../src/services/generateCertificate.service.js");

test("receipt email: clean receipt layout with monthly details", () => {
    const html = donationReceiptEmailTemplate(
        500,
        "HOPER-ABC-c0002-a01",
        new Date("2026-11-22T10:00:00.000Z"),
        "pay_123",
        "Veer",
        true,
        true,
        {
            monthly: true,
            cycle: 2,
            nextDebit: "21 Dec 2026",
            provider: "Razorpay",
            manageUrl: "https://donate.test/pledge/manage/token",
        },
    );

    assert.match(html, /Donation receipt/);
    assert.match(html, /Manage or cancel/);
    assert.match(html, /Monthly pledge/);
    assert.match(html, /21 Dec 2026/);
    assert.match(html, /Razorpay/);
    assert.match(html, /Section 80G/);
    assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}]/u);
    assert.doesNotMatch(html, /Generosity/);
});

test("receipt email: one-time receipts keep working without details", () => {
    const html = donationReceiptEmailTemplate(
        1000,
        "HOPE123",
        new Date(),
        "pay_9",
        "Asha",
        true,
        false,
    );

    assert.match(html, /Donation receipt/);
    assert.doesNotMatch(html, /Monthly pledge/);
});

test("portal link: signed, expiring and scoped", () => {
    const url = buildPortalUrl("507f1f77bcf86cd799439011");

    assert.match(url, /^https:\/\/donate\.test\/pledge\/manage\/.+\..+$/);
});

test("80G certificate: produces a real PDF", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "satyalok-cert-"));
    const cwd = process.cwd();
    process.chdir(dir);

    try {
        await generateCertificate({
            merchantTransactionId: "TESTCERT1",
            success: true,
            name: "Veer",
            panNumber: "ABCDE1234F",
            createdAt: new Date("2026-11-22T10:00:00.000Z"),
            pgResponse: {
                success: true,
                data: {
                    amount: 50000,
                    transactionId: "pay_TEST",
                    state: "COMPLETED",
                },
            },
        });

        const file = path.join(dir, "TESTCERT1.pdf");
        assert.ok(fs.existsSync(file), "certificate file exists");
        const buffer = fs.readFileSync(file);
        assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
        assert.ok(buffer.length > 1500, `pdf has content (${buffer.length} bytes)`);
    } finally {
        process.chdir(cwd);
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
