import express from "express";
import dotenv from "dotenv";
import {
    checkStatus,
    initiatePayment,
    paymentConfirmation,
} from "./src/controllers/payment.controller.js";
import cors from "cors";
import connectDB from "./src/db/index.js";

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
    console.log(req.query);
    if (req.query.text) {
        return res.send(`Hello, ${req.query.text}!`);
    }
    res.send("Hello World!");
});

app.post("/order", initiatePayment);

app.get("/status", checkStatus);

app.get("/confirmation", paymentConfirmation);

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
});
