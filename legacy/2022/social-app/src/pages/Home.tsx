import { Feed, SideBar } from "components";
import React, { FunctionComponent } from "react";
import * as Styled from "styles/Home.elements";

const Home: FunctionComponent = () => {
	return (
		<Styled.Wrapper>
			<SideBar />
			<Feed />
		</Styled.Wrapper>
	);
};

export default Home;
