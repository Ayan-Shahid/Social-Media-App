import React, {
	createContext,
	FunctionComponent,
	MutableRefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { io, Socket } from "socket.io-client";

interface IChatContext {
	socket?: MutableRefObject<Socket> | null;
	onlineFriends?: { userId: string; socketId: string }[] | null;
}

export const ChatContext = createContext<IChatContext>({ socket: null, onlineFriends: null });

const ChatContextProvider: FunctionComponent = ({ children }) => {
	const [onlineFriends, setOnlineFriends] = useState<{ userId: string; socketId: string }[] | null>(
		null
	);

	const socket = useRef<Socket>(io(""));

	useEffect(() => {
		socket.current = io("ws://localhost:8000");
	}, []);

	useEffect(() => {
		let isMounted = true;
		socket?.current?.on("get-users", (data) => {
			if (isMounted) setOnlineFriends(data);
		});
		return () => {
			isMounted = false;
		};
	}, [socket]);

	return <ChatContext.Provider value={{ socket, onlineFriends }}>{children}</ChatContext.Provider>;
};

export default ChatContextProvider;
