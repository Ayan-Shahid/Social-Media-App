import { Request, Response } from "express";
import MessageModel from "../models/Message";

export const addMessage = async (req: Request, res: Response) => {
	await new MessageModel(req.body)
		.save()
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};

export const getMessages = async (req: Request, res: Response) => {
	const { chatId } = req.params;
	await MessageModel.find({ chatId })
		.then((data) => res.status(200).json(data))
		.catch((error) => res.status(500).json(error));
};
