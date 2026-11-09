import mongoose from "mongoose";

const connectDB = async () => {
  if (!process.env.MONGODB_URI) {
    console.log("Agent Service: No MONGODB_URI configured (agent uses Chat Service for persistence)");
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Agent Database connected successfully");
  } catch (error) {
    console.error("Warning: Agent Database connection failed:", error.message);
  }
};

export default connectDB;
