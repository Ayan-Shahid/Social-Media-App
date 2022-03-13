import styled from "styled-components";
import { Column, Row } from "./Shared.elements";

export const Header = styled(Row).attrs({ as: "header" })`
	height: 4rem;
	width: 100%;
	z-index: 2;
	transition: 0.3s;
	gap: 1rem;
	flex: none;
	padding: 1rem 0 0 1.5rem;
	justify-content: flex-start;

	/* border-bottom: 1px solid ${({ theme: { colors } }) => colors.primary}; */
`;

export const ImageWrapper = styled.figure`
	height: 30rem;
	margin: 0;
	padding: 1.5rem;
	position: relative;
	width: 100%;
`;

export const Image = styled.img`
	object-fit: cover;
	position: absolute;
	height: 100%;
	transition: 0.3s;
	overflow: hidden;
	border-radius: 1rem;
	width: 100%;
`;

export const Footer = styled(Row).attrs({ as: "footer" })`
	height: 4rem;
	padding: 2.5rem 1.5rem 3.5rem 1.5rem;
	gap: 1rem;
	width: 100%;

	z-index: 2;
	flex: none;
`;

export const Actions = styled(Row)`
	width: 100%;
	height: 2rem;
	padding: 0 1.5rem;
	justify-content: flex-start;
	z-index: 2;

	gap: 1rem;
`;

export const Action = styled(Row)`
	gap: 0.8rem;
	cursor: pointer;
	user-select: none;
	.actionIcon {
		font-size: ${({ theme: { fontSize } }) => fontSize.lg};
		transition: 0.3s;
	}
	.actionIcon:hover {
		transform: scale(1.2);
	}
`;

export const Input = styled.input`
	background: rgba(242, 242, 242, 0.3);
	border-radius: 0.5rem;
	color: ${({ theme: { colors } }) => colors.primary};
	padding: 1rem;
	flex: 1;
	transition: 0.3s;
`;

export const Wrapper = styled(Column)`
	width: 100%;
	height: 44rem;
	flex: none;
	cursor: pointer;
	color: ${({ theme: { colors } }) => colors.secondary};
	justify-content: space-between;
	position: relative;
	align-items: stretch;
	/* background: ${({ theme: { colors } }) => colors.secondary}; */
	border-radius: 1.5rem;
	background: none;
	overflow: hidden;
	.footer {
		opacity: 0;
		transition: 0.3s;
	}
	/* margin: 3rem 0 3rem 0; */
	&:hover > ${Image} {
		filter: blur(10px);
	}
	&:hover > * {
		opacity: 1;
	}
	@media screen and (min-width: 800px) {
		width: 40rem;
	}
`;
