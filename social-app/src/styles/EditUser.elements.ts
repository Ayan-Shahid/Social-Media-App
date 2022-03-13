import styled from "styled-components";
import { Comments } from "./Comments.elements";

export const Wrapper = styled(Comments).attrs({ as: "form" })`
	background: rgba(242, 242, 242, 0.9);
	height: 25rem;
`;

export const Input = styled.input`
	flex: 1;
	padding: 1rem;
	border-radius: 1rem;
`;

export const Area = styled.textarea`
	border-radius: 1rem;
	padding: 1rem;
	font-size: ${({ theme: { fontSize } }) => fontSize.xs};
	white-space: pre-wrap;
`;

export const Button = styled.button`
	flex: 1;
	padding: 1rem;
	border-radius: 1rem;
`;

export const CloseButton = styled.button`
	position: absolute;
	padding: 0.5rem;
	top: 0.5rem;
	right: 0.5rem;
	background: none;
	.closeIcon {
		transition: 0.3s;
	}
	.closeIcon:hover {
		transform: scale(1.3);
	}
`;
