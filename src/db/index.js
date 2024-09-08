import mongoose from "mongoose";

const DB_URI = process.env.MONGO_URI;
const DB_NAME = process.env.MONGO_DB_NAME;

const connectDB = async () => {
    try {
        await mongoose.connect(`${DB_URI}/${DB_NAME}`);
        console.log("MongoDB connected successfully");
    } catch (error) {
        console.error("MongoDB connection failed");
        process.exit(1);
    }
};

export default connectDB;
