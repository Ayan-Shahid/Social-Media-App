import express, { Request, Response } from "express";
import path from "path";
import helmet from "helmet";
import cors from "cors";
import mongoose from "mongoose";
import {
	authRouter,
	chatRouter,
	commentRouter,
	messageRouter,
	postRouter,
	userRouter,
} from "./routes";
import dotenv from "dotenv";
import multer from "multer";
import socketio from "socket.io";
import http from "http";

dotenv.config();

const PORT = 8000 || process.env.PORT;

const app = express();

const server = http.createServer(app);

app.use("/images", express.static(path.join(__dirname, "./public/images")));
app.use(helmet());
app.use(express.json());
app.use(cors());

server.listen(PORT, () => {
	console.log(`The app is listening on port http://localhost:${PORT}`);
});

mongoose.connect("mongodb://127.0.0.1/Social-App").then(() => console.log("Connected to database"));

const storage = multer.diskStorage({
	destination: (req, file, cb) => {
		cb(null, path.join(__dirname, "./public/images"));
	},
	filename: function (req, file, cb) {
		cb(null, req.body.name);
	},
});

const upload = multer({ storage });

app.post("/api/upload", upload.single("file"), (req: Request, res: Response) => {
	try {
		return res.status(200).json("File upload successfully");
	} catch (error) {
		console.log(error);
	}
});
app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/post", postRouter);
app.use("/api/comment", commentRouter);
app.use("/api/message", messageRouter);
app.use("/api/chat", chatRouter);

const io = new socketio.Server(server);

const users: { userId: string; socketId: string }[] = [];

const addUsers = (userId: string, socketId: string) => {
	!users.some((user) => user.userId === userId) && users.push({ userId, socketId });
	console.log(users);
};

const removeUsers = (socketId: string) => {
	users.filter((user) => user.socketId !== socketId);

	console.log(users);
};

const getUser = (userId: string) => {
	return users.find((user) => user.userId === userId);
};

io.on("connection", (socket) => {
	console.log("A user connected");
	socket.on("add-user", (data) => {
		addUsers(data.userId, socket.id);

		io.emit("get-users", users);
	});

	socket.on("send-message", (data) => {
		const user = getUser(data.friendId);
		if (user) io.to(user?.socketId).emit("get-message", { userId: data.userId, text: data.text });
	});

	socket.on("disconnect", () => {
		console.log("A user disconnected");
		removeUsers(socket.id);
		io.emit("get-users", users);
	});
});
