import instance from "api/instance";
import { AuthContext } from "context/authContext/AuthContextProvider";
import React, {
	ChangeEvent,
	FunctionComponent,
	KeyboardEvent,
	useContext,
	useRef,
	useState,
} from "react";
import { AiFillPicture } from "react-icons/ai";
import { GrClose } from "react-icons/gr";
import * as Styled from "styles/AddPost.elements";

interface AddPostProps {
	active?: boolean;
	closePost?: () => void;
}

const AddPost: FunctionComponent<AddPostProps> = ({ active, closePost }: AddPostProps) => {
	let descriptionRef = useRef<HTMLInputElement>(null).current;
	let fileInputRef = useRef<HTMLInputElement>(null).current;
	let wrapperRef = useRef<HTMLElement>(null).current;

	const {
		state: { user },
		dispatch,
	} = useContext(AuthContext);

	const [file, setFile] = useState<any>();

	const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
		if (event.target.files) setFile(event.target.files[0]);
	};

	const uploadPost = async (event: KeyboardEvent<HTMLInputElement>) => {
		if (file && event.key === "Enter") {
			const data = new FormData();
			const fileName = Date.now() + file?.name;
			data.append("name", fileName);
			data.append("file", file);

			await instance.post("/upload", data);

			await instance
				.post("/post/create", {
					userId: user?._id,
					image: fileName,
					description: descriptionRef?.value,
				})
				.then(({ data }) => {
					dispatch({ type: "UPDATE_USER", payload: { user: data, isFetching: false } });
					localStorage.setItem("user", JSON.stringify(data));
					setFile(null);

					if (descriptionRef) descriptionRef.value = "";

					if (closePost) closePost();

					wrapperRef?.scrollIntoView({ behavior: "smooth" });
				});
		}
	};

	const toggleFileInput = () => {
		fileInputRef?.click();
	};

	return (
		<Styled.Wrapper ref={(ref) => (wrapperRef = ref)} active={active?.toString()}>
			<input
				onChange={handleFile}
				ref={(ref) => (fileInputRef = ref)}
				className="fileInput"
				type="file"
				accept=".png, .jpg,.jpeg"
				id="file"
			/>
			<Styled.Text>
				{file ? (
					<GrClose onClick={() => setFile(null)} className="closeIcon" />
				) : (
					<label htmlFor="file">
						<AiFillPicture onClick={toggleFileInput} className="imageIcon" />
					</label>
				)}
			</Styled.Text>
			{file ? <Styled.Image alt="addPost" src={URL.createObjectURL(file)} /> : null}
			<Styled.Footer>
				<Styled.Input
					ref={(ref) => (descriptionRef = ref)}
					onKeyDown={uploadPost}
					placeholder="Write something."
				/>
			</Styled.Footer>
		</Styled.Wrapper>
	);
};

export default AddPost;
