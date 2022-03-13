import styled from "styled-components";
import { Box } from "./Shared.elements";

export const Wrapper = styled(Box).attrs({ as: "section" })`
	height: 100vh;
	background: ${({ theme: { colors } }) => colors.primary};
`;

export const Form = styled(Box)`
	border-radius: 1rem;
	flex-direction: column;
	gap: 3.5rem;
`;
