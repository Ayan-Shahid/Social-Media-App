import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import Theme from "theme/Theme";
import { BrowserRouter } from "react-router-dom";
import AuthContextProvider from "context/authContext/AuthContextProvider";
import ChatContextProvider from "context/ChatContextProvider";

ReactDOM.render(
	<React.StrictMode>
		<AuthContextProvider>
			<ChatContextProvider>
				<BrowserRouter>
					<Theme>
						<App />
					</Theme>
				</BrowserRouter>
			</ChatContextProvider>
		</AuthContextProvider>
	</React.StrictMode>,
	document.getElementById("root")
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
