import { createAuthToken, validatePassword } from "../utilities/helpers";
import { hashPassword } from "../utilities/helpers";
import { Request, Response } from "express";
import { UserModel } from "../models";

export const registerUser = async (req: Request, res: Response) => {
	const { username, email, password } = req.body;

	const emailExists = await UserModel.findOne({ email });

	if (emailExists?.get("email")) return res.status(401).json({ email: "This email address already has an account. Please login" });

	const nameExists = await UserModel.findOne({ username });

	if (nameExists?.get("username")) return res.status(401).json({ username: "This username already exists. Try something else." });

	const user = await new UserModel({
		username,
		email,
		password: await hashPassword(password),
	})
		.save()
		.catch((err) => res.status(500).json(err));

	const accessToken = await createAuthToken(user.get("_id"));

	res.status(200).json({ message: user, token: accessToken });
};

export const loginUser = async (req: Request, res: Response) => {
	const { email, password } = req.body;

	const user = await UserModel.findOne({ email }).catch((err) => res.status(500).json(err));

	if (!user) return res.status(401).json({ email: "This user does not exist. Please create a account." });

	const valid = await validatePassword(password, user.get("password"));

	if (!valid) return res.status(401).json({ password: "The password is incorrect. Please try again." });

	const accessToken = await createAuthToken(user.get("_id"));

	res.status(200).json({ message: user, token: accessToken });
};
