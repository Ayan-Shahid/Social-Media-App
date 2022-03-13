import React, { ButtonHTMLAttributes, FunctionComponent } from "react";
import * as Styled from "styles/FormButton.elements";

interface FormButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	loading?: boolean;
	text?: string;
}

const FormButton: FunctionComponent<FormButtonProps> = ({
	loading,
	text,
	...props
}: FormButtonProps) => {
	const state = loading ? loading.toString() : "false";
	return (
		<Styled.Wrapper {...props}>
			<Styled.Text active={state}>{text}</Styled.Text>
			<Styled.Loader loading={state} />
		</Styled.Wrapper>
	);
};

export default FormButton;
