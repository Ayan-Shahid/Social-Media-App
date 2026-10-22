import { Home, Login, Register, Profile, Messenger } from "pages";
import React, { FunctionComponent } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

const App: FunctionComponent = () => {
	const authorized = localStorage.getItem("authToken");
	return (
		<>
			<Routes>
				<Route path="/" element={authorized ? <Home /> : <Navigate to="/login" />} />
				<Route path="/register" element={<Register />} />
				<Route
					path="/profile/:username"
					element={authorized ? <Profile /> : <Navigate to="/login" />}
				/>
				<Route path="/login" element={authorized ? <Navigate to="/" /> : <Login />} />
				<Route path="/messenger" element={authorized ? <Messenger /> : <Navigate to="/" />} />
			</Routes>
		</>
	);
};

export default App;
