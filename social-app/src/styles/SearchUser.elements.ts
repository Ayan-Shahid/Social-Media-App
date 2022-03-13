import styled from "styled-components";
import { Comments } from "./Comments.elements";
import { Row } from "./Shared.elements";

export const Wrapper = styled(Comments)`
	background: rgba(242, 242, 242, 0.9);
	height: 25rem;
	align-items: flex-start;
	gap: 1rem;
	overflow: hidden;
	.users {
		height: 100%;
		justify-content: flex-start;
		overflow: scroll;
	}
`;

export const Input = styled.input`
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

export const User = styled(Row)`
	gap: 1rem;
	width: 100%;
	justify-content: flex-start;

	padding: 1rem;
	border-radius: 0.5rem;
	border-bottom: 1px solid #bbb;
	cursor: pointer;
	&:hover {
		background: #ccc;
	}
`;
