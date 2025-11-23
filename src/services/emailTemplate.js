// ==========================================
// SHARED CONSTANTS & STYLES
// ==========================================

const ASSETS = {
    logo: "https://res.cloudinary.com/drd5iva1i/image/upload/b_rgb:FFFFFF/v1730919455/b965f91b-321f-4ed6-97f9-1908840d5731.png",
    banner: "https://res.cloudinary.com/drd5iva1i/image/upload/v1730918082/Banner_yglwra.png",
    social: {
        facebook: "https://www.facebook.com/satyalok.official",
        linkedin: "https://www.linkedin.com/company/satyalok/",
        instagram: "https://instagram.com/satyalok.official"
    }
};

const COLORS = {
    primary: "#1376c8",
    success: "#16a34a",
    danger: "#dc2626",
    text: "#334155",
    textLight: "#64748b",
    bg: "#f8fafc",
    white: "#ffffff",
    border: "#e2e8f0"
};

// Common HTML Head
const EMAIL_HEAD = `
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Satyalok Notification</title>
    <style>
        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; background-color: ${COLORS.bg}; color: ${COLORS.text}; }
        .container { max-width: 600px; margin: 0 auto; background-color: ${COLORS.white}; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
        .content { padding: 32px 24px; }
        .header { padding: 24px; text-align: center; border-bottom: 1px solid ${COLORS.border}; }
        .footer { background-color: ${COLORS.bg}; padding: 24px; text-align: center; font-size: 12px; color: ${COLORS.textLight}; }
        .btn { display: inline-block; padding: 12px 24px; background-color: ${COLORS.primary}; color: white; text-decoration: none; border-radius: 6px; font-weight: bold; }
        .info-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .info-table td { padding: 12px 0; border-bottom: 1px solid ${COLORS.border}; color: ${COLORS.text}; }
        .info-table td:last-child { text-align: right; font-weight: 600; }
        .highlight-box { background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center; }
        @media only screen and (max-width: 600px) {
            .container { width: 100% !important; border-radius: 0; }
        }
    </style>
</head>
`;

// Shared Header Component
const getHeader = () => `
    <div class="header">
        <a href="https://satyalok.in" target="_blank">
            <img src="${ASSETS.logo}" alt="Satyalok Logo" width="160" style="display: block; margin: 0 auto; border: 0;" />
        </a>
    </div>
`;

// Shared Footer Component
const getFooter = () => `
    <div class="footer">
        <a href="https://maps.app.goo.gl/LGb2dZXFRAye2CJ8A" target="_blank" style="display: block; margin-bottom: 20px;">
            <img src="${ASSETS.banner}" alt="Satyalok Banner" width="100%" style="display: block; border-radius: 4px;" />
        </a>
        <p style="margin-bottom: 12px;">
            Satyalok - A New Hope<br>
            Nurturing the Future Together
        </p>
        <p style="margin-bottom: 12px;">
            <a href="${ASSETS.social.facebook}" style="color: ${COLORS.primary}; text-decoration: none; margin: 0 5px;">Facebook</a> • 
            <a href="${ASSETS.social.linkedin}" style="color: ${COLORS.primary}; text-decoration: none; margin: 0 5px;">LinkedIn</a> • 
            <a href="${ASSETS.social.instagram}" style="color: ${COLORS.primary}; text-decoration: none; margin: 0 5px;">Instagram</a>
        </p>
        <p style="font-size: 11px; line-height: 1.5; color: #94a3b8;">
            Security Alert: Satyalok will NEVER ask for your PIN, CVV, or Password. 
            <br>Questions? Email us at <a href="mailto:info@satyalok.in" style="color: ${COLORS.primary};">info@satyalok.in</a>
        </p>
        <p style="margin-top: 12px;">&copy; ${new Date().getFullYear()} Satyalok. All rights reserved.</p>
    </div>
`;

// ==========================================
// TEMPLATES
// ==========================================

const donationReceiptEmailTemplate = (
    amount,
    refNumber,
    paymentTime,
    transactionId,
    donorName,
    status,
    taxBenefit
) => {
    const statusColor = status ? COLORS.success : COLORS.danger;
    const statusText = status ? "Successful" : "Failed";

    return `
<!DOCTYPE html>
<html>
${EMAIL_HEAD}
<body>
    <div class="container">
        ${getHeader()}
        <div class="content">
            <h1 style="margin: 0 0 16px; font-size: 24px; color: ${COLORS.text}; text-align: center;">Thank You for Your Generosity! 🌟</h1>
            
            <p style="font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
                Dear <strong>${donorName}</strong>,<br><br>
                We are incredibly grateful for your support. Your contribution helps us continue our mission to bring education and healthcare to those who need it most.
            </p>

            <div class="highlight-box">
                <span style="display: block; font-size: 14px; color: ${COLORS.textLight}; margin-bottom: 4px;">Total Donation</span>
                <strong style="font-size: 32px; color: ${COLORS.primary};">₹${amount}</strong>
            </div>

            <table class="info-table">
                <tr><td>Reference ID</td><td>${refNumber}</td></tr>
                <tr><td>Transaction ID</td><td>${transactionId}</td></tr>
                <tr><td>Date & Time</td><td>${paymentTime}</td></tr>
                <tr><td>Payment Status</td><td style="color: ${statusColor}">${statusText}</td></tr>
                <tr><td>80G Tax Benefit</td><td>${taxBenefit ? "Applied ✅" : "Not Opted"}</td></tr>
            </table>

            ${taxBenefit 
                ? `<div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 12px; border-radius: 6px; font-size: 14px; color: #15803d; margin-top: 20px;">
                    <strong>Tax Benefit:</strong> Your donation is eligible for tax exemption under Section 80G. Please find the official certificate attached to this email.
                   </div>` 
                : ''}

            <p style="font-size: 14px; color: ${COLORS.textLight}; margin-top: 24px; text-align: center;">
                "The best way to find yourself is to lose yourself in the service of others."
            </p>
        </div>
        ${getFooter()}
    </div>
</body>
</html>`;
};

const paymentEmailTemplate = (
    amount,
    refNumber,
    paymentTime,
    transactionId,
    payerName,
    status
) => {
    const statusColor = status ? COLORS.success : COLORS.danger;
    const statusText = status ? "Successful" : "Failed";

    return `
<!DOCTYPE html>
<html>
${EMAIL_HEAD}
<body>
    <div class="container">
        ${getHeader()}
        <div class="content">
            <h2 style="margin: 0 0 16px; font-size: 22px; color: ${COLORS.text}; text-align: center;">Payment Confirmation</h2>
            
            <p style="font-size: 16px; line-height: 1.6; text-align: center;">
                Hi <strong>${payerName}</strong>, we have received your payment details.
            </p>

            <div style="text-align: center; margin: 24px 0;">
                <div style="display: inline-block; padding: 16px 32px; background-color: ${COLORS.bg}; border-radius: 8px; border: 1px solid ${COLORS.border};">
                    <div style="font-size: 12px; color: ${COLORS.textLight}; text-transform: uppercase; letter-spacing: 1px;">Amount Paid</div>
                    <div style="font-size: 28px; font-weight: bold; color: ${COLORS.text}; margin-top: 4px;">₹${amount}</div>
                </div>
            </div>

            <table class="info-table">
                <tr><td>Transaction ID</td><td style="font-family: monospace;">${transactionId}</td></tr>
                <tr><td>Reference No</td><td style="font-family: monospace;">${refNumber}</td></tr>
                <tr><td>Date</td><td>${paymentTime}</td></tr>
                <tr><td>Status</td><td style="color: ${statusColor};">${statusText}</td></tr>
            </table>

            <p style="font-size: 14px; color: ${COLORS.textLight}; margin-top: 20px; text-align: center;">
                If you have any questions regarding this transaction, please reply to this email.
            </p>
        </div>
        ${getFooter()}
    </div>
</body>
</html>`;
};

const admitCardEmailTemplate = (rollNumber, name, group) => {
    return `
<!DOCTYPE html>
<html>
${EMAIL_HEAD}
<body>
    <div class="container">
        ${getHeader()}
        <div class="content">
            <div style="text-align: center;">
                <h2 style="color: ${COLORS.primary}; margin-top: 0;">Admit Card Released 📋</h2>
                <p style="font-size: 16px; color: ${COLORS.text};">
                    Dear <strong>${name}</strong>, your admit card for <strong>Quiz Champ 2.0</strong> is ready.
                </p>
            </div>

            <div class="highlight-box" style="background-color: #fff7ed; border-color: #ffedd5;">
                <table style="width: 100%; text-align: left;">
                    <tr>
                        <td style="padding: 8px; color: ${COLORS.textLight}; font-size: 14px;">Candidate Name</td>
                        <td style="padding: 8px; font-weight: bold; color: ${COLORS.text};">${name}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; color: ${COLORS.textLight}; font-size: 14px;">Roll Number</td>
                        <td style="padding: 8px; font-weight: bold; font-family: monospace; font-size: 18px;">${rollNumber}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; color: ${COLORS.textLight}; font-size: 14px;">Group</td>
                        <td style="padding: 8px; font-weight: bold; color: ${COLORS.primary};">${group}</td>
                    </tr>
                </table>
            </div>

            <div style="text-align: center; margin-top: 24px;">
                <p style="margin-bottom: 8px; font-size: 14px;">📎 <strong>Please find your Admit Card attached below.</strong></p>
                <p style="font-size: 13px; color: ${COLORS.textLight};">Ensure you print this and bring it to the venue.</p>
            </div>
        </div>
        ${getFooter()}
    </div>
</body>
</html>`;
};

const otpEmailTemplate = (otp) => {
    return `
<!DOCTYPE html>
<html>
${EMAIL_HEAD}
<body>
    <div class="container">
        ${getHeader()}
        <div class="content">
            <div style="text-align: center;">
                <h2 style="color: ${COLORS.text}; margin-top: 0;">Verify Your Account 🔐</h2>
                <p style="font-size: 15px; color: ${COLORS.textLight}; margin-bottom: 24px;">
                    Please use the following One Time Password (OTP) to complete your verification process.
                </p>
                
                <div style="background-color: ${COLORS.bg}; border: 2px dashed ${COLORS.primary}; border-radius: 12px; padding: 20px; display: inline-block; min-width: 200px;">
                    <span style="font-size: 36px; font-weight: 800; color: ${COLORS.primary}; letter-spacing: 6px; font-family: monospace;">${otp}</span>
                </div>

                <p style="font-size: 13px; color: ${COLORS.danger}; margin-top: 24px;">
                    ⚠️ This OTP is valid for 10 minutes. Do not share this code with anyone.
                </p>
            </div>
        </div>
        ${getFooter()}
    </div>
</body>
</html>`;
};

export { 
    donationReceiptEmailTemplate, 
    paymentEmailTemplate, 
    admitCardEmailTemplate, 
    otpEmailTemplate 
};