const donationReceiptEmailTemplate = (
    amount,
    refNumber,
    paymentTime,
    transactionId,
    paymentMethod,
    donorName
) => {
    return `
        <html>
    <body
        style="
            margin: 0;
            padding: 0;
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            background-color: #e0e0e0; /* Lighter background */
            color: #333;
            font-size: 16px;
        "
    >
        <div style="padding: 20px; text-align: center">
            <div
                style="
                    max-width: 900px;
                    margin: auto;
                    background-color: #ffffff;
                    border-radius: 10px;
                    overflow: hidden;
                    padding: 20px;
                    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1); /* Slight shadow for depth */
                "
            >
                <!-- Header Section with Logo and Greeting -->
                <div style="padding: 20px">
                    <img
                        src="https://donate.satyalok.in/assets/logo-UoDita1I.png"
                        alt="Satyalok Logo"
                        style="
                            display: block;
                            margin-bottom: 20px;
                            margin-left: auto;
                            margin-right: auto;
                            height: 150px;
                            max-width: 100%;
                        "
                    />
                </div>
                <!-- Donation Confirmation Section -->
                <div style="padding: 10px">
                    <h2 style="margin: 0; color: #5c6bc0; font-size: 1.2em">
                        Dear Donor
                        <br />
                        Thank You for Your Donation!
                    </h2>
                    <p style="font-size: 0.9em; color: #555">
                        We are grateful for your generous donation of
                        <strong style="color: #0b8000">INR ${amount}</strong>
                        to Satyalok. Your contribution will help us in our
                        mission.
                    </p>
                </div>
                <!-- Donation Details Section -->
                <div
                    style="
                        padding: 20px;
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        text-align: left;
                        font-size: 0.8em;
                    "
                >
                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        <strong>Donor Name</strong>
                    </span>
                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        ${donorName}
                    </span>
                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        <strong>Donation Amount</strong>
                    </span>
                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        INR ${amount}
                    </span>

                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        <strong>Ref. Number</strong>
                    </span>
                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        ${refNumber}
                    </span>

                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        <strong>Transaction ID</strong>
                    </span>
                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        ${transactionId}
                    </span>

                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        <strong>Payment Time</strong>
                    </span>
                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        ${paymentTime}
                    </span>

                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        <strong>Payment Method</strong>
                    </span>
                    <span
                        style="
                            padding: 7px;
                            color: #555;
                            border: 1px solid #000;
                        "
                    >
                        ${paymentMethod}
                    </span>
                </div>
                <!-- Thank You Message Section -->
                <div style="padding: 20px; text-align: center">
                    <img
                        src="https://donate.satyalok.in/assets/card1-C-NOjy-6.png"
                        alt="Thank you cover image"
                        width="100%"
                        style="border-radius: 10px"
                    />
                </div>
                <div style="padding: 0px 20px; text-align: justify">
                    <p style="font-size: 0.7em; font-weight: 500">
                        Your contribution is greatly appreciated. Together, we
                        can make a meaningful difference. Thank you for helping
                        us move forward with our mission.
                    </p>
                </div>

                <div style="padding: 20px; text-align: center">
                    <a
                        href="https://donate.satyalok.in"
                        style="
                            cursor: pointer;
                            text-decoration: none;
                            color: #3f51b5;
                        "
                        onmouseover="this.style.color='#1e88e5';"
                        onmouseout="this.style.color='#3f51b5';"
                    >
                        Make Another Donation
                    </a>
                </div>
                <hr />
                <!-- Contact and Additional Info Section -->
                <div style="padding: 20px; text-align: left; color: #757575">
                    <p style="margin: 0; font-size: 0.8em">
                        <strong>Need assistance?</strong>
                        <br />
                        Reach out to us at
                        <a
                            href="mailto:info@satyalok.in"
                            style="
                                color: #5c6bc0;
                                text-decoration: none;
                                transition: color 0.3s;
                            "
                        >
                            info@satyalok.in </a
                        >.
                    </p>
                    <p
                        style="
                            margin: 5px 0;
                            color: #555;
                            font-size: 0.8em;
                            margin-top: 20px;
                        "
                    >
                        If you opted for a tax benefit, your certificate has
                        been sent to your email. Please check your inbox or spam
                        folder. For any issues, contact us at
                        <a
                            href="mailto:info@satyalok.in"
                            style="
                                color: #5c6bc0;
                                text-decoration: none;
                                transition: color 0.3s;
                            "
                        >
                            info@satyalok.in </a
                        >.
                    </p>
                </div>
                <!-- Footer Section -->
                <div style="padding: 20px; color: #b0b0b0">
                    <small style="font-size: 0.6em">
                        &copy; 2024 Satyalok Team. All rights reserved.
                    </small>
                </div>
            </div>
        </div>
    </body>
</html>

    `;
};

export { donationReceiptEmailTemplate };
