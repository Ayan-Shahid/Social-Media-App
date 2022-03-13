import axios from "axios";

const instance = axios.create({
	baseURL: "http://localhost:8000/api",
	headers: {
		authorization: `Bearer ${localStorage.getItem("authToken")}`,
	},
});

export default instance;
