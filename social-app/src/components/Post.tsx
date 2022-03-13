import React, {
	FunctionComponent,
	KeyboardEvent,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import * as Styled from "styles/Post.elements";
import Avatar from "./Avatar";
import * as Shared from "styles/Shared.elements";
import Comments from "./Comments";
import { BsChat } from "react-icons/bs";
import { useToggle } from "utilities/hooks";
import instance from "api/instance";
import moment from "moment";
import { AuthContext } from "context/authContext/AuthContextProvider";
import LikeButton from "./LikeButton";

interface IPost {
	_id: string;
	userId: string;
	image: string;
	description: string;
	likes: string[];
	createdAt: string;
}

const Post: FunctionComponent<IPost> = ({
	userId,
	image,
	description,
	likes,
	_id,
	createdAt,
}: IPost) => {
	const {
		state: { user },
	} = useContext(AuthContext);

	let commentInputRef = useRef<HTMLInputElement>(null).current;

	const { value: like, setTrue: setLikeTrue, setFalse: setLikeFalse } = useToggle();
	const { value: comments, toggle: setComments } = useToggle();
	const [postLikes, setPostLikes] = useState<string[]>(likes);
	const [postComments, setPostComments] = useState<
		| {
				_id: string;
				userId: string;
				postId: string;
				text: string;
				likes: string[];
				createdAt: string;
		  }[]
		| null
	>(null);
	const [postUser, setPostUser] = useState<{
		username: string;
		picture: string;
		createdAt: string;
	} | null>(null);

	const getUser = async () => {
		await instance.get(`/user/get?userId=${userId}`).then(({ data }) => setPostUser(data));
	};

	const likeUser = async () => {
		await instance
			.put(`/post/like/${_id}`, {
				userId: user?._id,
			})
			.then(({ data }) => {
				setPostLikes(data.likes);
				data.likes.includes(user?._id) ? setLikeTrue() : setLikeFalse();
			});
	};

	const getComments = async () => {
		await instance.get(`/comment/get/${_id}`).then(({ data }) => setPostComments(data));
	};

	const createComment = async (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter")
			await instance
				.post(`/comment/create/${_id}`, {
					userId: user?._id,
					text: commentInputRef?.value,
				})
				.then(() => {
					if (commentInputRef) commentInputRef.value = "";

					getComments();
				});
	};

	// const [comments, setComments] = useState<boolean>(false);

	useEffect(() => {
		let isMounted = true;

		if (isMounted) {
			getUser();
			getComments();
			if (user?._id) likes?.includes(user?._id) ? setLikeTrue() : setLikeFalse();
		}

		return () => {
			isMounted = false;
		};
	}, []);

	return (
		<Styled.Wrapper>
			<Styled.Header>
				<Avatar size="2rem" src={postUser?.picture} />
				<Shared.Column alignItems="flex-start" gap="0.3rem">
					<Shared.Paragraph weight={500}>{postUser?.username}</Shared.Paragraph>
					<Shared.Comment color="#999" weight={500}>
						{moment(createdAt).startOf("hour").fromNow()}
					</Shared.Comment>
				</Shared.Column>
			</Styled.Header>
			<Styled.Image src={`http://localhost:8000/images/${image}`} alt="post" />
			<Shared.Column className="footer">
				<Styled.Actions>
					<Styled.Action>
						<LikeButton like={like} likeUser={likeUser} />
						<Shared.Paragraph>{postLikes?.length} Likes</Shared.Paragraph>
					</Styled.Action>
					<Styled.Action onClick={setComments}>
						<BsChat className="actionIcon" />
						<Shared.Paragraph>{postComments?.length} Comments</Shared.Paragraph>
					</Styled.Action>
				</Styled.Actions>
				<Styled.Actions>
					<Shared.Paragraph>
						<strong>{postUser?.username} &nbsp;</strong> {description}
					</Shared.Paragraph>
				</Styled.Actions>
				<Styled.Footer>
					<Avatar src={user?.picture} size="2rem" />
					<Styled.Input
						onKeyDown={createComment}
						ref={(ref) => (commentInputRef = ref)}
						placeholder="Write your comment."
					/>
				</Styled.Footer>
			</Shared.Column>
			<Comments comments={postComments} active={comments} />
		</Styled.Wrapper>
	);
};

export default Post;
