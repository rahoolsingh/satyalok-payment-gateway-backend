import {
    generateCertificate,
    deleteFiles,
} from "../services/generateCertificate.service.js";
import { sendMail, sendWithAttachment } from "../services/sendmail.service.js";

const testmail = async (req, res) => {
    const email = "rahulksingh3907@gmail.com";
    const subject = "Test Email";
    const message = "Hello, this is a test email!";

    try {
        await sendMail(email, subject, message, `<p>${message}</p>`);
        res.send("Email sent!");
    } catch (error) {
        res.status(500).send("Email failed to send.");
    }
};

const testMailWithAttachment = async (req, res) => {
    try {
        await generateCertificate();

        await sendWithAttachment(
            "rahulksingh3907@gmail.com",
            "Test Email with Attachment",
            "Hello, this is a test email with attachment!",
            "<p>Hello, this is a test email with attachment!</p>",
            "output.pdf",
            "./output.pdf"
        );

        await deleteFiles();

        res.send("Email sent with attachment!");
    } catch (error) {
        res.status(500).send("Email failed to send with attachment.");
    }
};

export { testmail, testMailWithAttachment };
