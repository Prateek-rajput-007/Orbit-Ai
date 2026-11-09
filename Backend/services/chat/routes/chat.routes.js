import express from "express";
import {
    createConversation,
    getConversations,
    updateConversation,
    deleteConversation,
    saveMessage,
    saveTurn,
    getMessages,
    updateMessageDeployment,
} from "../controllers/chat.controller.js";

const router = express.Router();

router.post("/create-conversation", createConversation);
router.get("/get-conversations", getConversations);
router.get("/get-messages/:conversationId", getMessages);
router.put("/update-conversation", updateConversation);
router.delete("/delete-conversation", deleteConversation);
router.post("/save-message", saveMessage);
router.post("/save-turn", saveTurn);
router.post("/update-deployment", updateMessageDeployment);

export default router;
