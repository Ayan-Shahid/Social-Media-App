import { Request, Response } from "express";
import { UserModel } from "../models";
import { hashPassword } from "../utilities/helpers";

export const getUser = async (req: Request, res: Response) => {
	const { username, userId } = req.query;
	if (userId)
		return await UserModel.findById(userId)
			.then((data) => res.status(200).json(data))
			.catch((error) => res.status(500).json(error));

	await UserModel.findOne({ username })
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};

export const followUser = async (req: Request, res: Response) => {
	const { userId } = req.body;
	const { targetId } = req.params;

	if (userId === targetId) return res.status(403).json("You cannot follow yourself.");

	const user = await UserModel.findById(userId);

	if (user?.following?.includes(targetId))
		return res.status(401).json("You already follow this user");

	await UserModel.findByIdAndUpdate(
		userId,
		{
			$push: {
				following: targetId,
			},
		},
		{ new: true }
	)
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));

	await UserModel.findByIdAndUpdate(
		targetId,
		{
			$push: {
				followers: userId,
			},
		},
		{ new: true }
	).catch((error) => res.status(500).json(error));
};

export const unFollowUser = async (req: Request, res: Response) => {
	const { userId } = req.body;
	const { targetId } = req.params;

	if (userId === targetId) return res.status(403).json("You cannot follow yourself.");

	const user = await UserModel.findById(userId);

	if (!user?.following?.includes(targetId))
		return res.status(401).json("You do not follow this user");

	await UserModel.findByIdAndUpdate(userId, {
		$pull: {
			following: targetId,
		},
	})
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));

	await UserModel.findByIdAndUpdate(targetId, {
		$pull: {
			followers: userId,
		},
	}).catch((error) => res.status(500).json(error));
};

export const updateUser = async (req: Request, res: Response) => {
	const { userId } = req.params;

	const nameExists = await UserModel.findOne({ username: req.body.username }).catch((error) =>
		res.status(500).json(error)
	);

	if (nameExists)
		return res.status(403).json({ username: "This username already exists. Try something else." });

	const emailExists = await UserModel.findOne({ email: req.body.email }).catch((error) =>
		res.status(500).json(error)
	);

	if (emailExists)
		return res.status(403).json({ email: "This email already exists. Try something else." });

	if (req.body.password)
		return await UserModel.findByIdAndUpdate(
			userId,
			{
				$set: {
					...req.body,
					password: await hashPassword(req.body.password),
				},
			},
			{ new: true }
		)
			.then((data) => res.status(200).json(data))
			.catch((error) => res.status(500).json(error));
	await UserModel.findByIdAndUpdate(
		userId,
		{
			$set: {
				...req.body,
			},
		},
		{ new: true }
	)
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};

export const searchUsers = async (req: Request, res: Response) => {
	const { username } = req.params;
	await UserModel.find({ username: { $regex: "^" + username, $options: "i" } })
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};
