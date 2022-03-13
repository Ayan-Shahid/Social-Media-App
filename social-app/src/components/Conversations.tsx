import instance from "api/instance";
import { AuthContext } from "context/authContext/AuthContextProvider";
import { ChatContext } from "context/ChatContextProvider";
import React, {
	Dispatch,
	FunctionComponent,
	SetStateAction,
	useContext,
	useEffect,
	useState,
} from "react";
import { FiChevronRight } from "react-icons/fi";
import * as Styled from "styles/Conversations.elements";
import { useToggle } from "utilities/hooks";
import Friend from "./Friend";

interface IConversation {
	setCurrentChat: Dispatch<SetStateAction<{ _id: string; members: string[] } | null>>;
}

const Conversations: FunctionComponent<IConversation> = ({ setCurrentChat }: IConversation) => {
	const { value: sideBar, toggle: setSideBar } = useToggle();

	const { onlineFriends } = useContext(ChatContext);

	const [conversations, setConversations] = useState<{ _id: string; members: string[] }[] | null>(
		null
	);

	const {
		state: { user },
	} = useContext(AuthContext);

	const getConversations = async () => {
		if (user)
			await instance.get(`/chat/user/${user?._id}/`).then(({ data }) => setConversations(data));
	};

	const findConversation = async (friendId: string) => {
		if (user)
			await instance.get(`/chat/current/${user?._id}/${friendId}`).then(({ data }) => {
				setCurrentChat(data);
			});
	};

	useEffect(() => {
		let isMounted = true;

		if (isMounted) getConversations();

		return () => {
			isMounted = false;
		};
	}, [user]);
	return (
		<Styled.Wrapper borderRadius="1rem" open={sideBar}>
			<Styled.Toggler open={sideBar} onClick={setSideBar}>
				<FiChevronRight className="icon" />
			</Styled.Toggler>

			<Styled.List className="friendsList">
				{conversations?.map(({ _id, members }) =>
					members
						.filter((member) => member !== user?._id)
						.map((item) => (
							<Friend
								onClick={() => findConversation(item)}
								open={sideBar}
								isActive={onlineFriends?.some(({ userId }) => userId === item)}
								key={_id}
								userId={item}
							/>
						))
				)}
			</Styled.List>
		</Styled.Wrapper>
	);
};

export default Conversations;
