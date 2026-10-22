import styled from "styled-components";

interface FontProps {
	color?: "white" | "black" | string;
	weight?: 100 | 200 | 300 | 400 | 500;
	wordBreak?: "break-all" | "normal";
}

interface FlexProps {
	alignItems?: "center" | "flex-end" | "flex-start";
	justifyContent?: "center" | "flex-end" | "flex-start" | "space-between" | "space-evenly";
	flex?: string;
	flexWrap?: "nowrap" | "wrap";
	gap?: string;
	width?: string;
	maxHeight?: string;
	maxWidth?: string;
	height?: string;
	background?: string | "white" | "black";
	padding?: string;
	margin?: string;
	borderRadius?: string;
	reverse?: string;
	overflow?: "hidden" | "scroll";
}

export const Heading = styled.h1<FontProps>`
	font-size: ${({ theme: { fontSize } }) => fontSize["3xl"]};
	color: ${({ color, theme: { colors } }) =>
		color === "black" ? colors.primary : colors.secondary ? color : colors.secondary};
	font-weight: ${({ weight }) => weight};
	margin: 0;
	word-break: ${({ wordBreak }) => wordBreak};
`;

export const SubHeading = styled(Heading).attrs({ as: "h2" })`
	font-size: ${({ theme: { fontSize } }) => fontSize["2xl"]};
`;

export const Title = styled(Heading).attrs({ as: "h3" })`
	font-size: ${({ theme: { fontSize } }) => fontSize["xl"]};
`;

export const SubTitle = styled(Heading).attrs({ as: "h4" })`
	font-size: ${({ theme: { fontSize } }) => fontSize["lg"]};
`;

export const Body = styled(Heading).attrs({ as: "h5" })`
	font-size: ${({ theme: { fontSize } }) => fontSize.md};
`;

export const Label = styled(Heading).attrs({ as: "h6" })`
	font-size: ${({ theme: { fontSize } }) => fontSize.sm};
`;

export const Paragraph = styled(Heading).attrs({ as: "p" })`
	font-size: ${({ theme: { fontSize } }) => fontSize.xs};
`;

export const Comment = styled(Heading).attrs({ as: "p" })`
	font-size: ${({ theme: { fontSize } }) => fontSize["2xs"]};
`;

export const Info = styled(Heading).attrs({ as: "p" })`
	font-size: ${({ theme: { fontSize } }) => fontSize["3xs"]};
`;

export const Row = styled.article<FlexProps>`
	display: flex;
	flex-direction: ${({ reverse }) => (reverse === "true" ? "row-reverse" : "row")};
	align-items: ${({ alignItems }) => alignItems || "center"};
	justify-content: ${({ justifyContent }) => justifyContent || "space-between"};
	gap: ${({ gap }) => gap};
	flex: ${({ flex }) => flex};
	width: ${({ width }) => width};
	flex-wrap: ${({ flexWrap }) => flexWrap};
	height: ${({ height }) => height};
	max-width: ${({ maxWidth }) => maxWidth};
	max-height: ${({ maxHeight }) => maxHeight};
	margin: ${({ margin }) => margin};
	padding: ${({ padding }) => padding};
	background: ${({ background }) => background};
	border-radius: ${({ borderRadius }) => borderRadius};
	overflow: ${({ overflow }) => overflow};
	background: ${({ background, theme: { colors } }) =>
		background === "black" ? colors.primary : colors.secondary ? background : colors.secondary};
`;

export const Column = styled(Row)`
	flex-direction: column;
`;

interface InputProps {
	width?: string;
	height?: string;
	flex?: string;
	padding?: string;
	margin?: string;
	borderRadius?: string;
	background?: string | "white" | "black";
	color?: string | "white" | "black";
}

export const Input = styled.input<InputProps>`
	margin: ${({ margin }) => margin};
	padding: ${({ padding }) => padding};
	width: ${({ width }) => width};
	height: ${({ height }) => height};
	background: ${({ background }) => background};
	border-radius: ${({ borderRadius }) => borderRadius};
	color: ${({ color, theme: { colors } }) =>
		color === "black" ? colors.primary : colors.secondary ? color : colors.secondary};
	background: ${({ background, theme: { colors } }) =>
		background === "black" ? colors.primary : colors.secondary ? background : colors.secondary};
`;

export const Box = styled(Row)`
	align-items: ${({ alignItems }) => alignItems || "center"};
	justify-content: ${({ justifyContent }) => justifyContent || "center"};
`;
