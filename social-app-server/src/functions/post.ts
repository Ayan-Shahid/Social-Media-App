import { Request, Response } from "express";
import { UserModel, PostModel } from "../models";

export const addPost = async (req: Request, res: Response) => {
	const { userId, image, description } = req.body;

	const post = await new PostModel({
		userId,
		image,
		description,
	}).save();

	await UserModel.findByIdAndUpdate(
		userId,
		{
			$push: {
				posts: post._id,
			},
		},
		{ new: true }
	)
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};

export const getTimeline = async (req: Request, res: Response) => {
	const { userId } = req.params;

	const userPosts = await PostModel.find({ userId });

	const user = await UserModel.findById(userId).catch((error) => res.status(500).json(error));

	const friendsPost = await Promise.all(
		user?.get("following").map((user: string) => PostModel.find({ userId: user }))
	);

	res.status(200).json(userPosts.concat(...friendsPost));
};

export const getUserTimeline = async (req: Request, res: Response) => {
	const { userId } = req.params;

	const userPosts = await PostModel.find({ userId });

	res.status(200).json(userPosts);
};

export const likePost = async (req: Request, res: Response) => {
	const { postId } = req.params;
	const { userId } = req.body;

	const post = await PostModel.findById(postId).catch((error) => res.status(500).json(error));

	if (post?.get("likes").includes(userId)) {
		return await PostModel.findByIdAndUpdate(
			postId,
			{
				$pull: { likes: userId },
			},
			{ new: true }
		)
			.then((data) => res.status(200).json(data))
			.catch((error) => res.status(500).json(error));
	}

	await PostModel.findByIdAndUpdate(
		postId,
		{
			$push: { likes: userId },
		},
		{ new: true }
	)
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};
