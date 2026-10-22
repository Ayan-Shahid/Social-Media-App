import { createChat, getChat, getUserChats } from "./../functions/chat";
import { Router } from "express";
import { verifyAccessToken } from "../utilities/helpers";

const router = Router();

router.use(verifyAccessToken);

router.post("/create", createChat);
router.get("/user/:userId", getUserChats);
router.get("/current/:userId/:friendId", getChat);

export default router;
