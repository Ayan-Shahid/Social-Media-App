import styled from "styled-components";
import { Box, Row } from "./Shared.elements";

export const Wrapper = styled(Box).attrs({ as: "button" })`
	width: 100%;
	height: 2.5rem;
	border-radius: 0.5rem;
	gap: 0.5rem;
	background: ${({ theme: { colors } }) => colors.secondary};
	transition: 0.3s;
	overflow: hidden;
	position: relative;

	&:active {
		background: #999;
	}
	&:hover {
		background: #eee;
	}
`;

export const Follow = styled(Row)<{ follow?: "true" | "false" | string }>`
	gap: 0.5rem;
	position: absolute;
	transition: 0.3s;
	transform: ${({ follow }) => (follow === "true" ? "translateY(-10rem)" : "translateY(0)")};
`;

export const UnFollow = styled(Row)<{ follow?: "true" | "false" | string }>`
	gap: 0.5rem;
	transition: 0.3s;

	transform: ${({ follow }) => (follow === "true" ? "translateY(0)" : "translateY(10rem)")};
`;
