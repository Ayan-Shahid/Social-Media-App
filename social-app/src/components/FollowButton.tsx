import React, { ButtonHTMLAttributes, FunctionComponent } from "react";
import { FaUserMinus, FaUserPlus } from "react-icons/fa";
import * as Styled from "styles/FollowButton.elements";
import * as Shared from "styles/Shared.elements";

interface IFollowButton extends ButtonHTMLAttributes<HTMLButtonElement> {
	follow?: boolean;
}

const FollowButton: FunctionComponent<IFollowButton> = ({ follow, ...props }: IFollowButton) => {
	return (
		<Styled.Wrapper {...props}>
			<Styled.UnFollow follow={follow?.toString()}>
				<FaUserMinus className="unFollowIcon" />
				<Shared.Paragraph weight={500}>Un Follow</Shared.Paragraph>
			</Styled.UnFollow>
			<Styled.Follow follow={follow?.toString()}>
				<FaUserPlus className="followIcon" />
				<Shared.Paragraph weight={500}>Follow</Shared.Paragraph>
			</Styled.Follow>
		</Styled.Wrapper>
	);
};

export default FollowButton;
