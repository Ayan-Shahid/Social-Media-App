import styled from "styled-components";
import { Column, Row } from "./Shared.elements";

export const Wrapper = styled(Column)<{ error?: string }>`
	width: 30rem;
	height: 3.5rem;
	/* background: ${({ theme: { colors } }) => colors.secondary}; */
	background: none;
	gap: 1rem;

	.error {
		visibility: ${({ error }) => (error === "true" ? "visible" : "hidden")};
	}
`;

export const Input = styled.input`
	height: 100%;
	padding: 0 1.5rem;
	font-weight: 500;
	background: none;
	position: relative;
	font-size: ${({ theme: { fontSize } }) => fontSize.sm};
	color: ${({ theme: { colors } }) => colors.secondary};
	width: 100%;

	::placeholder {
		font-size: ${({ theme: { fontSize } }) => fontSize.sm};
		color: #666;
	}
`;

export const InputWrapper = styled(Row)`
	position: relative;
	flex: none;
	height: 100%;
	justify-content: space-between;
	align-items: flex-end;
	border-radius: 0.5rem 0.5rem 0 0;
	align-items: center;
	width: 100%;
	background: #1a1a1a;
	&::before {
		content: "";
		height: 0.1rem;
		position: absolute;
		bottom: 0;
		transition: 0.2s;
		transition-timing-function: cubic-bezier(0.19, 1, 0.22, 1);
		left: 0;
		width: 0;
		background: ${({ theme: { colors } }) => colors.secondary};
		border-radius: 1rem;
	}
	&:hover::before {
		width: 100%;
	}
	.iconLeft,
	.iconRight {
		margin-left: 1.5rem;
		font-size: ${({ theme: { fontSize } }) => fontSize.lg};
		color: ${({ theme: { colors } }) => colors.secondary};
	}
	.iconRight {
		margin-right: 1.5rem;
		cursor: pointer;
	}
`;
