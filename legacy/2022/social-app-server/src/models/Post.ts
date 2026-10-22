import { Schema, model, Document } from "mongoose";

interface PostSchemaType extends Document {
	userId: string;
	image: string;
	likes?: string[];
	description?: string;
}

const PostSchema = new Schema<PostSchemaType>(
	{
		userId: {
			type: String,
			required: true,
			trim: true,
		},
		image: {
			type: String,
			required: true,
			trim: true,
		},
		description: { type: String, trim: true },
		likes: {
			type: [String],
			default: [],
		},
	},
	{ collection: "Posts", timestamps: true }
);

const PostModel = model<PostSchemaType>("Post", PostSchema);

export default PostModel;
