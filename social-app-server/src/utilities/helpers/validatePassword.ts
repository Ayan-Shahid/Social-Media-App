import bcrypt from "bcrypt";

const validatePassword = async (password: string, hashedPassword: string) => {
	return await bcrypt.compare(password, hashedPassword);
};

export default validatePassword;
