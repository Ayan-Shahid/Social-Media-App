import React, { FunctionComponent, useContext, useEffect, useState } from "react";
import Avatar from "./Avatar";
import LikeButton from "./LikeButton";
import * as Shared from "styles/Shared.elements";
import moment from "moment";
import instance from "api/instance";
import { useToggle } from "utilities/hooks";
import { AuthContext } from "context/authContext/AuthContextProvider";

interface IComment {
	_id: string;
	userId: string;
	postId: string;
	text: string;
	likes: string[];
	createdAt: string;
}

const Comment: FunctionComponent<IComment> = ({
	_id,
	userId,
	text,
	likes,
	createdAt,
}: IComment) => {
	const [commentUser, setCommentUser] = useState<{
		username: string;
		picture: string;
	} | null>(null);
	const [commentLikes, setCommentLikes] = useState<string[]>(likes);

	const {
		state: { user },
	} = useContext(AuthContext);

	const { value: like, setTrue: setLikeTrue, setFalse: setLikeFalse } = useToggle();

	const getUser = async () => {
		await instance.get(`/user/get?userId=${userId}`).then(({ data }) => setCommentUser(data));
	};

	const likeComment = async () => {
		await instance
			.put(`/comment/like/${_id}`, {
				userId: user?._id,
			})
			.then(({ data }) => {
				setCommentLikes(data.likes);
				data.likes.includes(user?._id) ? setLikeTrue() : setLikeFalse();
			});
	};

	useEffect(() => {
		let isMounted = true;

		if (isMounted) {
			getUser();
			if (user?._id) likes.includes(user?._id) ? setLikeTrue() : setLikeFalse();
		}

		return () => {
			isMounted = false;
		};
	}, []);
	return (
		<Shared.Row gap="1rem" justifyContent="space-between" flex="none" width="100%">
			<Shared.Row gap="1rem">
				<Avatar size="2rem" src={commentUser?.picture} />
				<Shared.Column gap="0.5rem" alignItems="flex-start">
					<Shared.Paragraph>
						<strong>{commentUser?.username} &nbsp;</strong> {text}
					</Shared.Paragraph>
					<Shared.Row gap="1rem">
						<Shared.Comment color="#999" weight={500}>
							{moment(createdAt).startOf("day").fromNow()}
						</Shared.Comment>
						<Shared.Comment color="#999" weight={500}>
							{commentLikes.length} Likes
						</Shared.Comment>
					</Shared.Row>
				</Shared.Column>
			</Shared.Row>
			<LikeButton likeUser={likeComment} like={like} />
		</Shared.Row>
	);
};

export default Comment;
