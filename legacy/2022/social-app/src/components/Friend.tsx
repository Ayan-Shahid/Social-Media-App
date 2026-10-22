import React, { FunctionComponent, MouseEventHandler, useEffect, useState } from "react";
import * as Styled from "styles/SideBar.elements";
import * as Shared from "styles/Shared.elements";
import Avatar from "./Avatar";
import instance from "api/instance";

interface IFriend {
	open?: boolean;
	userId?: string;
	isActive?: boolean;
	onClick?: MouseEventHandler<HTMLButtonElement>;
}

const Friend: FunctionComponent<IFriend> = ({ open, userId, isActive, onClick }: IFriend) => {
	const [user, setUser] = useState<{ username: string; picture: string } | null>(null);

	const getUser = async () => {
		if (userId) await instance.get(`/user/get?userId=${userId}`).then(({ data }) => setUser(data));
	};

	useEffect(() => {
		getUser();
	}, []);
	return (
		<Styled.ListItem onClick={onClick} as="button" open={open}>
			<Avatar src={user?.picture} status={isActive ? "online" : "offline"} size="1.8rem" />
			<Shared.Paragraph className="friendText">{user?.username}</Shared.Paragraph>
		</Styled.ListItem>
	);
};

export default Friend;
