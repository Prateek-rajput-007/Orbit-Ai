import { getAuth } from "firebase-admin/auth";
import User from "../models/user.model.js";
import { app } from "../config/firebase.js";
import redis from "../../../shared/redis/redis.js";

const sessionExpiresIn = 5 * 24 * 60 * 60 * 1000;

export const loginWithGoogle = async (req, res) => {
  try {
    const { idToken } = req.body || {};

    if (!idToken || typeof idToken !== "string") {
      return res.status(400).json({ error: "idToken is required", message: "idToken is required" });
    }

    const firebaseAuth = getAuth(app);
    const decodedToken = await firebaseAuth.verifyIdToken(idToken);
    let user = await User.findOne({ firebaseUID: decodedToken.uid });

    if (!user) {
      user = await User.create({
        firebaseUID: decodedToken.uid,
        name: decodedToken.name || decodedToken.email,
        email: decodedToken.email,
        avatar: decodedToken.picture
      });
    }

    const sessionCookie = await firebaseAuth.createSessionCookie(idToken, {
      expiresIn: sessionExpiresIn
    });
    await redis.set(
      `session:${sessionCookie}`,
      JSON.stringify({
        firebaseUID: decodedToken.uid,
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar
      }),
      "PX",
      sessionExpiresIn
    );
    res.cookie("session", sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: sessionExpiresIn
    });
    res.status(200).json({ message: "User logged in successfully", user });
  } catch (error) {
    console.error("Error logging in with Google:", error);
    res.status(500).json({ error: "Internal server error", message: "Internal server error" });
  }
};

export const logout = async (req, res) => {
  try {
    const sessionCookie = req.cookies?.session;
    if (!sessionCookie) {
      return res.status(400).json({ error: "No session cookie found", message: "No session cookie found" });
    }
    await redis.del(`session:${sessionCookie}`);
    res.clearCookie("session", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax"
    });
    res.status(200).json({ message: "User logged out successfully" });
  } catch (error) {
    console.error("Error logging out:", error);
    res.status(500).json({ error: "Internal server error", message: "Internal server error" });
  }
};
