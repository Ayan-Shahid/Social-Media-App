import React, { FunctionComponent } from "react";
import * as Styled from "styles/Avatar.elements";

interface AvatarProps {
	src?: string;
	alt?: string;
	size?: string;
	status?: "online" | "offline";
	className?: string;
	alternateSrc?: string;
}

const Avatar: FunctionComponent<AvatarProps> = ({
	src,
	alt,
	status,
	size,
	className,
	alternateSrc,
}: AvatarProps) => {
	const showStatus = status === "online" ? <Styled.Status /> : null;

	const imageUrl = src ? `http://localhost:8000/images/${src}` : alternateSrc;
	return (
		<Styled.Wrapper size={size} className={className}>
			<Styled.Image alt={alt} src={imageUrl} />
			{showStatus}
		</Styled.Wrapper>
	);
};

export default Avatar;
