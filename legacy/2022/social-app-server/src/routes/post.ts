import { Router } from "express";
import { addPost, getTimeline, likePost, getUserTimeline } from "../functions/post";
import { verifyAccessToken } from "../utilities/helpers";

const router = Router();

router.use(verifyAccessToken);

router.post("/create", addPost);
router.put("/like/:postId", likePost);
router.get("/timeline/:userId", getTimeline);
router.get("/timeline/user/:userId", getUserTimeline);

export default router;
