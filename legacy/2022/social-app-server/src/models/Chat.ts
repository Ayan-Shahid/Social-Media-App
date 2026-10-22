import { Schema, model } from "mongoose";

interface ChatSchemaType {
	members: string[];
}

const ChatSchema = new Schema<ChatSchemaType>(
	{
		members: { type: [String] },
	},
	{ collection: "Chats", timestamps: true }
);

const ChatModel = model<ChatSchemaType>("Chat", ChatSchema);

export default ChatModel;
