import React, { FunctionComponent } from "react";
import * as Styled from "styles/Comments.elements";
import * as Shared from "styles/Shared.elements";
import Comment from "./Comment";

interface CommentsProps {
	active?: boolean;
	comments:
		| {
				_id: string;
				userId: string;
				postId: string;
				text: string;
				likes: string[];
				createdAt: string;
		  }[]
		| null;
}

const Comments: FunctionComponent<CommentsProps> = ({ active, comments }: CommentsProps) => {
	return (
		<Styled.Comments background="rgba(42, 42, 42, 0.8)" active={active?.toString()}>
			<Shared.Column flex="1" className="comments">
				{comments?.map((item) => (
					<Comment key={item._id} {...item} />
				))}
			</Shared.Column>
		</Styled.Comments>
	);
};

export default Comments;
