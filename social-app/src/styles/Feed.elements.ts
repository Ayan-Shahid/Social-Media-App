import styled from "styled-components";
import { Column } from "./Shared.elements";

export const Wrapper = styled(Column).attrs({ as: "section" })`
	width: 100%;
	overflow: hidden;
`;

export const Posts = styled(Column)`
	height: 100vh;
	width: 100%;
	padding: 2rem;

	gap: 3.5rem;

	overflow: scroll;
`;
