import instance from "api/instance";
import { AuthContext } from "context/authContext/AuthContextProvider";
import React, {
	ChangeEvent,
	FunctionComponent,
	MouseEventHandler,
	useContext,
	useRef,
	useState,
} from "react";
import { AiFillPicture } from "react-icons/ai";
import * as Shared from "styles/Shared.elements";
import * as Styled from "styles/UserInfo.elements";
import { useToggle } from "utilities/hooks";
import Avatar from "./Avatar";
import EditUser from "./EditUser";
import FollowButton from "./FollowButton";
import { CgClose } from "react-icons/cg";

interface UserInfoProps {
	username: string;
	posts: number;
	following: number;
	followers: number;
	description?: string;
	isCurrent: boolean;
	followOrUnFollowUser?: MouseEventHandler<HTMLButtonElement>;
	follow?: boolean;
	picture?: string;
}

const UserInfo: FunctionComponent<UserInfoProps> = ({
	username,
	posts,
	following,
	followers,
	description,
	isCurrent,
	followOrUnFollowUser,
	follow,
	picture,
}: UserInfoProps) => {
	const {
		state: { user },
		dispatch,
	} = useContext(AuthContext);

	let fileInputRef = useRef<HTMLInputElement>(null).current;

	const { value, setTrue, setFalse } = useToggle();
	const [file, setFile] = useState<any>();

	const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
		if (event.target.files) setFile(event.target.files[0]);
	};

	const updateDp = async () => {
		if (file) {
			const data = new FormData();

			const fileName = Date.now() + file.name;

			data.append("name", fileName);
			data.append("file", file);

			await instance.post("/upload", data);

			await instance
				.put(`/user/update/${user?._id}`, {
					picture: fileName,
				})
				.then(({ data }) => {
					dispatch({ type: "UPDATE_USER", payload: { user: data, isFetching: false } });
					localStorage.setItem("user", JSON.stringify(data));
					setFile(null);
				});
		}
	};

	const toggleFileInput = () => {
		fileInputRef?.click();
	};

	return (
		<Styled.Wrapper gap="1.5rem">
			<Styled.DisplayPicture htmlFor="file">
				{file ? (
					<Avatar className="displayPicture" size="8rem" alternateSrc={URL.createObjectURL(file)} />
				) : (
					<Avatar className="displayPicture" size="8rem" src={picture} />
				)}
				{file ? (
					<CgClose onClick={() => setFile(null)} className="closeIcon" />
				) : (
					<AiFillPicture className="pictureIcon" onClick={toggleFileInput} />
				)}
				<input
					ref={(ref) => (fileInputRef = ref)}
					onChange={handleFile}
					className="fileInput"
					id="file"
					type="file"
					accept=".png,.jpg,.jpeg"
				/>
			</Styled.DisplayPicture>
			{file ? <Styled.SaveButton onClick={updateDp}>Save</Styled.SaveButton> : null}

			<Shared.Column>
				<Shared.Body weight={400}>{username}</Shared.Body>
			</Shared.Column>
			<Shared.Row gap="2.5rem">
				<Shared.Column gap="0.3rem">
					<Shared.Body weight={400}>{posts}</Shared.Body>
					<Shared.Paragraph color="#777" weight={400}>
						Posts
					</Shared.Paragraph>
				</Shared.Column>
				<Shared.Column gap="0.3rem">
					<Shared.Body weight={400}>{followers}</Shared.Body>
					<Shared.Paragraph color="#777" weight={400}>
						Followers
					</Shared.Paragraph>
				</Shared.Column>
				<Shared.Column gap="0.3rem">
					<Shared.Body weight={400}>{following}</Shared.Body>
					<Shared.Paragraph color="#777" weight={400}>
						Following
					</Shared.Paragraph>
				</Shared.Column>
			</Shared.Row>
			<Styled.Description>
				<Shared.Paragraph weight={400}>{description}</Shared.Paragraph>
			</Styled.Description>
			{isCurrent ? null : <FollowButton follow={follow} onClick={followOrUnFollowUser} />}
			{isCurrent ? <Styled.EditButton onClick={setTrue}>Edit Profile</Styled.EditButton> : null}

			<EditUser closeEdit={setFalse} active={value} />
		</Styled.Wrapper>
	);
};

export default UserInfo;
