import styled from "styled-components";
import { Box, Column } from "./Shared.elements";

export const Wrapper = styled(Column).attrs({ as: "nav" })<{ open?: boolean }>`
	width: ${({ open }) => (open ? "15rem" : "5rem")};
	height: 100vh;
	background: ${({ theme: { colors } }) => colors.secondary};
	border-radius: 1rem 0 0 1rem;
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

export const Toggler = styled(Box)<{ open?: boolean }>`
	width: 1.8rem;
	top: 50%;
	cursor: pointer;
	height: 1.8rem;
	left: -0.9rem;
	transition: 0.3s;
	border-radius: 50%;
	background: ${({ theme: { colors } }) => colors.secondary};
	border: 0.2rem solid ${({ theme: { colors } }) => colors.primary};
	position: absolute;
	.icon {
		font-size: ${({ theme: { fontSize } }) => fontSize.sm};
		transform: ${({ open }) => (open ? "rotateY(0)" : "rotate(180deg)")};
	}
	&:hover {
		scale: 1px;
		transform: scale(1.2);
	}
`;
