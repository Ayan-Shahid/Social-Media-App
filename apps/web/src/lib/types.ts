export interface User { id: string; username: string; displayName: string; bio: string; avatarUrl: string | null }
export interface Media { id: string; kind: "image" | "video"; url: string; posterUrl: string | null; width: number; height: number }
export interface Post {
  id: string; author: User; caption: string; createdAt: string;
  media: Omit<Media, "id">; likeCount: number; commentCount: number; likedByMe: boolean;
}
export interface Comment { id: string; body: string; createdAt: string; author: User; likeCount: number; likedByMe: boolean; canDelete: boolean }
export interface Profile { user: User; counts: { posts: number; followers: number; following: number }; isFollowing: boolean; followsMe: boolean; isMe: boolean }
export interface Conversation { id: string; otherUser: User; otherPublicKey: string | null; lastMessageAt: string | null; createdAt: string }
export interface EncryptedMessage { id: string; conversationId: string; senderId: string; ciphertext: string; nonce: string; createdAt: string }
export interface KeyBackup { ciphertext: string; nonce: string; salt: string; opsLimit: number; memLimit: number }
export interface Page<T> { posts: T[]; nextCursor: string | null }
