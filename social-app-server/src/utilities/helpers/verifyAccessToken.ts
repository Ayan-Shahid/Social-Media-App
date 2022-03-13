import jwt from "jsonwebtoken";
import { NextFunction, Request, Response } from "express";

const verifyAccessToken = (req: Request, res: Response, next: NextFunction) => {
	const authHeader = req.headers.authorization;

	if (authHeader) {
		const accessToken = authHeader.split(" ")[1];

		jwt.verify(accessToken, process.env.ACCESS_TOKEN as string, (err, user) => {
			if (err) return res.status(403).json("Invalid Token");

			res.locals.user = user;

			next();
		});
	} else return res.status(401).json("Please provide an access token.");
};

export default verifyAccessToken;
