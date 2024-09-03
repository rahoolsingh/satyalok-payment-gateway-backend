import PDFDocument from "pdfkit";
import fs from "fs";

// Helper function to wrap a stream in a promise
const streamToPromise = (stream) => {
    return new Promise((resolve, reject) => {
        stream.on("finish", resolve);
        stream.on("error", reject);
    });
};

const generateCertificate = async () => {
    const currentTime = new Date().toLocaleString();
    try {
        // Create a new PDF document
        const doc = new PDFDocument();

        // Define the output file path
        // const outputPath = path.resolve(__dirname, "../controllers/output.pdf");

        // Create a write stream to the output file
        const writeStream = fs.createWriteStream("./output.pdf");

        // Pipe the document to the write stream
        doc.pipe(writeStream);

        // Add content to the PDF
        doc.addPage().fontSize(25).text(`Time: ${currentTime}`, 100, 100);

        doc.save()
            .moveTo(100, 150)
            .lineTo(100, 250)
            .lineTo(200, 250)
            .fill("#FF3300");

        doc.scale(0.6)
            .translate(470, -380)
            .path("M 250,75 L 323,301 131,161 369,161 177,301 z")
            .fill("red", "even-odd")
            .restore();

        doc.addPage()
            .fillColor("blue")
            .text("Here is a link!", 100, 100)
            .underline(100, 100, 160, 27, { color: "#0000FF" })
            .link(100, 100, 160, 27, "http://google.com/");

        // Finalize the PDF
        doc.end();

        // Wait for the write stream to finish
        await streamToPromise(writeStream);

        console.log(`PDF successfully created`);
    } catch (error) {
        console.error("Failed to generate certificate:", error);
    }
};

const deleteCertificate = async () => {
    return new Promise((resolve, reject) => {
        fs.unlink("./output.pdf", (err) => {
            if (err) {
                console.error("Error deleting file:", err);
                reject(err);
            } else {
                console.log("File deleted successfully");
                resolve();
            }
        });
    });
};

export { deleteCertificate };

export default generateCertificate;
