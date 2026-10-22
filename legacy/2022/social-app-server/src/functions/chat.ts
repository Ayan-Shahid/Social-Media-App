import { Request, Response } from "express";
import ChatModel from "../models/Chat";

export const createChat = async (req: Request, res: Response) => {
	const { userId, friendId } = req.body;

	await new ChatModel({
		members: [userId, friendId],
	})
		.save()
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};

export const getUserChats = async (req: Request, res: Response) => {
	const { userId } = req.params;

	await ChatModel.find({ members: { $in: [userId] } })
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};

export const getChat = async (req: Request, res: Response) => {
	const { userId, friendId } = req.params;

	await ChatModel.findOne({ members: { $all: [userId, friendId] } })
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};
