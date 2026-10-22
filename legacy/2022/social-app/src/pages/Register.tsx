import { FormButton, FormInput } from "components";
import React, { FunctionComponent, useContext, useState } from "react";
import * as Styled from "styles/Login.elements";
import * as Shared from "styles/Shared.elements";
import { MdEmail } from "react-icons/md";
import { FaUser } from "react-icons/fa";
import { AiFillEyeInvisible, AiFillEye } from "react-icons/ai";
import { HiKey } from "react-icons/hi";
import { Link, useNavigate } from "react-router-dom";
import { useFormik } from "formik";
import * as yup from "yup";
import { registerUser } from "context/authContext/authActions";
import { AuthContext } from "context/authContext/AuthContextProvider";

const Register: FunctionComponent = () => {
	const {
		dispatch,
		state: { isFetching, error },
	} = useContext(AuthContext);

	const navigate = useNavigate();

	const [passwordHidden, setPasswordHidden] = useState<boolean>(false);

	const validationSchema = yup.object({
		username: yup.string().required("Please enter a username").min(4),
		email: yup.string().email().required("Please enter an email address."),
		password: yup
			.string()
			.min(6, "The password is too short.")
			.required("Please enter a secure password"),
	});

	const { values, errors, handleBlur, handleChange, handleSubmit, setErrors } = useFormik({
		initialValues: {
			username: "",
			email: "",
			password: "",
		},
		validationSchema,
		onSubmit: async (values) => {
			await registerUser(values.username, values.password, values.email, dispatch);
			if (error)
				setErrors({
					username: error.username,
					email: error.email,
				});

			navigate("/");
		},
	});

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
					<Shared.Heading color="white">Register</Shared.Heading>
					<FormInput
						value={values.username}
						error={errors.username}
						onChange={handleChange}
						name="username"
						onBlur={handleBlur}
						leftIcon={<FaUser className="iconLeft" />}
						placeholder="username"
						type="text"
					/>
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
					<FormButton loading={isFetching ? true : false} type="submit" text="Create an Account" />
					<Shared.Label color="white">Or</Shared.Label>
					<Link style={{ textDecoration: "none" }} to="/">
						<Shared.Body color="#1d76fc">Login</Shared.Body>
					</Link>
				</Styled.Form>
			</Styled.Wrapper>
		</>
	);
};

export default Register;
