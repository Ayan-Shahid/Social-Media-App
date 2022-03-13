import { Schema, model } from "mongoose";

interface CommentSchemaType {
	userId: string;
	postId: string;
	text: string;
	likes?: string[];
}

const CommentSchema = new Schema<CommentSchemaType>(
	{
		userId: {
			type: String,
			required: true,
			trim: true,
		},
		postId: {
			type: String,
			required: true,
			trim: true,
		},
		text: { type: String, trim: true },
		likes: {
			type: [String],
			default: [],
		},
	},
	{ collection: "Comments", timestamps: true }
);

const CommentModel = model<CommentSchemaType>("Comment", CommentSchema);

export default CommentModel;
