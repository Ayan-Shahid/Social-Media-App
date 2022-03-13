import { Schema, model } from "mongoose";

interface MessageSchemaType {
	friendId: string;
	chatId: string;
	text: string;
}

const MessageSchema = new Schema<MessageSchemaType>(
	{
		chatId: {
			type: String,
			required: true,
			trim: true,
		},
		friendId: {
			type: String,
			required: true,
			trim: true,
		},
		text: { type: String, trim: true },
	},
	{ collection: "Messages", timestamps: true }
);

const MessageModel = model<MessageSchemaType>("Message", MessageSchema);

export default MessageModel;
