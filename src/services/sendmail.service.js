import nodemailer from "nodemailer";

// Configure Nodemailer with Zoho SMTP settings
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, // Correct SMTP server for Zoho Mail
    port: process.env.SMTP_PORT, // Correct port for secure SMTP (SSL)
    secure: true, // Use true for SSL
    auth: {
        user: process.env.SMTP_EMAIL, 
        pass: process.env.SMTP_PASSWORD,
    },
});

const sendMail = (to, subject, text, html) => {
    const mailOptions = {
        from: process.env.SMTP_EMAIL, // sender address
        to, // list of receivers
        subject, // subject line
        text, // plain text body
        html, // html body
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

export { sendMail };
