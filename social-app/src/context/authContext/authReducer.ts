/* eslint-disable indent */
import { Reducer } from "react";
import { DispatchActionTypes, InitialState } from "./AuthContextProvider";

export const authReducer: Reducer<
	InitialState,
	{ type: DispatchActionTypes; payload: InitialState }
> = (
	state: InitialState,
	action: { type: DispatchActionTypes; payload: InitialState }
): InitialState => {
	switch (action.type) {
		case "REGISTER":
			return {
				...state,
				isFetching: action.payload.isFetching,
			};
		case "REGISTER_SUCCESS":
			return {
				user: action.payload.user,
				isFetching: action.payload.isFetching,
			};
		case "REGISTER_FAILURE":
			return {
				user: action.payload.user,
				isFetching: action.payload.isFetching,
				error: action.payload.error,
			};
		case "LOGIN":
			return {
				...state,
				isFetching: action.payload.isFetching,
			};
		case "LOGIN_SUCCESS":
			return {
				user: action.payload.user,
				isFetching: action.payload.isFetching,
			};
		case "LOGIN_FAILURE":
			return {
				user: action.payload.user,
				isFetching: action.payload.isFetching,
				error: action.payload.error,
			};
		case "UPDATE_USER":
			return {
				user: action.payload.user,
				isFetching: action.payload.isFetching,
			};
		default:
			return state;
	}
};
