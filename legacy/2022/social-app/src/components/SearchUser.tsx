import instance from "api/instance";
import React, { ChangeEvent, FunctionComponent, MouseEventHandler, useState } from "react";
import { GrClose } from "react-icons/gr";
import { useNavigate } from "react-router-dom";
import * as Styled from "styles/SearchUser.elements";
import * as Shared from "styles/Shared.elements";
import Avatar from "./Avatar";

interface ISearchUser {
	closeSearch?: MouseEventHandler<HTMLButtonElement>;
	active?: boolean;
}

const SearchUser: FunctionComponent<ISearchUser> = ({ closeSearch, active }: ISearchUser) => {
	const navigate = useNavigate();
	const [users, setUsers] = useState<{ _id: string; username: string; picture?: string }[] | null>(
		null
	);
	const searchUsers = async (event: ChangeEvent<HTMLInputElement>) => {
		if (event.target.value === "") return;

		await instance.get(`/user/search/${event.target.value}`).then(({ data }) => setUsers(data));
	};

	return (
		<Styled.Wrapper active={active?.toString()}>
			<Styled.CloseButton onClick={closeSearch}>
				<GrClose className="closeIcon" />
			</Styled.CloseButton>
			<Styled.Input onChange={searchUsers} placeholder="Search User" />
			<Shared.Column className="users" width="100%">
				{users?.map(({ _id, username, picture }) => (
					<Styled.User key={_id} onClick={() => navigate(`/profile/${username}`)}>
						<Avatar size="2rem" src={picture} />
						<Shared.Paragraph>{username}</Shared.Paragraph>
					</Styled.User>
				))}
			</Shared.Column>
		</Styled.Wrapper>
	);
};

export default SearchUser;
