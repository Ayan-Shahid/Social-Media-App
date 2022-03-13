import instance from "api/instance";
import moment from "moment";
import React, { FunctionComponent, useEffect, useState } from "react";
import * as Shared from "styles/Shared.elements";
import Avatar from "./Avatar";

interface IMessage {
	isUser?: boolean;
	text?: string;
	userId?: string;
	createdAt?: number;
}

const Message: FunctionComponent<IMessage> = ({ isUser, text, userId, createdAt }: IMessage) => {
	const [user, setUser] = useState<{ picture: string } | null>(null);

	const getUser = async () => {
		if (userId)
			await instance
				.get(`/user/get?userId=${userId}`)
				.then(({ data }) => setUser({ picture: data.picture }));
	};

	useEffect(() => {
		let isMounted = true;

		if (isMounted) getUser();

		return () => {
			isMounted = false;
		};
	}, [userId]);
	return (
		<Shared.Row
			reverse={isUser ? "true" : "false"}
			justifyContent="flex-start"
			width="100%"
			gap="1rem"
		>
			<Avatar src={user?.picture} alt="message" size="2rem" />
			<Shared.Column alignItems={isUser ? "flex-end" : "flex-start"} gap="1rem">
				<Shared.Box
					borderRadius={isUser ? "1rem 1rem 0 1rem" : "1rem 1rem 1rem 0"}
					padding="1rem"
					maxWidth="25rem"
					background={isUser ? "#4a4a4a" : "white"}
				>
					<Shared.Paragraph
						wordBreak="break-all"
						weight={isUser ? 300 : 500}
						color={isUser ? "white" : "black"}
					>
						{text}
					</Shared.Paragraph>
				</Shared.Box>
				<Shared.Comment color="#999">
					{moment(createdAt).startOf("second").fromNow()}
				</Shared.Comment>
			</Shared.Column>
		</Shared.Row>
	);
};

export default Message;
