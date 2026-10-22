import { FormButton, FormInput } from "components";
import React, { FunctionComponent, useContext, useState } from "react";
import * as Styled from "styles/Login.elements";
import * as Shared from "styles/Shared.elements";
import { MdEmail } from "react-icons/md";
import { AiFillEyeInvisible, AiFillEye } from "react-icons/ai";
import { HiKey } from "react-icons/hi";
import { Link } from "react-router-dom";
import { useFormik } from "formik";
import * as yup from "yup";
import { AuthContext } from "context/authContext/AuthContextProvider";
import { loginUser } from "context/authContext/authActions";

const Login: FunctionComponent = () => {
	const {
		dispatch,
		state: { isFetching, error },
	} = useContext(AuthContext);

	const validationSchema = yup.object({
		email: yup.string().email().required("Please enter an email address."),
		password: yup
			.string()
			.min(6, "The password is too short.")
			.required("Please enter a secure password"),
	});

	const { values, errors, handleBlur, handleChange, handleSubmit, setErrors } = useFormik({
		initialValues: {
			email: "",
			password: "",
		},
		validationSchema,
		onSubmit: async (values) => {
			await loginUser(values.password, values.email, dispatch);
			if (error)
				setErrors({
					email: error.email,
					password: error.password,
				});
			window.location.reload();
		},
	});

	const [passwordHidden, setPasswordHidden] = useState<boolean>(false);

	const setPassword = () => {
		setPasswordHidden(!passwordHidden);
	};

	const passwordIcon = passwordHidden ? (
		<AiFillEyeInvisible onClick={setPassword} className="iconRight" />
	) : (
		<AiFillEye onClick={setPassword} className="iconRight" />
	);
	const passwordType = passwordHidden ? "password" : "text";

	return (
		<>
			<Styled.Wrapper>
				<Styled.Form as="form" onSubmit={handleSubmit}>
					<Shared.Heading color="white">Login</Shared.Heading>
					<FormInput
						value={values.email}
						error={errors.email}
						onChange={handleChange}
						name="email"
						onBlur={handleBlur}
						leftIcon={<MdEmail className="iconLeft" />}
						placeholder="Email"
						type="email"
					/>
					<FormInput
						value={values.password}
						onChange={handleChange}
						error={errors.password}
						name="password"
						onBlur={handleBlur}
						leftIcon={<HiKey className="iconLeft" />}
						placeholder="Password"
						type={passwordType}
						rightIcon={passwordIcon}
					/>
					<FormButton loading={isFetching ? true : false} type="submit" text="Login" />
					<Shared.Label color="white">Or</Shared.Label>
					<Link style={{ textDecoration: "none" }} to="/register">
						<Shared.Body color="#1d76fc">Create an Account</Shared.Body>
					</Link>
				</Styled.Form>
			</Styled.Wrapper>
		</>
	);
};

export default Login;
