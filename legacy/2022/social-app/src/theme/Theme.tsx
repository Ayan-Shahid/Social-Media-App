import React, { FunctionComponent } from "react";
import { ThemeProvider } from "styled-components";

export const theme = {
	colors: {
		primary: "#2a2a2a",
		secondary: "#dadada",
	},
	fontSize: {
		"3xl": "2.488rem",
		"2xl": "2.074rem",
		xl: "1.728rem",
		lg: "1.44rem",
		md: "1.2rem",
		sm: "1rem",
		xs: "0.833rem",
		"2xs": "0.694rem",
		"3xs": "0.579rem",
	},
};

const Theme: FunctionComponent = ({ children }) => {
	return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
};

export default Theme;
