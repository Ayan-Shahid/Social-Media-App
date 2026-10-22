import React, { FunctionComponent, useContext, useEffect, useState } from "react";
import Post from "./Post";
import * as Styled from "styles/Feed.elements";
import instance from "api/instance";
import { AuthContext } from "context/authContext/AuthContextProvider";

interface IFeed {
	isProfile?: boolean;
}

const Feed: FunctionComponent<IFeed> = ({ isProfile }: IFeed) => {
	const {
		state: { user },
	} = useContext(AuthContext);
	const [timeline, setTimeline] = useState<
		| {
				_id: string;
				userId: string;
				image: string;
				description: string;
				likes: string[];
				createdAt: string;
		  }[]
		| null
	>(null);
	const getTimeline = async () => {
		if (user?._id)
			await instance.get(`/post/timeline/${user?._id}`).then(({ data }) => setTimeline(data));
	};

	const getUserTimeline = async () => {
		if (user?._id)
			await instance.get(`/post/timeline/user/${user?._id}`).then(({ data }) => setTimeline(data));
	};

	useEffect(() => {
		let isMounted = true;

		if (isMounted) {
			isProfile ? getUserTimeline() : getTimeline();
		}

		return () => {
			isMounted = false;
		};
	}, [user]);

	return (
		<Styled.Wrapper>
			<Styled.Posts>
				{timeline
					?.sort((a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf())
					?.map((items) => (
						<Post key={items._id} {...items} />
					))}
			</Styled.Posts>
		</Styled.Wrapper>
	);
};

export default Feed;
