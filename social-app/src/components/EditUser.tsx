import instance from "api/instance";
import { AuthContext } from "context/authContext/AuthContextProvider";
import { useFormik } from "formik";
import React, { FunctionComponent, MouseEventHandler, useContext, useRef } from "react";
import { GrClose } from "react-icons/gr";
import { useNavigate } from "react-router-dom";
import * as Styled from "styles/EditUser.elements";
import * as Shared from "styles/Shared.elements";
import * as yup from "yup";

interface IEditUser {
	active?: boolean;
	closeEdit?: MouseEventHandler<HTMLButtonElement>;
}

const EditUser: FunctionComponent<IEditUser> = ({ active, closeEdit }: IEditUser) => {
	const navigate = useNavigate();
	let descriptionRef = useRef<HTMLTextAreaElement>(null).current;

	const {
		state: { user },
		dispatch,
	} = useContext(AuthContext);
	const validationSchema = yup.object({
		username: yup
			.string()
			.required("Please enter a username.")
			.min(4, "The username must be atleast 4 characters."),
		email: yup
			.string()
			.email("Please enter a valid email address.")
			.required("Please enter an email address."),
		password: yup
			.string()
			.required("Please enter a strong password.")
			.min(6, "The password is too short."),
	});

	const updateUser = async (
		username: string,
		email: string,
		password: string,
		description?: string
	) => {
		await instance
			.put(`/user/update/${user?._id}`, {
				username,
				email,
				password,
				description,
			})
			.then(({ data }) => {
				dispatch({ type: "UPDATE_USER", payload: { user: data, isFetching: false } });
				localStorage.setItem("user", JSON.stringify(data));
				navigate(`/profile/${data.username}`);
			});
	};

	const { values, handleSubmit, handleChange, handleBlur, errors, setErrors } = useFormik({
		initialValues: {
			username: "",
			email: "",
			password: "",
		},
		onSubmit: async (values) => {
			await updateUser(values.username, values.email, values.password, descriptionRef?.value).catch(
				({ response: { data } }) =>
					setErrors({
						username: data.username,
						email: data.email,
					})
			);
		},
		validationSchema,
	});

	return (
		<Styled.Wrapper as="form" onSubmit={handleSubmit} active={active?.toString()}>
			<Styled.CloseButton type="button" onClick={closeEdit}>
				<GrClose className="closeIcon" />
			</Styled.CloseButton>
			<Styled.Input
				name="username"
				placeholder="Username"
				type="text"
				onChange={handleChange}
				onBlur={handleBlur}
				value={values.username}
			/>
			<Shared.Paragraph color="#d32323">{errors.username}</Shared.Paragraph>
			<Styled.Input
				name="email"
				placeholder="Email"
				type="email"
				onChange={handleChange}
				onBlur={handleBlur}
				value={values.email}
			/>
			<Shared.Paragraph color="#d32323">{errors.email}</Shared.Paragraph>
			<Styled.Input
				name="password"
				placeholder="Password"
				type="text"
				onChange={handleChange}
				onBlur={handleBlur}
				value={values.password}
			/>
			<Shared.Paragraph color="#d32323">{errors.password}</Shared.Paragraph>

			<Styled.Area ref={(ref) => (descriptionRef = ref)} placeholder="Description" />

			<Styled.Button type="submit">Confirm</Styled.Button>
		</Styled.Wrapper>
	);
};

export default EditUser;
