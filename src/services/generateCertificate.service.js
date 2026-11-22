import PDFDocument from "pdfkit";
import fs from "fs";
import QRCode from "qrcode";

const formatAmount = (amount) => {
    let rupees = Math.floor(amount / 100);
    let paise = amount % 100;

    // Convert paise to a two-digit string
    paise = paise.toString().padStart(2, "0");

    // Format rupees according to Indian numbering system
    let rupeesStr = rupees.toString();
    let lastThreeDigits = rupeesStr.slice(-3);
    let otherDigits = rupeesStr.slice(0, -3);

    if (otherDigits !== "") {
        otherDigits = otherDigits.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
        rupeesStr = otherDigits + "," + lastThreeDigits;
    } else {
        rupeesStr = lastThreeDigits;
    }

    return `${rupeesStr}.${paise}`;
};

const convertToTimestamp = (isoString) => {
    const date = new Date(isoString);

    // Pad numbers with a leading zero if single digit (e.g., 9 -> 09)
    const pad = (num) => num.toString().padStart(2, '0');

    const day = pad(date.getDate());
    const month = pad(date.getMonth() + 1); // Months are 0-indexed
    const year = date.getFullYear();

    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());

    return `${day}-${month}-${year} ${hours}:${minutes}`;
}

const generateCertificate = async ({
    merchantTransactionId,
    success,
    name,
    panNumber,
    pgResponse,
    createdAt,
}) => {
    if (success !== pgResponse.success) {
        console.error("Data mismatch in generating certificate");
        return "Data mismatch";
    }

    const amount = pgResponse.data.amount;
    const donationDate = convertToTimestamp(createdAt);
    const txnId = pgResponse.data.transactionId || "";
    const pdfPath = `${merchantTransactionId}.pdf`;
    const qrPath = `${merchantTransactionId}-qr.png`;

    // QR carries the receipt and transaction only. The PAN is personal data and
    // must not be readable by anyone who photographs the certificate.
    await QRCode.toFile(
        qrPath,
        JSON.stringify({
            receipt: merchantTransactionId,
            transaction: txnId,
            amount: formatAmount(amount),
        }),
        { width: 180, margin: 1, color: { dark: "#1f1b16", light: "#ffffff" } },
    );

    const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margin: 0,
        info: {
            Title: `Donation Certificate ${merchantTransactionId}`,
            Author: "Satyalok - A New Hope",
            Subject: "Section 80G donation receipt",
        },
    });

    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const ink = "#1f1b16";
    const muted = "#6b6257";
    const line = "#cfc5b6";
    const paper = "#fdfbf7";
    const accent = "#0f5fa5";

    // Paper and double rule.
    doc.rect(0, 0, 841.89, 595.28).fill(paper);
    doc.rect(20, 20, 801.89, 555.28).lineWidth(2).stroke(ink);
    doc.rect(28, 28, 785.89, 539.28).lineWidth(0.6).stroke(line);

    // Letterhead.
    doc.fillColor(ink)
        .font("Helvetica-Bold")
        .fontSize(13)
        .text("S A T Y A L O K", 60, 48, { align: "center", width: 721.89 });
    doc.font("Times-Italic")
        .fontSize(11)
        .fillColor(muted)
        .text("A New Hope", 60, 66, { align: "center", width: 721.89 });

    doc.font("Times-Bold")
        .fontSize(30)
        .fillColor(ink)
        .text("Donation Certificate", 60, 100, { align: "center", width: 721.89 });
    doc.font("Helvetica")
        .fontSize(10)
        .fillColor(muted)
        .text("Section 80G  ·  Income Tax Act, 1961", 60, 140, {
            align: "center",
            width: 721.89,
        });

    // Certification sentence.
    doc.font("Helvetica")
        .fontSize(11)
        .fillColor(muted)
        .text("This is to certify that", 60, 186, { align: "center", width: 721.89 });
    doc.font("Times-Bold")
        .fontSize(24)
        .fillColor(ink)
        .text(String(name || ""), 60, 202, { align: "center", width: 721.89 });
    doc.font("Helvetica")
        .fontSize(11)
        .fillColor(muted)
        .text("has donated", 60, 238, { align: "center", width: 721.89 });
    doc.font("Times-Bold")
        .fontSize(20)
        .fillColor(accent)
        .text(`Rs. ${formatAmount(amount)}`, 60, 252, {
            align: "center",
            width: 721.89,
        });

    // Details.
    const rows = [
        ["Receipt number", merchantTransactionId],
        ["Transaction id", txnId || "—"],
        ["Date", donationDate],
        ["Payment mode", "UPI AutoPay"],
        ["PAN", panNumber || "—"],
    ];
    const startY = 304;
    rows.forEach(([label, value], index) => {
        const y = startY + index * 18;
        doc.font("Helvetica")
            .fontSize(9.5)
            .fillColor(muted)
            .text(label, 150, y, { width: 120 });
        doc.font("Helvetica-Bold")
            .fontSize(9.5)
            .fillColor(ink)
            .text(String(value), 280, y, { width: 280 });
    });

    // Declaration.
    const boxY = 410;
    doc.roundedRect(60, boxY, 721.89, 72, 6).fill("#f7f4ee");
    doc.font("Helvetica")
        .fontSize(9.5)
        .fillColor(muted)
        .text(
            "Donation is eligible for deduction under Section 80G of the Income Tax Act, 1961. " +
                "This certificate is issued for the donation referenced above and is valid without a physical signature.",
            76,
            boxY + 14,
            { width: 690, lineGap: 3 },
        );

    // QR + signature.
    doc.image(qrPath, 690, 452, { width: 76 });
    doc.font("Helvetica")
        .fontSize(8)
        .fillColor(muted)
        .text("Scan to verify", 682, 532, { width: 92, align: "center" });

    doc.moveTo(470, 520).lineTo(640, 520).lineWidth(0.8).stroke(line);
    doc.font("Times-Bold")
        .fontSize(11)
        .fillColor(ink)
        .text("For Satyalok - A New Hope", 470, 526, { width: 170, align: "center" });
    doc.font("Helvetica")
        .fontSize(8.5)
        .fillColor(muted)
        .text("Authorised signatory", 470, 540, { width: 170, align: "center" });

    doc.font("Helvetica")
        .fontSize(8)
        .fillColor(muted)
        .text(
            `Receipt ${merchantTransactionId}  ·  Generated ${donationDate}`,
            60,
            540,
            { width: 380 },
        );

    doc.end();

    await new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
    });

    fs.unlink(qrPath, () => {});
};

const deleteFiles = async (merchantTransactionId) => {
    return new Promise((resolve, reject) => {
        fs.unlink(`${merchantTransactionId}.pdf`, (err) => {
            if (err) {
                console.error(
                    "An error occurred while deleting PDF file:",
                    err
                );
                reject(err);
            } else {
                // console.log("PDF file deleted successfully");
                resolve();
            }
        });

        fs.unlink(`${merchantTransactionId}-qr.png`, (err) => {
            if (err) {
                console.error(
                    "An error occurred while deleting QR code image:",
                    err
                );
                reject(err);
            } else {
                // console.log("QR code image deleted successfully");
                resolve();
            }
        });
    });
};

export { generateCertificate, deleteFiles };

export default generateCertificate;
