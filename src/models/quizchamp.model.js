import mongoose from "mongoose";

const quizChampSchema = new mongoose.Schema(
    {
        photo: {
            type: String,
            required: true,
            trim: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        fatherName: {
            type: String,
            required: true,
            trim: true,
        },
        motherName: {
            type: String,
            required: true,
            trim: true,
        },

        email: {
            type: String,
            required: true,
            trim: true,
        },
        mobile: {
            type: Number,
            required: true,
        },
        group: {
            type: String,
            enum: ["A", "B"],
            required: true,
        },
        class: {
            type: String,
            trim: true,
        },
        schoolName: {
            type: String,
            trim: true,
        },
        mediumOfStudy: {
            type: String,
            enum: ["Hindi", "English"],
            required: true,
        },
        aadhaarNumber: {
            type: String,
            required: true,
            trim: true,
        },
        aadhaarCardPhoto: {
            type: String,
            required: true,
            trim: true,
        },
        currency: {
            type: String,
            required: true,
            default: "INR",
        },
        amount: {
            type: Number,
            required: true,
        },
        merchantTransactionId: {
            type: String,
            required: true,
            index: true,
            unique: true,
        },
        success: {
            type: Boolean,
            required: true,
            default: false,
        },
        pgResponse: {
            type: Object,
        },
        sendMail: {
            type: Boolean,
            required: true,
            default: false,
        },
    },
    { timestamps: true }
);

const QuizChamp = mongoose.model("QuizChamp", quizChampSchema);
export default QuizChamp;
