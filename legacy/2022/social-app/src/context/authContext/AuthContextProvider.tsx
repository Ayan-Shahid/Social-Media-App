import React, { createContext, FunctionComponent, useEffect, useState } from "react";
import { Dispatch } from "react";
import { useReducer } from "react";
import { authReducer } from "./authReducer";

export type UserType = {
	_id: string;
	token: string;
	username: string;
	email: string;
	password: string;
	picture?: string;
	followers?: string[];
	following?: string[];
	description?: string;
	posts?: string[];
	createdAt: string;
	updatedAt: string;
};

export interface InitialState {
	user: UserType | null;
	isFetching: boolean;
	error?: { username?: string; email?: string; password?: string };
}

export type DispatchActionTypes =
	| "LOGIN_SUCCESS"
	| "LOGIN_FAILURE"
	| "LOGIN"
	| "REGISTER_SUCCESS"
	| "REGISTER_FAILURE"
	| "REGISTER"
	| "UPDATE_USER";

interface ContextType {
	state: InitialState;
	dispatch: Dispatch<{ type: DispatchActionTypes; payload: InitialState }>;
	isActive?: boolean;
}

const initialState: ContextType = {
	state: { user: null, isFetching: false },
	dispatch: () => null,
};

export const AuthContext = createContext<ContextType>(initialState);

const AuthContextProvider: FunctionComponent = ({ children }) => {
	const [state, dispatch] = useReducer(authReducer, { user: null, isFetching: false });
	const [isActive, setIsActive] = useState<boolean>(false);
	const user = localStorage.getItem("user");

	useEffect(() => {
		let isMounted = true;

		if (isMounted) {
			if (user)
				dispatch({ type: "LOGIN_SUCCESS", payload: { user: JSON.parse(user), isFetching: false } });

			setIsActive(true);
		}
		return () => {
			isMounted = false;
			setIsActive(false);
		};
	}, []);

	return (
		<AuthContext.Provider value={{ state, dispatch, isActive }}>{children}</AuthContext.Provider>
	);
};

export default AuthContextProvider;
