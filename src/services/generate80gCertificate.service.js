/**
 * generate80gCertificate.service.js
 *
 * Mirrors the layout & style of generateCertificate.service.js (same certificate.png
 * background, stamp.png, text positions) but returns a Buffer instead of writing to disk.
 *
 * Works for BOTH PhonePe-created and admin-created (offline) donations.
 * The original generateCertificate.service.js is left completely unchanged.
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ─── Helpers (mirrors generateCertificate.service.js) ───────────────────────

const formatAmount = (amount) => {
    // Admin donations store amount in RUPEES; PhonePe stores in paise inside pgResponse.
    // Here `amount` is always rupees.
    const rupeesStr = amount.toString();
    const lastThree = rupeesStr.slice(-3);
    const rest = rupeesStr.slice(0, -3);
    const formatted = rest
        ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + lastThree
        : lastThree;
    return `${formatted}.00`;
};

const formatDate = (donation) => {
    const d = new Date(donation.donationDate || donation.createdAt);
    const pad = (n) => n.toString().padStart(2, "0");
    const datePart = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;

    // Only show time if explicitly provided (donationTime field on the donation)
    if (donation.donationTime) {
        return `${datePart} ${donation.donationTime}`;
    }
    // PhonePe donations always have time embedded in createdAt (not admin-set): show it
    if (!donation.createdByAdmin) {
        return `${datePart} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    // Admin manual entry with no time given → date only
    return datePart;
};

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Returns a Promise<Buffer> of the 80G certificate PDF.
 * Accepts any donation document (PhonePe or admin-created offline).
 */
const generate80GPDF = (donation) => {
    return new Promise(async (resolve, reject) => {
        try {
            // ── Normalise data ────────────────────────────────────────────────
            // PhonePe: pgResponse.data.amount is in paise; admin stores rupees directly
            const isPhonePe = !!donation.pgResponse?.data?.amount;
            const amountRupees = isPhonePe
                ? Math.floor(donation.pgResponse.data.amount / 100)
                : donation.amount || 0;

            // Best transaction ID to show (external > PhonePe PG txn > receipt ID)
            const pgTxnId = donation.pgResponse?.data?.transactionId || null;
            const displayTxnId =
                donation.externalTransactionId ||
                pgTxnId ||
                donation.merchantTransactionId;

            // Payment medium label for confirmation sentence
            const paymentMethod = donation.paymentMethod || "phonepe";
            const methodLabel =
                {
                    phonepe: "PhonePe Payment Gateway",
                    cash: "Cash Payment",
                    upi: "UPI Transfer",
                    bank_transfer: "Bank Transfer",
                    cheque: "Cheque",
                    other: "Other",
                }[paymentMethod] ?? paymentMethod;

            const donationDateStr = formatDate(donation);
            const receiptId = donation.merchantTransactionId;
            const name = donation.name;
            const panNumber = donation.panNumber;

            // Confirmation sentence (user's exact requested format)
            const hasDisplayTxn = !!(donation.externalTransactionId || pgTxnId);
            const confirmationText = hasDisplayTxn
                ? `We confirm that we received a donation of Rs. ${formatAmount(amountRupees)} from ${name} on ${donationDateStr} via ${methodLabel}. Transaction ID: ${displayTxnId}.`
                : `We confirm that we received a donation of Rs. ${formatAmount(amountRupees)} from ${name} on ${donationDateStr} via ${methodLabel}.`;

            // ── QR code (in-memory) ───────────────────────────────────────────
            let qrBuffer = null;
            try {
                const qrDataUrl = await QRCode.toDataURL(
                    JSON.stringify({
                        receipt: receiptId,
                        pan: panNumber,
                        txnId: displayTxnId,
                    }),
                    { color: { dark: "#000000", light: "#00000000" } },
                );
                qrBuffer = Buffer.from(
                    qrDataUrl.replace(/^data:image\/png;base64,/, ""),
                    "base64",
                );
            } catch (qrErr) {
                console.warn(
                    "QR code generation failed, continuing without QR:",
                    qrErr.message,
                );
            }

            // ── Build PDF (same layout as generateCertificate.service.js) ────
            const doc = new PDFDocument({
                layout: "landscape",
                size: "A4",
                margin: 60,
            });
            const chunks = [];
            doc.on("data", (c) => chunks.push(c));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            // Background image
            try {
                doc.image("certificate.png", 0, 0, { width: 841.89 });
            } catch {
                doc.rect(0, 0, 841.89, 595.28).fill("#fffcf0");
            }

            // Text fields — exact same positions as the original service
            doc.fontSize(15)
                .font("Times-Roman")
                .fillColor("black")
                .text(receiptId, 160, 228) // Receipt / Reference ID
                .text(donationDateStr, 670, 228) // Date (+ time if provided)
                .text(name, 180, 257) // Donor name
                .text(panNumber, 173, 287); // PAN number

            // Transaction ID line (for manual entries — shown below PAN)
            if (donation.externalTransactionId) {
                doc.fontSize(12)
                    .font("Times-Roman")
                    .fillColor("black")
                    .text(
                        `Txn ID: ${donation.externalTransactionId}`,
                        173,
                        307,
                    );
            }

            // Amount — same green bold style as original
            doc.font("Times-Bold")
                .fontSize(20)
                .fillColor("green")
                .text(`Rs. ${formatAmount(amountRupees)}`, 550, 255, {
                    align: "center",
                });

            // Closing message
            doc.font("Times-Roman")
                .fontSize(10)
                .fillColor("black")
                .text("Thanks for your donation!", { align: "center" });

            // Stamp image
            const randomX = Math.floor(Math.random() * 10) + 660;
            const randomY = Math.floor(Math.random() * 10) + 245;
            try {
                doc.image("stamp.png", randomX, randomY, { width: 80 });
            } catch {
                // stamp.png not found — skip silently
            }

            // QR code from Buffer
            if (qrBuffer) {
                try {
                    doc.image(qrBuffer, 705, 70, { width: 80, align: "right" });
                } catch (imgErr) {
                    console.warn("QR embed failed:", imgErr.message);
                }
            }

            // Confirmation paragraph — same position as original service
            doc.fontSize(14)
                .font("Helvetica")
                .fillColor("black")
                .text(confirmationText, 60, 330, {
                    align: "justify",
                    lineGap: 7,
                });

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
};

export default generate80GPDF;
