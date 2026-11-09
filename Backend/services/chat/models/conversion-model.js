import mongoose from "mongoose";

const conversionSchema = new mongoose.Schema({
    title: {
        type: String,
        default: "New Conversation"
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}); 

// Compound index for querying user's conversations sorted by timestamp
conversionSchema.index({ userId: 1, timestamp: -1 });

// Register as 'Conversation' to satisfy Mongoose ref: 'Conversation' in message-model.js,
// explicitly targeting the existing 'conversions' MongoDB collection to prevent data loss.
const Conversation = mongoose.models.Conversation || mongoose.model("Conversation", conversionSchema, "conversions");

// Register 'Conversion' alias in Mongoose models to preserve backward compatibility
if (!mongoose.models.Conversion) {
    mongoose.model("Conversion", conversionSchema, "conversions");
}

export default Conversation;
