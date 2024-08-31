import { sendMail } from "../services/sendmail.service";

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

export { testmail };
