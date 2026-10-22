import styled from "styled-components";
import { Label } from "./Shared.elements";

export const Wrapper = styled.button`
	width: 30rem;
	padding: 1rem;
	display: flex;
	align-items: center;
	overflow: hidden;
	justify-content: center;
	position: relative;
	border-radius: 0.5rem;
`;

export const Text = styled(Label)<{ active?: string }>`
	color: ${({ theme: { colors } }) => colors.primary};
	transition: 0.5s;
	transition-timing-function: cubic-bezier(0.445, 0.05, 0.55, 0.95);
	transform: ${({ active }) => (active === "true" ? "translateX(-100rem)" : "translateX(0)")};
`;

export const Loader = styled.span<{ loading?: string }>`
	border: 0.2rem solid #c9c9c9;
	background: none;
	border-radius: 50%;
	transition: 0.5s;
	position: absolute;
	border-top: 0.2rem solid ${({ theme: { colors } }) => colors.primary};
	height: 1.7rem;
	visibility: ${({ loading }) => (loading === "true" ? "visible" : "hidden")};

	transform: scale(2);
	width: 1.7rem;
	animation: spin 1s linear infinite;

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
`;
