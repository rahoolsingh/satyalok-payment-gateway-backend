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

const convertToTimestamp = (input) => {
    // Extract the date-time portion from the input string
    const dateTimePart = input.slice(1, 15); // Skip the 'T' and take 14 characters

    // Parse the date-time part into components
    const year = parseInt("20" + dateTimePart.slice(0, 2), 10); // Assuming the year is 20YY
    const month = dateTimePart.slice(2, 4);
    const day = dateTimePart.slice(4, 6);
    const hour = dateTimePart.slice(6, 8);
    const minute = dateTimePart.slice(8, 10);

    // Return the formatted string in the format "DD-MM-YYYY HH:MM"
    return `${day}-${month}-${year} ${hour}:${minute}`;
};

const generateCertificate = async ({
    merchantTransactionId,
    success,
    name,
    panNumber,
    pgResponse,
}) => {
    if (success !== pgResponse.success) {
        console.error("Data mismatch in generating certificate");
        return "Data mismatch";
    }

    const amount = pgResponse.data.amount;
    const donationDate = convertToTimestamp(pgResponse.data.transactionId);
    // Create a new PDF document
    const doc = new PDFDocument({
        layout: "landscape",
        size: "A4",
        margin: 60,
    });

    // Stream the PDF to a file
    doc.pipe(fs.createWriteStream(`${merchantTransactionId}.pdf`));

    // Add background image
    doc.image("certificate.png", 0, 0, { width: 841.89 });

    // Add text fields
    doc.fontSize(15)
        .font("Times-Roman")
        .fillColor("black")
        .text(merchantTransactionId, 160, 228)
        .text(donationDate, 670, 228)
        .text(name, 180, 257)
        .text(panNumber, 173, 287);

    // Add donation amount in green, bold font
    doc.font("Times-Bold")
        .fontSize(20)
        .fillColor("green")
        .text(`Rs. ${formatAmount(amount)}`, 550, 255, {
            align: "center",
        });

    // Add closing message
    doc.font("Times-Roman")
        .fontSize(10)
        .fillColor("black")
        .text("Thanks for your donation!", { align: "center" });

    // Add stamp image
    const randomX = Math.floor(Math.random() * 10) + 660;
    const randomY = Math.floor(Math.random() * 10) + 245;
    doc.image("stamp.png", randomX, randomY, { width: 80 });

    // Generate and add QR code, then finalize PDF
    QRCode.toFile(
        `${merchantTransactionId}-qr.png`,
        `{
    receipt: ${merchantTransactionId},
    pan: ${panNumber},
    phonePe: ${pgResponse.data.transactionId}
}
    `,
        {
            color: {
                dark: "#000000", // Blue dots
                light: "#0000", // Transparent background
            },
        }
    )
        .then(() => {
            // Add the QR code image to the PDF
            doc.image(`${merchantTransactionId}-qr.png`, 705, 70, {
                width: 80,
                align: "right",
            });

            // Add donation confirmation text
            doc.fontSize(14)
                .font("Helvetica")
                .fillColor("black")
                .text(
                    `We confirm that we received a donation of Rs. ${formatAmount(
                        amount
                    )} from ${name} on ${donationDate} via PhonePe Payment Gateway with Transaction ID: ${
                        pgResponse.data.transactionId
                    }.`,
                    60,
                    330,
                    {
                        align: "justify",
                        lineGap: 7,
                    }
                );

            // Finalize the PDF file after all content is added
            doc.end();
            console.log("PDF created successfully with QR code");
        })
        .catch((err) => {
            console.error("An error occurred:", err);
        });
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
                console.log("PDF file deleted successfully");
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
                console.log("QR code image deleted successfully");
                resolve();
            }
        });
    });
};

export { generateCertificate, deleteFiles };

export default generateCertificate;
