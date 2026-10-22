export interface User { id: string; username: string; displayName: string; bio: string; avatarUrl: string | null; isPrivate?: boolean }
export interface Media {
  id: string; kind: "image" | "video"; status: "uploading" | "processing" | "ready" | "failed"; error: string | null;
  url: string | null; srcset: { w: number; url: string }[]; hls: string | null; posterUrl: string | null;
  width: number; height: number; durationMs: number | null;
}
export interface Post {
  id: string; author: User; kind: "post" | "short"; caption: string; createdAt: string; media: Media[];
  likeCount: number; commentCount: number; repostCount: number;
  likedByMe: boolean; savedByMe: boolean; repostedByMe: boolean; repostedBy: User | null;
}
export interface Comment { id: string; body: string; createdAt: string; author: User; likeCount: number; likedByMe: boolean; canDelete: boolean }
export interface Profile {
  user: User; counts: { posts: number; followers: number; following: number }; isFollowing: boolean; followsMe: boolean; isMe: boolean;
  requested: boolean; isBlocked: boolean; isMuted: boolean; canSeePosts: boolean;
}
export interface Member { user: User; role: string; publicKey: string | null }
export interface Conversation {
  id: string; kind: "direct" | "group"; title: string | null; currentEpoch: number; needsRotation: boolean;
  lastMessageAt: string | null; createdAt: string; members: Member[]; myRole: string | null;
  otherUser: User | null; otherPublicKey: string | null;
}
export interface EncryptedMessage { id: string; conversationId: string; senderId: string; epoch: number | null; ciphertext: string; nonce: string; createdAt: string }
export interface KeyBackup { ciphertext: string; nonce: string; salt: string; opsLimit: number; memLimit: number; kind?: "password" | "passcode" }
export interface Page<T> { posts: T[]; nextCursor: string | null }
export interface Notification {
  type: "like" | "comment" | "follow" | "mention" | "repost" | "follow_request" | "follow_accept"; total: number; unread: boolean; createdAt: string;
  actors: User[]; post: { id: string; thumbUrl: string | null } | null; comment: string | null;
}
export interface Story { id: string; createdAt: string; expiresAt: string; seen: boolean; media: Media; views?: number }
export interface TrayItem { user: User; latest: string; allSeen: boolean }
export interface Collection { id: string; name: string; count: number; coverUrl: string | null }
