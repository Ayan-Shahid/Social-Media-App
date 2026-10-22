import styled from "styled-components";

export const Image = styled.img`
	width: 100%;
	height: 100%;
	border-radius: 50%;
	object-fit: cover;
`;

export const Wrapper = styled.figure<{ size?: string }>`
	width: ${({ size }) => size};
	height: ${({ size }) => size};
	border-radius: 50%;
	flex: none;
	position: relative;
	margin: 0;
	background: ${({ theme: { colors } }) => colors.secondary};

	padding: 0;
	cursor: pointer;
`;

export const Status = styled.span`
	position: absolute;
	width: 35%;
	height: 35%;
	right: -0.2rem;
	border: 0.15rem solid ${({ theme: { colors } }) => colors.secondary};
	top: 0rem;
	border-radius: 50%;
	background: #00823b;
`;
