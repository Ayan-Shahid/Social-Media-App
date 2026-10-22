import { addMessage, getMessages } from "../functions/message";
import { Router } from "express";
import { verifyAccessToken } from "../utilities/helpers";

const router = Router();

router.use(verifyAccessToken);

router.post("/create", addMessage);
router.get("/get/:chatId", getMessages);

export default router;
