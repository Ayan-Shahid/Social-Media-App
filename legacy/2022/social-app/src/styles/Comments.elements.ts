import styled from "styled-components";
import { Row } from "./Shared.elements";

export const Comments = styled(Row)<{ active?: string; background?: string }>`
	width: 25rem;
	height: 20rem;
	top: ${({ active }) => (active === "true" ? "50%" : "-50%")};
	opacity: ${({ active }) => (active === "true" ? 1 : 0)};
	z-index: 3;
	left: 50%;
	gap: 1.5rem;
	padding: 2rem 1.5rem;
	word-break: break-all;
	align-items: flex-start;
	flex-wrap: wrap;
	transition: 0.3s;
	transform: translate(-50%, -50%);
	background: ${({ background }) => background};
	border-radius: 1rem;
	position: absolute;
	overflow: scroll;
	.actionIcon {
		transition: 0.3s;
	}
	.actionIcon:hover {
		transition: 0.3s;
		transform: scale(1.2);
	}
	.comments {
		gap: 1.5rem;
	}
`;
