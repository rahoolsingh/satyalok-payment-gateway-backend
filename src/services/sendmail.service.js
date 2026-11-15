import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true, // Use true for SSL
    auth: {
        user: process.env.SMTP_USERNAME || process.env.SMTP_EMAIL,
        pass: process.env.SMTP_PASSWORD,
    },
    // Without explicit timeouts a dead or firewalled SMTP host can block a
    // request (or a cron worker) indefinitely. Fail fast instead, so receipt
    // delivery can be retried without stalling the payment flow.
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 10_000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 10_000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20_000),
});

const sendMail = (to, subject, text, html, attachments) => {
    const mailOptions = {
        from: process.env.SMTP_EMAIL,
        to,
        subject,
        text,
        html,
        attachments, // Add attachments here
    };

    return new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error("Error sending email:", error);
                reject(error);
            } else {
                console.log("Message sent:", info.messageId);
                resolve(info);
            }
        });
    });
};

const sendWithAttachment = async (to, subject, text, html, filesDetail) => {
    try {
        const attachment = filesDetail;

        await sendMail(to, subject, text, html, attachment);
        // console.log("Email sent successfully with attachment!");
    } catch (error) {
        console.error("Failed to send email with attachment:", error);
    }
};

export { sendMail, sendWithAttachment };
