/* eslint-disable indent */
import instance from "api/instance";
import { Feed, SideBar, UserInfo } from "components";
import { AuthContext } from "context/authContext/AuthContextProvider";
import React, { FunctionComponent, useContext, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as Styled from "styles/Profile.elements";

const Profile: FunctionComponent = () => {
	const [follow, setFollow] = useState<boolean>(false);

	const [friend, setFriend] = useState<{
		_id?: string;
		username: string;
		posts: number;
		picture?: string;
		following: number;
		followers: number;
		description: string;
	}>({ username: "", posts: 0, following: 0, followers: 0, description: "" });
	const { username } = useParams();
	const {
		state: { user },
		dispatch,
	} = useContext(AuthContext);

	const followUser = async () => {
		await instance
			.put(`/user/follow/${friend._id}`, {
				userId: user?._id,
			})
			.then(({ data }) => {
				setFollow(true);
				dispatch({ type: "UPDATE_USER", payload: { user: data, isFetching: false } });
				localStorage.setItem("user", JSON.stringify(data));
			});
	};
	const unFollowUser = async () => {
		await instance
			.put(`/user/unfollow/${friend._id}`, {
				userId: user?._id,
			})
			.then(({ data }) => {
				setFollow(false);
				dispatch({ type: "UPDATE_USER", payload: { user: data, isFetching: false } });
				localStorage.setItem("user", JSON.stringify(data));
			});
	};

	const followOrUnFollowUser = async () => {
		follow ? await unFollowUser() : await followUser();
	};

	const getUser = async () => {
		await instance
			.get(`/user/get?username=${username}`)
			.then(({ data: { _id, username, posts, following, followers, description, picture } }) => {
				setFriend({
					_id,
					username,
					posts: posts.length,
					following: following.length,
					followers: followers.length,
					description,
					picture,
				});
				followers.includes(user?._id) ? setFollow(true) : setFollow(false);
			});
	};

	useEffect(() => {
		let isMounted = true;
		if (isMounted) {
			if (username !== user?.username) getUser();
		}
		return () => {
			isMounted = false;
		};
	}, [followUser, user]);

	const isCurrent = username === user?.username ? true : false;

	const userInfoProps =
		username === user?.username
			? {
					username: user?.username || "",
					posts: user?.posts?.length || 0,
					followers: user?.followers?.length || 0,
					following: user?.following?.length || 0,
					description: user?.description || "",
					picture: user?.picture,
			  }
			: friend;

	return (
		<Styled.Wrapper>
			<SideBar />
			<Styled.Main>
				<UserInfo
					follow={follow}
					followOrUnFollowUser={followOrUnFollowUser}
					{...userInfoProps}
					isCurrent={isCurrent}
				/>
				<Feed isProfile={true} />
			</Styled.Main>
		</Styled.Wrapper>
	);
};

export default Profile;
