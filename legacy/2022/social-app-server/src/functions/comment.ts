import { Request, Response } from "express";
import { CommentModel } from "../models";

export const addComment = async (req: Request, res: Response) => {
	const { postId } = req.params;
	const { userId, text } = req.body;

	await new CommentModel({
		postId,
		userId,
		text,
	})
		.save()
		.then(() => res.status(200).json("Commented successfully."))
		.catch((error) => res.status(500).json(error));
};

export const getComments = async (req: Request, res: Response) => {
	const { postId } = req.params;

	await CommentModel.find({ postId })
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};

export const likeComment = async (req: Request, res: Response) => {
	const { commentId } = req.params;
	const { userId } = req.body;

	const comment = await CommentModel.findById(commentId).catch((error) =>
		res.status(500).json(error)
	);

	if (comment?.get("likes").includes(userId)) {
		return await CommentModel.findByIdAndUpdate(
			commentId,
			{
				$pull: { likes: userId },
			},
			{ new: true }
		)
			.then((data) => res.status(200).json(data))
			.catch((error) => res.status(500).json(error));
	}

	await CommentModel.findByIdAndUpdate(
		commentId,
		{
			$push: { likes: userId },
		},
		{ new: true }
	)
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};
