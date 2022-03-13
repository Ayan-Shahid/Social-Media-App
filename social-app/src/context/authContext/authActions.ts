import { DispatchActionTypes, InitialState } from "./AuthContextProvider";
import { Dispatch } from "react";
import instance from "api/instance";

export const registerUser = async (
	username: string,
	password: string,
	email: string,
	dispatch: Dispatch<{ type: DispatchActionTypes; payload: InitialState }>
) => {
	dispatch({ type: "REGISTER", payload: { isFetching: true, user: null } });
	await instance
		.post("/auth/register", { username, email, password })
		.then(({ data: { message, token } }) => {
			dispatch({
				type: "REGISTER_SUCCESS",
				payload: { user: { ...message, token }, isFetching: false },
			});
			localStorage.setItem("authToken", token);
			localStorage.setItem("user", JSON.stringify(message));
		})
		.catch(({ response: { data } }) => {
			dispatch({
				type: "REGISTER_FAILURE",
				payload: {
					user: null,
					isFetching: false,
					error: { username: data.username, email: data.email },
				},
			});
		});
};

export const loginUser = async (
	password: string,
	email: string,
	dispatch: Dispatch<{ type: DispatchActionTypes; payload: InitialState }>
) => {
	dispatch({ type: "LOGIN", payload: { isFetching: true, user: null } });
	await instance
		.post("/auth/login", { email, password })
		.then(({ data: { message, token } }) => {
			dispatch({
				type: "LOGIN_SUCCESS",
				payload: { user: { ...message, token }, isFetching: false },
			});
			localStorage.setItem("authToken", token);
			localStorage.setItem("user", JSON.stringify(message));
		})
		.catch(({ response: { data } }) => {
			dispatch({
				type: "LOGIN_FAILURE",
				payload: {
					user: null,
					isFetching: false,
					error: { password: data.password, email: data.email },
				},
			});
		});
};
