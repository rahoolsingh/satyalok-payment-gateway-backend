import express from "express";
import dotenv from "dotenv";
import {
    checkStatus,
    initiatePayment,
    paymentConfirmation,
} from "./src/controllers/payment.controller.js";
import cors from "cors";
import connectDB from "./src/db/index.js";
import { donationReceiptEmailTemplate } from "./src/services/emailTemplate.js";

const app = express();

dotenv.config();
app.use(
    cors({
        origin: process.env.FRONTEND_URL,
        methods: "GET,POST",
    })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 8000;

app.get("/", (req, res) => {
    // console.log(req.query);
    if (req.query.text) {
        return res.send(`Hello, ${req.query.text}!`);
    }
    res.status(200).send({
        message: "Johar",
        commitVersion: process.env.RENDER_GIT_COMMIT,
        alive: true,
    });
});

app.post("/order", initiatePayment);

app.get("/status", checkStatus);

app.get("/confirmation", paymentConfirmation);

app.get("/emailTemplate", (req, res) => {
    res.send(
        donationReceiptEmailTemplate(
            100,
            "123456",
            "2021-09-01",
            "123456",
            "PhonePe",
            "John Doe"
        )
    );
});

// connectDB().then(() => {
//     app.listen(PORT, () => {
//         console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
//     });
// });

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}: http://localhost:${PORT}`);
});
