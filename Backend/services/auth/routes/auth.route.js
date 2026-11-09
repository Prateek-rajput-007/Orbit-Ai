import express from "express";
import { loginWithGoogle, logout } from "../controllers/auth.controllers.js";

const router = express.Router();

router.post("/login", loginWithGoogle);
router.post("/logout", logout);

export default router;
