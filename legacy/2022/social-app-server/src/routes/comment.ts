import { addComment, likeComment, getComments } from "./../functions/comment";
import { Router } from "express";
import { verifyAccessToken } from "../utilities/helpers";

const router = Router();

router.use(verifyAccessToken);

router.post("/create/:postId", addComment);
router.put("/like/:commentId", likeComment);
router.get("/get/:postId", getComments);

export default router;
