const donationReceiptEmailTemplate = (
    amount,
    refNumber,
    paymentTime,
    transactionId,
    donorName,
    status,
    taxBenefit
) => {
    return `
    <!DOCTYPE html>
<html lang="en" style="padding: 0; margin: 0">
    <head>
        <meta charset="UTF-8" />
        <meta name="x-apple-disable-message-reformatting" />
        <meta http-equiv="X-UA-Compatible" content="IE=edge" />
        <meta content="telephone=no" name="format-detection" />
        <title>Donation Confirmation</title>
        <link
            href="https://fonts.googleapis.com/css?family=Roboto:400,400i,700,700i"
            rel="stylesheet"
        />
        <link
            href="https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,400i,700,700i"
            rel="stylesheet"
        />
        <style type="text/css">
            /* Inline styles from provided template */
            /* ... (Place the styles from the original template here) ... */
        </style>
    </head>
    <body
        style="
            font-family: 'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif;
            width: 100%;
            padding: 0;
            margin: 0;
            background-color: #ffffff;
        "
    >
        <div style="background-color: #ffffff">
            <table
                class="es-wrapper"
                width="100%"
                cellspacing="0"
                cellpadding="0"
                style="width: 100%; background-color: #ffffff"
            >
                <tr>
                    <td valign="top" style="padding: 0; margin: 0">
                        <table
                            class="es-header"
                            cellspacing="0"
                            cellpadding="0"
                            align="center"
                            style="width: 100%; background-color: transparent"
                        >
                            <tr>
                                <td
                                    align="center"
                                    style="padding: 0; margin: 0"
                                >
                                    <table
                                        class="es-header-body"
                                        cellspacing="0"
                                        cellpadding="0"
                                        align="center"
                                        style="
                                            background-color: transparent;
                                            width: 600px;
                                        "
                                    >
                                        <tr>
                                            <td
                                                align="left"
                                                style="padding: 20px"
                                            >
                                                <table
                                                    width="100%"
                                                    cellspacing="0"
                                                    cellpadding="0"
                                                    style="width: 100%"
                                                >
                                                    <tr>
                                                        <td
                                                            align="center"
                                                            style="
                                                                padding: 0;
                                                                margin: 0;
                                                            "
                                                        >
                                                            <a
                                                                href="https://satyalok.in"
                                                                target="_blank"
                                                                
                                                            >
                                                                <img
                                                                    src="https://res.cloudinary.com/drd5iva1i/image/upload/b_rgb:FFFFFF/v1730919455/b965f91b-321f-4ed6-97f9-1908840d5731.png"
                                                                    alt="Satyalok"
                                                                    style="
                                                                        display: block;
                                                                        border: 0;
                                                                        width: 200px;
                                                                        background-color: #ffffff;
                                                                    "
                                                                />
                                                            </a>
                                                        </td>
                                                    </tr>
                                                    <tr>
                                                        <td
                                                            align="center"
                                                            style="
                                                                padding: 20px;
                                                            "
                                                        >
                                                            <h1
                                                                style="
                                                                    color: #333333;
                                                                    font-size: 24px;
                                                                    margin: 0;
                                                                "
                                                            >
                                                                Thank you for
                                                                your donation!
                                                            </h1>
                                                        </td>
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>

                        <!-- Donation Details -->
                        <table
                            class="es-content"
                            cellspacing="0"
                            cellpadding="0"
                            align="center"
                            style="width: 100%"
                        >
                            <tr>
                                <td
                                    align="center"
                                    style="padding: 0; margin: 0"
                                >
                                    <table
                                        class="es-content-body"
                                        style="
                                            width: 600px;
                                            background-color: #f7f7f7;
                                        "
                                    >
                                        <tr>
                                            <td
                                                style="
                                                    padding: 40px;
                                                    background-color: #f7f7f7;
                                                "
                                                align="left"
                                            >
                                                <p
                                                    style="
                                                        color: #363636;
                                                        font-size: 20px;
                                                        line-height: 30px;
                                                        font-weight: bold;
                                                    "
                                                >
                                                    Hi ${donorName},
                                                    <br />
                                                    Thank you for your generous
                                                    support!
                                                </p>
                                                <p
                                                    style="
                                                        color: #363636;
                                                        font-size: 16px;
                                                        line-height: 24px;
                                                    "
                                                >
                                                    Your donation will help us
                                                    in our mission, and we are
                                                    incredibly grateful for your
                                                    support. We are thrilled to
                                                    have you as a part of our
                                                    community. We hope you will
                                                    stay connected with us. 
                                                    <br />
                                                    <br />
                                                    ${
                                                        taxBenefit
                                                            ? "Your donation is eligible for tax benefit under section 80G of the Income Tax Act, 1961. Please find the attached certificate for the same. Your donation details are mentioned below. If you have to contact us at"
                                                            : "Your donation details are mentioned below. If you have any questions about your donation, please feel free to contact us at"
                                                    }
                                                    <a
                                                        href="mailto:info@satyalok.in"
                                                        style="
                                                            text-decoration: none;
                                                            color: #1376c8;
                                                        "
                                                    >
                                                        info@satyalok.in </a
                                                    >.

                                                    <br /><br />

                                                    Regards,
                                                    <br />
                                                    Team Satyalok
                                                </p>
                                                <table
                                                    width="100%"
                                                    cellspacing="0"
                                                    cellpadding="0"
                                                    style="
                                                        width: 100%;
                                                        border-bottom: 1px
                                                            dashed #323232;
                                                        margin: 20px 0;
                                                    "
                                                >
                                                    <tr>
                                                        <td
                                                            style="
                                                                padding: 0;
                                                                margin: 0;
                                                            "
                                                        ></td>
                                                    </tr>
                                                </table>

                                                <!-- Donation Info -->
                                                <!-- two col table with ref no and status -->
                                                <table
                                                    width="100%"
                                                    cellspacing="0"
                                                    cellpadding="0"
                                                    style="width: 100%"
                                                >
                                                    <tbody
                                                        style="
                                                            font-size: 18px;
                                                            color: #4f4f4f;
                                                            padding-top: 15px;
                                                        "
                                                    >
                                                        <tr
                                                            style="
                                                                padding: 0;
                                                                margin: 0;
                                                            "
                                                        >
                                                            <td
                                                                style="
                                                                    padding: 0;
                                                                    margin: 0;
                                                                "
                                                            >
                                                                <strong
                                                                    >Reference
                                                                    ID:</strong
                                                                >
                                                                ${refNumber}
                                                            </td>
                                                            <td
                                                                style="
                                                                    padding: 0;
                                                                    margin: 0;
                                                                    text-align: right;
                                                                    ${
                                                                        status
                                                                            ? "color: #008000"
                                                                            : "color: #ff0000"
                                                                    }
                                                                "
                                                            >
                                                                ${
                                                                    status
                                                                        ? "Success"
                                                                        : "Failed"
                                                                }
                                                            </td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                                <table
                                                    width="100%"
                                                    cellspacing="0"
                                                    cellpadding="0"
                                                    style="
                                                        width: 100%;
                                                        border-bottom: 1px
                                                            dashed #323232;
                                                        margin: 20px 0;
                                                    "
                                                >
                                                    <tr>
                                                        <td
                                                            style="
                                                                padding: 0;
                                                                margin: 0;
                                                            "
                                                        ></td>
                                                    </tr>
                                                </table>
                                                <p
                                                    style="
                                                        color: #4f4f4f;
                                                        font-size: 18px;
                                                        margin: 0;
                                                        line-height: 24px;
                                                    "
                                                >
                                                    <strong
                                                        >Date & Time:</strong
                                                    >
                                                    ${paymentTime}
                                                </p>
                                                <p
                                                    style="
                                                        color: #4f4f4f;
                                                        font-size: 18px;
                                                        margin: 0;
                                                        line-height: 24px;
                                                    "
                                                >
                                                    <strong
                                                        >Transaction ID:</strong
                                                    >
                                                    ${transactionId}
                                                </p>
                                                <p
                                                    style="
                                                        color: #4f4f4f;
                                                        font-size: 18px;
                                                        margin: 0;
                                                        line-height: 24px;
                                                    "
                                                >
                                                    <strong
                                                        >Opted Tax Benefit:</strong
                                                    >
                                                    ${
                                                        taxBenefit
                                                            ? "Yes (Please find the attached certificate)"
                                                            : "No"
                                                    }
                                                </p>
                                                

                                                <div
                                                    style="
                                                        font-size: 18px;
                                                        color: #4f4f4f;
                                                        padding-top: 15px;
                                                    "
                                                >
                                                    <strong
                                                        style="color: #008000"
                                                        >Total Donation: INR
                                                        ${amount}</strong
                                                    >
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                            <tr>
                                <td
                                    align="center"
                                    style="padding: 0; margin: 0"
                                >
                                <table
                                    class="es-content-body"
                                    style="
                                        width: 600px;
                                        background-color: #f7f7f7;
                                    "
                                >
                                    <tr>

                                        <td
                                            style="
                                                background-color: #f7f7f7;
                                            "
                                            align="left"
                                        >
                                        <a href="https://maps.app.goo.gl/LGb2dZXFRAye2CJ8A" target="_blank"
                                            style="text-decoration: none; color: #1376c8;">
                                            
                                        <img src="https://res.cloudinary.com/drd5iva1i/image/upload/v1730918082/Banner_yglwra.png" alt="Rating Banner" style="display: block; border: 0; width: 100%; background-color: #ffffff;" />
                                        </a>
                                        </td>

                                    </tr>
                                </table>
                                </td>
                            </tr>
                        </table>

                        <!-- Footer -->
                        <table
                            class="es-footer"
                            cellspacing="0"
                            cellpadding="0"
                            align="center"
                            style="width: 100%; background-color: transparent"
                        >
                            <tr>
                                <td
                                    align="center"
                                    style="padding: 0; margin: 0"
                                >
                                    <table
                                        class="es-footer-body"
                                        style="
                                            background-color: #f7f7f7;
                                            width: 600px;
                                        "
                                    >
                                        <tr>
                                            <td
                                                align="center"
                                                style="padding: 0px 40px 40px"
                                            >
                                                <p
                                                    style="
                                                        font-size: 12px;
                                                        border-top: #828282 1px
                                                            solid;
                                                        color: #828282;
                                                        line-height: 18px;
                                                        text-align: justify;
                                                        padding-top: 10px;
                                                    "
                                                >
                                                    Satyalok or representatives
                                                    will NEVER ask you for your
                                                    personal information i.e.
                                                    your bank account details,
                                                    password, PIN, CVV, OTP etc.
                                                    For your own safety, DO NOT
                                                    share these details with
                                                    anyone over phone, SMS or
                                                    email.
                                                    <a
                                                        href="mailto:info@satyalok.in"
                                                        style="
                                                            text-decoration: none;
                                                            color: #1376c8;
                                                        "
                                                        >info@satyalok.in</a
                                                    >.
                                                </p>
                                                <p
                                                    style="
                                                        font-size: 12px;
                                                        color: #828282;
                                                        line-height: 18px;
                                                    "
                                                >
                                                    Need assistance? Reach out
                                                    to us at
                                                    <a
                                                        href="mailto:info@satyalok.in"
                                                        style="
                                                            text-decoration: none;
                                                            color: #1376c8;
                                                        "
                                                        >info@satyalok.in</a
                                                    >.
                                                </p>

                                                <p
                                                    style="
                                                        font-size: 12px;
                                                        color: #828282;
                                                        line-height: 18px;
                                                    "
                                                >
                                                    Follow us on social media:
                                                    <a
                                                        href="https://www.facebook.com/satyalok.official"
                                                        style="
                                                            text-decoration: none;
                                                            color: #1376c8;
                                                        "
                                                        >Facebook</a
                                                    >
                                                    |
                                                    <a
                                                        href="https://www.linkedin.com/company/satyalok/"
                                                        style="
                                                            text-decoration: none;
                                                            color: #1376c8;
                                                        "
                                                        >LinkedIn</a
                                                    >
                                                    |
                                                    <a
                                                        href="https://instagram.com/satyalok.official"
                                                        style="
                                                            text-decoration: none;
                                                            color: #1376c8;
                                                        "
                                                        >Instagram</a
                                                    >
                                                </p>
                                                <p
                                                    style="
                                                        font-size: 12px;
                                                        color: #828282;
                                                        line-height: 18px;
                                                    "
                                                >
                                                    ©2024 - Satyalok. All rights
                                                    reserved.
                                                </p>
                                            </td>
                                        </tr>
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>
        </div>
    </body>
</html>

    `;
};

const paymentEmailTemplate = (
    amount,
    refNumber,
    paymentTime,
    transactionId,
    payerName,
    status
) => {
    return `
  <!DOCTYPE html>
  <html lang="en" style="padding: 0; margin: 0">
    <head>
      <meta charset="UTF-8" />
      <meta name="x-apple-disable-message-reformatting" />
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <meta name="format-detection" content="telephone=no" />
      <title>Payment Confirmation</title>
      <link href="https://fonts.googleapis.com/css?family=Roboto:400,700" rel="stylesheet" />
      <link href="https://fonts.googleapis.com/css?family=Source+Sans+Pro:400,700" rel="stylesheet" />
    </head>
    <body
      style="
        font-family: 'Source Sans Pro', 'Helvetica Neue', Arial, sans-serif;
        background-color: #f4f4f4;
        margin: 0;
        padding: 20px;
      "
    >
      <div style="max-width: 600px; margin: auto; background: #fff; padding: 30px; border-radius: 8px;">

        <!-- Logo Section -->
        <div style="text-align: center; margin-bottom: 20px;">
          <img
            src="https://res.cloudinary.com/drd5iva1i/image/upload/b_rgb:FFFFFF/v1730919455/b965f91b-321f-4ed6-97f9-1908840d5731.png"
            alt="Quiz Champ Logo"
            style="max-width: 160px; height: auto;"
          />
        </div>

        <h2 style="color: #2e86de; text-align: center;">Payment Confirmation</h2>
        <p style="font-size: 16px; color: #333;">
          Hello <strong>${payerName}</strong>,
        </p>
        <p style="font-size: 16px; color: #333;">
          Thank you for your payment. Here are the details of your transaction:
        </p>

        <table style="width: 100%; font-size: 15px; border-collapse: collapse; margin-top: 20px;">
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px;">Reference Number:</td>
            <td style="padding: 8px;"><strong>${refNumber}</strong></td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px;">Transaction ID:</td>
            <td style="padding: 8px;">${transactionId}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px;">Payment Time:</td>
            <td style="padding: 8px;">${paymentTime}</td>
          </tr>
          <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px;">Amount Paid:</td>
            <td style="padding: 8px;">₹${amount}</td>
          </tr>
          <tr>
            <td style="padding: 8px;">Status:</td>
            <td style="padding: 8px; color: ${
                status === "Success" ? "green" : "red"
            };"><strong>${status}</strong></td>
          </tr>
        </table>

        <p style="font-size: 15px; color: #666; margin-top: 20px;">
          If you have any questions or concerns, please feel free to contact our support team.
        </p>

        <p style="font-size: 15px; color: #333;">
          Regards,<br />
          Quiz Champ Team,<br />
          Satyalok - A New Hope
        </p>

        <hr style="margin-top: 30px;" />
        <p style="text-align: center; font-size: 13px; color: #999;">
          This is an automated email. Please do not reply.
        </p>
      </div>
    </body>
  </html>
  `;
};

export { donationReceiptEmailTemplate, paymentEmailTemplate };
