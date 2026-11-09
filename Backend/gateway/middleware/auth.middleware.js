import redis from "../../shared/redis/redis.js";

export const protect = async (req, res, next) => {
    try {
        const sessionCookie = req.cookies?.session;
        if (!sessionCookie) {
            return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
        }
        const session = await redis.get(`session:${sessionCookie}`);
        if (!session) {
            return res.status(401).json({ message: "Session expired", error: "Session expired" });
        }

        let user;
        try {
            user = JSON.parse(session);
        } catch {
            await redis.del(`session:${sessionCookie}`);
            return res.status(401).json({ message: "Invalid session data", error: "Invalid session data" });
        }

        if (!user || !user.userId) {
            return res.status(401).json({ message: "Invalid session user", error: "Invalid session user" });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error("Error in auth middleware:", error.message);
        res.status(500).json({ error: "Internal server error", message: "Internal server error" });
    }
};

export default protect;
