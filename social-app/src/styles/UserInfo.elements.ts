import styled from "styled-components";
import { Column } from "./Shared.elements";

export const Wrapper = styled(Column)`
	width: 15rem;
	position: relative;
`;

export const Description = styled(Column)`
	word-break: break-all;
	align-self: flex-start;
`;

export const EditButton = styled.button`
	width: 100%;
	height: 2.5rem;
	border-radius: 0.5rem;
	gap: 0.5rem;
	background: ${({ theme: { colors } }) => colors.primary};
	border: 1.5px solid ${({ theme: { colors } }) => colors.secondary};
	color: ${({ theme: { colors } }) => colors.secondary};
	font-weight: 500;

	transition: 0.3s;
	overflow: hidden;
	position: relative;

	&:active {
		background: #999;
	}
	&:hover {
		background: ${({ theme: { colors } }) => colors.secondary};
		color: ${({ theme: { colors } }) => colors.primary};
	}
`;

export const DisplayPicture = styled.label`
	position: relative;
	cursor: pointer;
	display: flex;
	align-items: center;
	justify-content: center;
	.fileInput {
		position: absolute;
		display: none;
		visibility: hidden;
		width: 100%;
	}

	.closeIcon {
		font-size: ${({ theme: { fontSize } }) => fontSize["2xl"]};
		color: ${({ theme: { colors } }) => colors.primary};
		position: absolute;
		opacity: 0;
		transition: 0.3s;
	}
	.pictureIcon {
		font-size: ${({ theme: { fontSize } }) => fontSize["2xl"]};
		color: ${({ theme: { colors } }) => colors.primary};
		position: absolute;
		opacity: 0;
		transition: 0.3s;
	}
	.displayPicture {
		transition: 0.3s;
	}
	&:hover > .displayPicture {
		filter: blur(5px);
	}
	&:hover > .label {
		opacity: 1;
	}
	&:hover > .pictureIcon {
		opacity: 1;
	}
`;

export const SaveButton = styled.button`
	padding: 0.5rem 1rem;
	border-radius: 0.5rem;
	margin: 1rem;
	cursor: pointer;
`;
