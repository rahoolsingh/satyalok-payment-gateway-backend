import express from "express";
import dotenv from "dotenv";
import { checkStatus, initiatePayment } from "./src/controllers/payment.controller.js";
import cors from "cors";

const app = express();

dotenv.config();
app.use(cors());
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

app.listen(PORT, () => {
    console.log("Server running on port 8000");
});
