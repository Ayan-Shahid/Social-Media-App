import jwt from "jsonwebtoken";

const createAuthToken = async (userId: string) => {
	return await jwt.sign({ userId }, process.env.ACCESS_TOKEN as string);
};

export default createAuthToken;
