import styled from "styled-components";

export const Wrapper = styled.div`
	height: 100%;
	display: flex;
	background: ${({ theme: { colors } }) => colors.primary};
`;
