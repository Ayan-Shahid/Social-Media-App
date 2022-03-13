import instance from "api/instance";
import { Avatar, Conversations, SideBar } from "components";
import Message from "components/Message";
import { AuthContext } from "context/authContext/AuthContextProvider";
import { ChatContext } from "context/ChatContextProvider";
import React, {
	FunctionComponent,
	KeyboardEvent,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import * as Shared from "styles/Shared.elements";

const Messenger: FunctionComponent = () => {
	const {
		state: { user },
	} = useContext(AuthContext);

	const { socket } = useContext(ChatContext);

	const [currentChatFriend, setCurrentChatFriend] = useState<{
		picture: string;
		username: string;
	} | null>(null);

	const [currentChat, setCurrentChat] = useState<{
		_id: string;
		members: string[];
	} | null>(null);

	const [messages, setMessages] = useState<
		{ createdAt: number; friendId: string; text: string; chatId: string }[]
	>([]);

	const [arrivalMessage, setArrivalMessage] = useState<{
		friendId: string;
		text: string;
		chatId: string;
		createdAt: number;
	} | null>(null);

	let messagesWrapperRef = useRef<HTMLElement>(null).current;

	let messageInputRef = useRef<HTMLInputElement>(null).current;

	const getFriend = async () => {
		if (currentChat) {
			const chatFriend = currentChat?.members.find((item) => item !== user?._id);

			await instance
				.get(`/user/get?userId=${chatFriend}`)
				.then(({ data }) => setCurrentChatFriend(data));
		}
	};

	const sendMessage = async (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter" && currentChat && user) {
			const newMessage = {
				friendId: user?._id,
				chatId: currentChat?._id,
				text: messageInputRef?.value,
			};

			const chatFriendId = currentChat?.members.find((item) => item !== user._id);

			socket?.current?.emit("send-message", {
				userId: user?._id,
				friendId: chatFriendId,
				text: messageInputRef?.value,
			});

			await instance
				.post("/message/create", newMessage)
				.then(({ data }) => setMessages([...messages, data]));
		}
	};

	const getMessages = async () => {
		if (currentChat)
			await instance.get(`/message/get/${currentChat?._id}`).then(({ data }) => setMessages(data));
	};

	useEffect(() => {
		if (user?._id) socket?.current?.emit("add-user", { userId: user?._id });
	}, [user, socket]);

	useEffect(() => {
		let isMounted = true;
		socket?.current?.on("get-message", (data) => {
			if (currentChat && isMounted)
				setArrivalMessage({
					friendId: data.userId,
					text: data.text,
					createdAt: Date.now(),
					chatId: currentChat?._id,
				});
		});

		return () => {
			isMounted = false;
		};
	}, [socket, currentChat]);

	useEffect(() => {
		let isMounted = true;

		if (isMounted) {
			if (arrivalMessage && currentChat?.members.includes(arrivalMessage.friendId)) {
				setMessages((prev) => [...prev, arrivalMessage]);
			}
		}

		return () => {
			isMounted = false;
		};
	}, [arrivalMessage, currentChat]);
	useEffect(() => {
		let isMounted = true;

		if (isMounted) {
			getMessages();
			getFriend();
		}

		return () => {
			isMounted = false;
		};
	}, [currentChat]);
	useEffect(() => {
		messagesWrapperRef?.scrollIntoView({ behavior: "smooth" });
	}, [messages]);

	return (
		<Shared.Row>
			<SideBar />
			<Shared.Column width="100%" height="100vh">
				<Shared.Row flex="none" justifyContent="flex-start" gap="1rem" width="90%" height="8rem">
					{currentChat && (
						<>
							<Avatar size="3rem" src={currentChatFriend?.picture} />
							<Shared.Body weight={300} color="white">
								{currentChatFriend?.username}
							</Shared.Body>
						</>
					)}
				</Shared.Row>
				<Shared.Column margin="2rem 0" overflow="scroll" gap="2rem" width="90%" height="100%">
					{currentChat &&
						messages?.map((item) => (
							<Shared.Row
								width="100%"
								ref={(ref) => (messagesWrapperRef = ref)}
								key={item.createdAt}
							>
								<Message
									isUser={item.friendId === user?._id ? true : false}
									userId={item.friendId}
									{...item}
								/>
							</Shared.Row>
						))}
				</Shared.Column>
				<Shared.Input
					ref={(ref) => (messageInputRef = ref)}
					background="#3a3a3a"
					onKeyDown={sendMessage}
					width="90%"
					height="5rem"
					padding="0 1rem"
					placeholder="Enter some text..."
					color="white"
					borderRadius="0.5rem"
					margin="2rem 0"
				/>
			</Shared.Column>
			<Conversations setCurrentChat={setCurrentChat} />
		</Shared.Row>
	);
};

export default Messenger;
