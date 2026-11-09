import express from "express"
import { loginWithGoogle } from "../controllers/auth.controllers.js"
import { logout } from "../controllers/auth.controllers.js"
const router = express.Router()

router.post("/login", loginWithGoogle)
router.get("/logout", logout)

export default router