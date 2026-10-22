import React, { FunctionComponent, useContext } from "react";
import * as Styled from "styles/SideBar.elements";
import * as Shared from "styles/Shared.elements";

import Avatar from "./Avatar";
import { GrHomeRounded, GrChat, GrSearch, GrAddCircle, GrPowerShutdown } from "react-icons/gr";
import { FiChevronRight } from "react-icons/fi";
import { Link } from "react-router-dom";
import AddPost from "./AddPost";
import { AuthContext } from "context/authContext/AuthContextProvider";
import { useToggle } from "utilities/hooks";
import SearchUser from "./SearchUser";
import Friend from "./Friend";
import instance from "api/instance";
import { ChatContext } from "context/ChatContextProvider";

const SideBar: FunctionComponent = () => {
	const { onlineFriends } = useContext(ChatContext);

	const { value: sideBar, toggle: setSideBar } = useToggle();
	const { value: post, toggle: togglePost, setFalse: closePost } = useToggle();
	const { value: search, setTrue: openSearch, setFalse: closeSearch } = useToggle();

	const { isActive } = useContext(AuthContext);

	const {
		state: { user },
	} = useContext(AuthContext);

	const status = isActive ? "online" : "offline";

	const logOut = () => {
		localStorage.clear();
		window.location.reload();
	};

	const createConversation = async (friendId: string) => {
		await instance.post("/chat/create", {
			userId: user?._id,
			friendId,
		});
	};

	return (
		<>
			<Styled.Wrapper open={sideBar}>
				<Styled.Toggler open={sideBar} onClick={setSideBar}>
					<FiChevronRight className="icon" />
				</Styled.Toggler>
				<Link className="linkElement" to={`/profile/${user?.username}`}>
					<Styled.ListItem open={sideBar}>
						<Avatar status={status} size="2.5rem" src={user?.picture} />
						<Shared.Label className="usernameText">{user?.username}</Shared.Label>
					</Styled.ListItem>
				</Link>
				<Styled.List open={sideBar}>
					<Link to="/" className="linkElement">
						<Styled.ListItem open={sideBar}>
							<GrHomeRounded className="iconLink" />
							<Shared.Paragraph className="linkText">Home</Shared.Paragraph>
						</Styled.ListItem>
					</Link>
					<Link to="/messenger" className="linkElement">
						<Styled.ListItem open={sideBar}>
							<GrChat className="iconLink" />
							<Shared.Paragraph className="linkText">Chat</Shared.Paragraph>
						</Styled.ListItem>
					</Link>
					<Styled.ListItem onClick={openSearch} open={sideBar}>
						<GrSearch className="iconLink" />
						<Shared.Paragraph className="linkText">Search</Shared.Paragraph>
					</Styled.ListItem>
					<Styled.ListItem onClick={togglePost} open={sideBar}>
						<GrAddCircle className="iconLink" />
						<Shared.Paragraph className="linkText">Post</Shared.Paragraph>
					</Styled.ListItem>
					<Styled.ListItem onClick={logOut} open={sideBar}>
						<GrPowerShutdown className="iconLink" />
						<Shared.Paragraph className="linkText">Log Out</Shared.Paragraph>
					</Styled.ListItem>
				</Styled.List>
				<Styled.List className="friendsList">
					{user?.following?.map((_id) => (
						<Friend
							onClick={() => createConversation(_id)}
							isActive={onlineFriends?.some(({ userId }) => userId === _id)}
							key={_id}
							userId={_id}
							open={sideBar}
						/>
					))}
				</Styled.List>
			</Styled.Wrapper>
			<AddPost active={post} closePost={closePost} />
			<SearchUser active={search} closeSearch={closeSearch} />
		</>
	);
};

export default SideBar;
