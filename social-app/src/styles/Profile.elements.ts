import styled from "styled-components";
import { Row } from "./Shared.elements";

export const Wrapper = styled.div`
	background: ${({ theme: { colors } }) => colors.primary};
	display: flex;
`;

export const Main = styled(Row).attrs({ as: "section" })`
	padding: 0 8rem;

	color: ${({ theme: { colors } }) => colors.secondary};

	width: 100%;
	gap: 2rem;
`;
