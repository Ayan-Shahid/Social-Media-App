import styled from "styled-components";
import { Column, Row, Label } from "./Shared.elements";

export const Image = styled.img`
	object-fit: cover;
	position: absolute;
	height: 100%;
	transition: 0.3s;
	overflow: hidden;
	border-radius: 1rem;
	width: 100%;
`;

export const Text = styled(Label)`
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	position: absolute;
	transform: 0.3s;
	z-index: 3;
	color: black;
	.closeIcon {
		color: ${({ theme: { colors } }) => colors.primary};
		font-size: 1rem;
	}
	.imageIcon {
		color: ${({ theme: { colors } }) => colors.primary};
		font-size: ${({ theme: { fontSize } }) => fontSize["3xl"]};
		transition: 0.3s;
	}
	opacity: 0;
`;

export const CloseButton = styled.button`
	background: red;

	padding: 1rem;
	position: absolute;
	right: 50%;
	top: 50%;
`;

export const Wrapper = styled(Column)<{ active?: "true" | "false" | string }>`
	width: 40rem;
	height: 44rem;
	flex: none;
	background: #dadada;
	cursor: pointer;
	border-radius: 1.5rem;
	position: absolute;
	z-index: 3;
	opacity: ${({ active }) => (active === "true" ? 1 : 0)};

	top: ${({ active }) => (active === "true" ? "50%" : "-50%")};
	left: 50%;
	transform: translate(-50%, -50%);
	transition: 0.3s;
	overflow: hidden;
	color: ${({ theme: { colors } }) => colors.secondary};
	justify-content: flex-end;
	&:hover > ${Image} {
		filter: blur(10px);
	}
	&:hover > * {
		opacity: 1;
	}
	.fileInput {
		display: none;
	}
`;

export const Input = styled.input`
	background: rgba(42, 42, 42, 1);
	border-radius: 0.5rem;
	color: ${({ theme: { colors } }) => colors.secondary};
	padding: 1rem;
	flex: 1;
	transition: 0.3s;
`;

export const Footer = styled(Row).attrs({ as: "footer" })`
	height: 4rem;
	padding: 2.5rem 1.5rem 3.5rem 1.5rem;
	gap: 1rem;
	width: 100%;

	z-index: 2;
	flex: none;
`;
