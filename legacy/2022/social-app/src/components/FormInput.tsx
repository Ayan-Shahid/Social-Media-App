import React, { FunctionComponent, InputHTMLAttributes, ReactNode } from "react";
import * as Styled from "styles/FormInput.elements";
import * as Shared from "styles/Shared.elements";

interface FormInputProps extends InputHTMLAttributes<HTMLInputElement> {
	leftIcon?: ReactNode;
	rightIcon?: ReactNode;
	error?: string;
}

const FormInput: FunctionComponent<FormInputProps> = ({
	leftIcon,
	rightIcon,
	error,
	...props
}: FormInputProps) => {
	return (
		<Styled.Wrapper error={error ? "true" : "false"}>
			<Styled.InputWrapper>
				{leftIcon}
				<Styled.Input {...props} />
				{rightIcon}
			</Styled.InputWrapper>
			<Shared.Label className="error" weight={400} color="#ac3333">
				{error}
			</Shared.Label>
		</Styled.Wrapper>
	);
};

export default FormInput;
