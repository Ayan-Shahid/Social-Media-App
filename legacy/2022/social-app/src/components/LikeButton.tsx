import React, { FunctionComponent, MouseEventHandler } from "react";
import { BsHeart, BsHeartFill } from "react-icons/bs";

interface ILikeButton {
	like?: boolean;
	likeUser?: MouseEventHandler;
	size?: string;
}

const LikeButton: FunctionComponent<ILikeButton> = ({ like, likeUser, size }: ILikeButton) => {
	return (
		<>
			{like ? (
				<BsHeartFill size={size} onClick={likeUser} className="actionIcon" />
			) : (
				<BsHeart size={size} onClick={likeUser} className="actionIcon" />
			)}
		</>
	);
};

export default LikeButton;
