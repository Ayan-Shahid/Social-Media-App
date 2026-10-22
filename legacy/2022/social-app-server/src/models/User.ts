import { Schema, model } from "mongoose";

interface UserSchemaType {
	username: string;
	email: string;
	password: string;
	picture?: string;
	description?: string;
	followers?: string[];
	following?: string[];
	posts?: string[];
}

const UserSchema = new Schema<UserSchemaType>(
	{
		username: { type: String, required: true, trim: true, unique: true },
		email: { type: String, required: true, unique: true, trim: true },
		password: { type: String, required: true, unique: true, trim: true },
		picture: { type: String, trim: true, default: "avatar.jpg" },
		description: { type: String, trim: true },
		followers: {
			type: [String],
			default: [],
		},
		following: {
			type: [String],

			default: [],
		},
		posts: {
			type: [String],
			default: [],
		},
	},
	{ collection: "Users", timestamps: true }
);

const UserModel = model<UserSchemaType>("User", UserSchema);

export default UserModel;
