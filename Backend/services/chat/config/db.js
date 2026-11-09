import mongoose from "mongoose";

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {})
    console.log("Chat Database connected successfully");
  } catch (error) {
    console.error("Error connecting to the database:", error);
    process.exit(1);
  }
};

export default connectDB;