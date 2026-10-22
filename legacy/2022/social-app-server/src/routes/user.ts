import { Router } from "express";
import { getUser, followUser, unFollowUser, updateUser, searchUsers } from "../functions/user";
import { verifyAccessToken } from "../utilities/helpers";

const router = Router();

router.use(verifyAccessToken);

router.get("/get", getUser);
router.put("/follow/:targetId", followUser);
router.put("/unfollow/:targetId", unFollowUser);
router.put("/update/:userId", updateUser);
router.get("/search/:username", searchUsers);

export default router;
