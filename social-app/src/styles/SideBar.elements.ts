import styled from "styled-components";
import { Box, Column, Row } from "./Shared.elements";

export const Wrapper = styled(Column).attrs({ as: "nav" })<{ open?: boolean }>`
	width: ${({ open }) => (open ? "15rem" : "5rem")};
	height: 100vh;
	background: ${({ theme: { colors } }) => colors.secondary};
	border-radius: 0 1rem 1rem 0;
	position: relative;
	flex: none;
	align-items: ${({ open }) => (open ? "flex-start" : "center")};
	transition: 0.2s;
	padding: 2rem;
	justify-content: space-between;
	.friendsList {
		height: 10rem;
		padding: 0.2rem;
		overflow: scroll;
		gap: 2rem;
	}
`;

export const List = styled(Column)<{ open?: boolean }>`
	align-items: ${({ open }) => (open ? "flex-start" : "center")};
	display: flex;
	justify-content: flex-start;
	gap: 2rem;
	.iconLink {
		font-size: ${({ theme: { fontSize } }) => fontSize.md};
		cursor: pointer;
		transition: 0.2s;
	}
	.iconLink:hover {
		transform: scale(1.2);
	}
`;

export const ListItem = styled(Row)<{ open?: boolean }>`
	gap: 1rem;
	width: 100%;
	justify-content: flex-start;
	background: none;
	.linkText,
	.usernameText,
	.friendText {
		position: ${({ open }) => (open ? "static" : "absolute")};

		user-select: none;
		transform-origin: left;
		transition: 0.3s;
		margin-left: 0rem;
		transform: ${({ open }) => (open ? "scaleX(1)" : "scaleX(0)")};
		opacity: ${({ open }) => (open ? "1" : "0")};
	}
	.usernameText {
		margin-left: 1rem;
	}
	.friendText {
		margin-left: 0.5rem;
	}
`;

export const Toggler = styled(Box)<{ open?: boolean }>`
	width: 1.8rem;
	top: 50%;
	cursor: pointer;
	height: 1.8rem;
	right: -0.9rem;
	transition: 0.3s;
	border-radius: 50%;
	background: ${({ theme: { colors } }) => colors.secondary};
	border: 0.2rem solid ${({ theme: { colors } }) => colors.primary};
	position: absolute;
	.icon {
		font-size: ${({ theme: { fontSize } }) => fontSize.sm};
		transform: ${({ open }) => (open ? "rotateY(180deg)" : "rotate(0)")};
	}
	&:hover {
		scale: 1px;
		transform: scale(1.2);
	}
`;
