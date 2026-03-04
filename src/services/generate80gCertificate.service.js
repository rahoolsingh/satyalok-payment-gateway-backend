/**
 * generate80gCertificate.service.js
 *
 * Wraps (and replicates) the logic of generateCertificate.service.js
 * but returns a Buffer instead of writing to disk.
 *
 * Works for BOTH PhonePe-created donations and admin-created ones.
 * The original generateCertificate.service.js is left completely unchanged.
 */

import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ─── Helpers (same as generateCertificate.service.js) ───────────────────────

const formatAmount = (amount) => {
    // amount is in RUPEES for admin donations; detect paise by checking scale
    // PhonePe sends paise (e.g., 10000 = ₹100), admin donations store rupees (e.g., 100 = ₹100).
    // We normalise both to rupees here.
    let rupees = amount;
    let paise = 0;
    let rupeesStr = rupees.toString();
    let lastThreeDigits = rupeesStr.slice(-3);
    let otherDigits = rupeesStr.slice(0, -3);
    if (otherDigits !== "") {
        otherDigits = otherDigits.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
        rupeesStr = otherDigits + "," + lastThreeDigits;
    } else {
        rupeesStr = lastThreeDigits;
    }
    return `${rupeesStr}.${String(paise).padStart(2, "0")}`;
};

const convertToTimestamp = (date) => {
    const d = new Date(date);
    const pad = (n) => n.toString().padStart(2, "0");
    return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Returns a Promise<Buffer> of the generated 80G certificate.
 *
 * Accepts any donation document (PhonePe or admin-created).
 * Automatically normalises fields so the original certificate layout works.
 */
const generate80GPDF = (donation) => {
    return new Promise(async (resolve, reject) => {
        try {
            // ── Normalise data ───────────────────────────────────────────────
            // PhonePe stores amount in PAISE inside pgResponse.data.amount
            // Admin donations store amount in RUPEES directly on donation.amount
            const isPhonePe = !!donation.pgResponse?.data?.amount;
            const amountRupees = isPhonePe
                ? Math.floor(donation.pgResponse.data.amount / 100)
                : donation.amount || 0;

            // Transaction ID to show on certificate
            const isPhonePeTxn = !!donation.pgResponse?.data?.transactionId;
            const displayTxnId = isPhonePeTxn
                ? donation.pgResponse.data.transactionId
                : donation.externalTransactionId ||
                  donation.merchantTransactionId;

            // Payment medium description (matches the user's requested format)
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

            const donationDate = convertToTimestamp(
                donation.donationDate || donation.createdAt,
            );
            const merchantTransactionId = donation.merchantTransactionId;
            const name = donation.name;
            const panNumber = donation.panNumber;

            // Confirmation sentence (as per user spec)
            const confirmationText = isPhonePeTxn
                ? `We confirm that we received a donation of Rs. ${formatAmount(amountRupees)} from ${name} on ${donationDate} via ${methodLabel}. Transaction ID: ${displayTxnId}.`
                : `We confirm that we received a donation of Rs. ${formatAmount(amountRupees)} from ${name} on ${donationDate} via ${methodLabel}.`;

            // ── QR code data ─────────────────────────────────────────────────
            const qrData = JSON.stringify({
                receipt: merchantTransactionId,
                pan: panNumber,
                txnId: displayTxnId,
            });

            let qrDataUrl;
            try {
                qrDataUrl = await QRCode.toDataURL(qrData, {
                    color: { dark: "#000000", light: "#00000000" },
                });
            } catch (qrErr) {
                console.warn(
                    "QR code generation failed, continuing without QR:",
                    qrErr.message,
                );
                qrDataUrl = null;
            }

            // ── PDF generation ───────────────────────────────────────────────
            const doc = new PDFDocument({
                layout: "landscape",
                size: "A4",
                margin: 60,
            });
            const chunks = [];
            doc.on("data", (chunk) => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            // Background image (same as original service)
            try {
                doc.image("certificate.png", 0, 0, { width: 841.89 });
            } catch {
                // certificate.png not found — graceful fallback with a plain background
                doc.rect(0, 0, 841.89, 595.28).fill("#fffbf0");
            }

            // Text fields (same positions as original generateCertificate.service.js)
            doc.fontSize(15)
                .font("Times-Roman")
                .fillColor("black")
                .text(merchantTransactionId, 160, 228)
                .text(donationDate, 670, 228)
                .text(name, 180, 257)
                .text(panNumber, 173, 287);

            // Donation amount in green bold (same style as original)
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

            // Stamp image (same as original)
            const randomX = Math.floor(Math.random() * 10) + 660;
            const randomY = Math.floor(Math.random() * 10) + 245;
            try {
                doc.image("stamp.png", randomX, randomY, { width: 80 });
            } catch {
                // stamp.png not found — skip silently
            }

            // QR code from dataURL
            if (qrDataUrl) {
                try {
                    // Convert dataURL to Buffer for pdfkit
                    const base64Data = qrDataUrl.replace(
                        /^data:image\/png;base64,/,
                        "",
                    );
                    const qrBuffer = Buffer.from(base64Data, "base64");
                    doc.image(qrBuffer, 705, 70, { width: 80, align: "right" });
                } catch (imgErr) {
                    console.warn("QR image embed failed:", imgErr.message);
                }
            }

            // Confirmation paragraph (same position as original)
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
