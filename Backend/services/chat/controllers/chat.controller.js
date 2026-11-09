import mongoose from 'mongoose';
import Conversation from '../models/conversion-model.js';
import Message from '../models/message-model.js';
import redis from '../../../shared/redis/redis.js';

const getOwnedConversation = (conversationId, userId) => {
    if (
        !mongoose.isValidObjectId(conversationId) ||
        !mongoose.isValidObjectId(userId)
    ) return null;
    return Conversation.findOne({ _id: conversationId, userId });
};

const invalidateConversationMemory = async (conversationId, userId) => {
    try {
        await redis.del(`messages-${userId}-${conversationId}`);
    } catch (error) {
        console.error("Unable to invalidate conversation memory cache:", error.message);
    }
};

export const createConversation = async (req, res) => {
    try {
        const userId = req.headers['user-id'];
        if (!userId || !mongoose.isValidObjectId(userId)) {
            return res.status(401).json({ message: 'Unauthorized', error: 'Unauthorized' });
        }
        const conversation = await Conversation.create({ userId: userId });

        res.status(201).json({ message: 'Conversation created successfully', conversation });
    } catch (error) {   
        res.status(500).json({ message: 'Error creating conversation', error: error.message });
    }
};

export const updateConversation = async (req, res) => {
    try {
        const { conversationId, title } = req.body;
        const userId = req.headers['user-id'];
        if (!userId || !mongoose.isValidObjectId(userId)) {
            return res.status(401).json({ message: 'Unauthorized', error: 'Unauthorized' });
        }
        if (!mongoose.isValidObjectId(conversationId)) {
            return res.status(404).json({ message: 'Conversation not found', error: 'Conversation not found' });
        }
        if (typeof title !== 'string' || !title.trim()) {
            return res.status(400).json({ message: 'A valid title is required', error: 'A valid title is required' });
        }
        const conversation = await Conversation.findOneAndUpdate(
            { _id: conversationId, userId },
            { title: title.trim(), timestamp: new Date() },
            { new: true, runValidators: true },
        );
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found', error: 'Conversation not found' });
        }
        res.status(200).json({ message: 'Conversation updated successfully', conversation });
    } catch (error) {
        res.status(500).json({ message: 'Error updating conversation', error: error.message });
    }   
};

export const deleteConversation = async (req, res) => {
    try {
        const { conversationId } = req.body;
        const userId = req.headers['user-id'];
        if (!userId || !mongoose.isValidObjectId(userId)) {
            return res.status(401).json({ message: 'Unauthorized', error: 'Unauthorized' });
        }
        if (!mongoose.isValidObjectId(conversationId)) {
            return res.status(404).json({ message: 'Conversation not found', error: 'Conversation not found' });
        }
        const conversation = await Conversation.findOneAndDelete({ _id: conversationId, userId });
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found', error: 'Conversation not found' });
        }
        await Message.deleteMany({ conversationId: conversationId });
        await invalidateConversationMemory(conversationId, userId);
        res.status(200).json({ message: 'Conversation and associated messages deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting conversation', error: error.message });
    }
};

const getConversations = async (req, res) => {
    try {
        const userId = req.headers['user-id'];
        if (!userId || !mongoose.isValidObjectId(userId)) {
            return res.status(401).json({ message: 'Unauthorized', error: 'Unauthorized' });
        }
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 200);
        const conversations = await Conversation.find({ userId: userId })
            .select('_id title timestamp updatedAt')
            .sort({ timestamp: -1, _id: -1 })
            .limit(limit);
        res.status(200).json({ message: 'Conversations retrieved successfully', conversations });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving conversations', error: error.message });
    }
};
export { getConversations };

export const saveMessage = async (req, res) => {
    try {
        const { conversationId, role, content } = req.body;
        const userId = req.headers['user-id'];
        if (!userId || !mongoose.isValidObjectId(userId)) {
            return res.status(401).json({ message: 'Unauthorized', error: 'Unauthorized' });
        }
        if (!["user", "assistant"].includes(role) || typeof content !== "string" || !content.trim()) {
            return res.status(400).json({ message: 'Valid role and content are required', error: 'Valid role and content are required' });
        }
        const conversation = await getOwnedConversation(conversationId, userId);
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found', error: 'Conversation not found' });
        }
        const message = await Message.create({ conversationId, role, content: content.trim() });
        conversation.timestamp = new Date();
        await conversation.save();
        await invalidateConversationMemory(conversationId, userId);
        res.status(201).json({ message: 'Message saved successfully', message });
    } catch (error) {
        res.status(500).json({ message: 'Error saving message', error: error.message });
    }
};

export const saveTurn = async (req, res) => {
    try {
        const { conversationId, userMessage, assistantMessage } = req.body;
        const userId = req.headers['user-id'];
        if (!userId || !mongoose.isValidObjectId(userId)) {
            return res.status(401).json({ message: 'Unauthorized', error: 'Unauthorized' });
        }
        if (
            typeof userMessage?.content !== "string" || !userMessage.content.trim() ||
            typeof assistantMessage?.content !== "string" || !assistantMessage.content.trim()
        ) {
            return res.status(400).json({ message: 'Valid user and assistant messages are required', error: 'Valid user and assistant messages are required' });
        }

        const conversation = await getOwnedConversation(conversationId, userId);
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found', error: 'Conversation not found' });
        }

        const messages = await Message.create([
            {
                conversationId,
                role: "user",
                content: userMessage.content.trim(),
                attachment: userMessage.attachment ?? null,
            },
            {
                conversationId,
                role: "assistant",
                content: assistantMessage.content.trim(),
                images: assistantMessage.images ?? [],
                searchResults: assistantMessage.searchResults ?? [],
                slides: assistantMessage.slides ?? [],
                presentationFile: assistantMessage.presentationFile ?? null,
                pdfDocument: assistantMessage.pdfDocument ?? null,
                codeArtifact: assistantMessage.codeArtifact ?? null,
                imageAttachment: assistantMessage.imageAttachment ?? null,
                suggestedQuestions: assistantMessage.suggestedQuestions ?? [],
            },
        ]);
        conversation.timestamp = new Date();
        await conversation.save();
        await invalidateConversationMemory(conversationId, userId);

        res.status(201).json({ message: 'Conversation turn saved successfully', messages });
    } catch (error) {
        res.status(500).json({ message: 'Error saving conversation turn', error: error.message });
    }
};

export const getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.headers['user-id'];
        if (!userId || !mongoose.isValidObjectId(userId)) {
            return res.status(401).json({ message: 'Unauthorized', error: 'Unauthorized' });
        }
        const conversation = await getOwnedConversation(conversationId, userId);
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found', error: 'Conversation not found' });
        }
        const messages = await Message.find({ conversationId }).sort({ timestamp: 1, _id: 1 });
        res.status(200).json({ message: 'Messages retrieved successfully', messages });
    } catch (error) {
        res.status(500).json({ message: 'Error retrieving messages', error: error.message });
    }
};

export const updateMessageDeployment = async (req, res) => {
    try {
        const { conversationId, messageId, deployment } = req.body;
        const userId = req.headers['user-id'];
        if (!userId || !mongoose.isValidObjectId(userId)) {
            return res.status(401).json({ message: 'Unauthorized', error: 'Unauthorized' });
        }
        if (!mongoose.isValidObjectId(conversationId) || !mongoose.isValidObjectId(messageId)) {
            return res.status(400).json({ message: 'Valid conversationId and messageId are required', error: 'Invalid ID' });
        }
        const conversation = await getOwnedConversation(conversationId, userId);
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found', error: 'Conversation not found' });
        }

        const message = await Message.findOne({ _id: messageId, conversationId });
        if (!message) {
            return res.status(404).json({ message: 'Message not found', error: 'Message not found' });
        }

        if (message.codeArtifact) {
            message.codeArtifact.deployment = {
                status: deployment?.status || (deployment?.success ? "published" : "failed"),
                url: deployment?.deploymentUrl || deployment?.url || null,
                permalinkUrl: deployment?.permalinkUrl || null,
                provider: deployment?.provider || "Netlify",
                note: deployment?.error || deployment?.note || "",
                deployId: deployment?.deployId || null,
                siteId: deployment?.siteId || null,
                verified: Boolean(deployment?.verified),
                verifiedFiles: Array.isArray(deployment?.verifiedFiles) ? deployment.verifiedFiles : [],
                deployedAt: deployment?.deployedAt ? new Date(deployment.deployedAt) : new Date(),
            };
            message.markModified("codeArtifact");
            await message.save();
        }

        await invalidateConversationMemory(conversationId, userId);
        res.status(200).json({ message: 'Deployment status updated successfully', message });
    } catch (error) {
        res.status(500).json({ message: 'Error updating deployment status', error: error.message });
    }
};
