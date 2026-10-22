// Glimpse database schema (Postgres).
//
// Every table has row-level security (RLS) turned on. The API connects as the "glimpse_app" role,
// which can't bypass RLS. Before each request's queries, the API sets `app.user_id` for the
// transaction, and the policies below decide which rows that user may read or change.
// Even a bug in a route can't leak another user's private data, because the database refuses.
import { sql } from "drizzle-orm";
import {
  pgTable, pgRole, pgPolicy, bigserial, uuid, text, timestamp, integer, boolean, primaryKey, index, uniqueIndex, check, jsonb, customType,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({ dataType: () => "citext" });

export interface MediaVariants {
  src?: string; // best single image
  srcset?: { w: number; path: string }[];
  hls?: string; // master playlist
  poster?: string;
}


/** Is the signed-in user an active member of this conversation? SECURITY DEFINER, so policies can use it without recursion. */
const isMember = (col: unknown) => sql`app.is_member(${col})`;

/** The app role. Created by the migration runner (with a password from the environment). */
export const appRole = pgRole("glimpse_app").existing();

/** The signed-in user for the current transaction, or NULL. */
const me = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const signedIn = sql`${me} is not null`;
// Privacy (DECISIONS.md D15): "can the signed-in user see content by this author?" One definition,
// used by every policy that hides content. SECURITY DEFINER because it must read blocks in both directions.
const canSee = (author: unknown) => sql`app.can_see(${author})`;

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- users ----------

export const users = pgTable(
  "users",
  {
    id: id(),
    username: citext("username").notNull(),
    displayName: text("display_name").notNull().default(""),
    bio: text("bio").notNull().default(""),
    avatarMediaId: uuid("avatar_media_id"),
    isPrivate: boolean("is_private").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_username_key").on(t.username),
    index("users_username_trgm").using("gin", sql`${t.username} gin_trgm_ops`),
    check("users_username_format", sql`${t.username} ~ '^[a-zA-Z0-9_.]{3,30}$'`),
    check("users_bio_len", sql`char_length(${t.bio}) <= 300`),
    check("users_display_name_len", sql`char_length(${t.displayName}) <= 60`),
    pgPolicy("users_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("users_update_self", { for: "update", to: appRole, using: sql`${t.id} = ${me}`, withCheck: sql`${t.id} = ${me}` }),
  ],
).enableRLS();

/** Email and password hash. The app role has NO access; only the security-definer auth functions read it. */
export const userCredentials = pgTable(
  "user_credentials",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    email: citext("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_credentials_email_key").on(t.email)],
).enableRLS();

/** Login sessions. Only a SHA-256 hash of the session token is stored. No direct app access. */
export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent").notNull().default(""),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
).enableRLS();

// ---------- end-to-end encryption keys ----------

/** Each user's public key. Anyone signed in can read it, to encrypt messages to that user. */
export const publicKeys = pgTable(
  "public_keys",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(), // base64, X25519
    createdAt: createdAt(),
  },
  (t) => [
    pgPolicy("public_keys_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("public_keys_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.userId} = ${me}` }),
  ],
).enableRLS();

/**
 * The user's private key, encrypted in the browser with a key derived from their password
 * (Argon2id). The server only ever sees ciphertext. Only the owner can read their own backup.
 */
export const keyBackups = pgTable(
  "key_backups",
  {
    userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),
    salt: text("salt").notNull(),
    opsLimit: integer("ops_limit").notNull(),
    memLimit: integer("mem_limit").notNull(),
    kind: text("kind").notNull().default("password"), // password | passcode (Google users)
    createdAt: createdAt(),
  },
  (t) => [
    pgPolicy("key_backups_select_self", { for: "select", to: appRole, using: sql`${t.userId} = ${me}` }),
    pgPolicy("key_backups_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.userId} = ${me}` }),
  ],
).enableRLS();

// ---------- media ----------

export const media = pgTable(
  "media",
  {
    id: id(),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // image | video
    purpose: text("purpose").notNull().default("post"), // post | avatar | story | short
    status: text("status").notNull().default("ready"), // uploading | processing | ready | failed
    error: text("error"),
    originalPath: text("original_path"), // object key in the private uploads bucket; deleted after processing
    // Output files, all under /media/<id>/: { src, srcset: [{w, path}], hls, poster }
    variants: jsonb("variants").$type<MediaVariants>(),
    fileName: text("file_name"), // v1 single-file output (kept for old rows)
    posterFileName: text("poster_file_name"),
    mime: text("mime").notNull().default(""),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    durationMs: integer("duration_ms"),
    bytes: integer("bytes").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    check("media_kind", sql`${t.kind} in ('image', 'video')`),
    check("media_status", sql`${t.status} in ('uploading', 'processing', 'ready', 'failed')`),
    pgPolicy("media_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("media_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.ownerId} = ${me}` }),
    // "Complete upload": the owner may only move their own row out of 'uploading'. Everything
    // after that (ready, variants, sizes) is the worker's job, under its own role.
    pgPolicy("media_complete_own", {
      for: "update", to: appRole,
      using: sql`${t.ownerId} = ${me} and ${t.status} = 'uploading'`,
      withCheck: sql`${t.ownerId} = ${me} and ${t.status} in ('processing', 'failed')`,
    }),
  ],
).enableRLS();

// ---------- social graph ----------

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index("follows_followee_idx").on(t.followeeId),
    check("follows_not_self", sql`${t.followerId} <> ${t.followeeId}`),
    pgPolicy("follows_select", { for: "select", to: appRole, using: signedIn }),
    // Direct follows only for public accounts you're not blocked from; private ones go through a request.
    pgPolicy("follows_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.followerId} = ${me} and app.can_follow(${t.followeeId})` }),
    // Unfollow, or remove someone who follows you.
    pgPolicy("follows_delete_self", { for: "delete", to: appRole, using: sql`${t.followerId} = ${me} or ${t.followeeId} = ${me}` }),
  ],
).enableRLS();

export const followRequests = pgTable(
  "follow_requests",
  {
    requesterId: uuid("requester_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    targetId: uuid("target_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.requesterId, t.targetId] }),
    index("follow_requests_target_idx").on(t.targetId, t.createdAt),
    check("follow_requests_not_self", sql`${t.requesterId} <> ${t.targetId}`),
    pgPolicy("follow_requests_select", { for: "select", to: appRole, using: sql`${t.requesterId} = ${me} or ${t.targetId} = ${me}` }),
    pgPolicy("follow_requests_insert", { for: "insert", to: appRole, withCheck: sql`${t.requesterId} = ${me} and app.can_request(${t.targetId})` }),
    // Cancel your request, or decline one sent to you. Accepting goes through app.accept_follow_request().
    pgPolicy("follow_requests_delete", { for: "delete", to: appRole, using: sql`${t.requesterId} = ${me} or ${t.targetId} = ${me}` }),
  ],
).enableRLS();

/** Only the blocker can see their blocks; the other side only notices that content disappears. */
export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId] }),
    index("blocks_blocked_idx").on(t.blockedId),
    check("blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`),
    pgPolicy("blocks_select_own", { for: "select", to: appRole, using: sql`${t.blockerId} = ${me}` }),
    pgPolicy("blocks_delete_own", { for: "delete", to: appRole, using: sql`${t.blockerId} = ${me}` }),
    // Inserts go through app.block_user(), which also removes follows both ways in the same transaction.
  ],
).enableRLS();

/** Mutes are a preference, not a permission: they filter your feed and stories tray, nothing else. */
export const mutes = pgTable(
  "mutes",
  {
    muterId: uuid("muter_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mutedId: uuid("muted_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.muterId, t.mutedId] }),
    check("mutes_not_self", sql`${t.muterId} <> ${t.mutedId}`),
    pgPolicy("mutes_own", { for: "all", to: appRole, using: sql`${t.muterId} = ${me}`, withCheck: sql`${t.muterId} = ${me}` }),
  ],
).enableRLS();

// ---------- posts, likes, comments ----------

export const posts = pgTable(
  "posts",
  {
    id: id(),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("post"), // post | short
    caption: text("caption").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    index("posts_created_idx").on(t.createdAt),
    index("posts_kind_created_idx").on(t.kind, t.createdAt),
    check("posts_kind", sql`${t.kind} in ('post', 'short')`),
    check("posts_caption_len", sql`char_length(${t.caption}) <= 2200`),
    pgPolicy("posts_select", { for: "select", to: appRole, using: sql`${signedIn} and ${canSee(t.authorId)}` }),
    pgPolicy("posts_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.authorId} = ${me}` }),
    pgPolicy("posts_update_self", { for: "update", to: appRole, using: sql`${t.authorId} = ${me}`, withCheck: sql`${t.authorId} = ${me}` }),
    pgPolicy("posts_delete_self", { for: "delete", to: appRole, using: sql`${t.authorId} = ${me}` }),
  ],
).enableRLS();

/** The photos/videos of a post, in order (carousels have up to 10). */
export const postMedia = pgTable(
  "post_media",
  {
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").notNull().references(() => media.id),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.position] }),
    uniqueIndex("post_media_media_key").on(t.mediaId),
    check("post_media_position", sql`${t.position} between 0 and 9`),
    pgPolicy("post_media_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("post_media_insert", {
      for: "insert", to: appRole,
      // Only into your own post, and only media you uploaded.
      withCheck: sql`exists (select 1 from posts p where p.id = ${t.postId} and p.author_id = ${me})
        and exists (select 1 from media m where m.id = ${t.mediaId} and m.owner_id = ${me})`,
    }),
  ],
).enableRLS();

export const reposts = pgTable(
  "reposts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    index("reposts_post_idx").on(t.postId),
    pgPolicy("reposts_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("reposts_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.userId} = ${me} and exists (select 1 from posts p where p.id = ${t.postId})` }),
    pgPolicy("reposts_delete_self", { for: "delete", to: appRole, using: sql`${t.userId} = ${me}` }),
  ],
).enableRLS();

/** Saved posts are private: only the owner can see them. */
export const collections = pgTable(
  "collections",
  {
    id: id(),
    ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("collections_owner_name_key").on(t.ownerId, t.name),
    check("collections_name_len", sql`char_length(${t.name}) between 1 and 60`),
    pgPolicy("collections_owner", { for: "all", to: appRole, using: sql`${t.ownerId} = ${me}`, withCheck: sql`${t.ownerId} = ${me}` }),
  ],
).enableRLS();

export const savedPosts = pgTable(
  "saved_posts",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.postId] }),
    pgPolicy("saved_posts_owner", { for: "all", to: appRole, using: sql`${t.userId} = ${me}`, withCheck: sql`${t.userId} = ${me} and exists (select 1 from posts p where p.id = ${t.postId})` }),
  ],
).enableRLS();

export const hashtags = pgTable(
  "hashtags",
  { id: id(), tag: citext("tag").notNull(), createdAt: createdAt() },
  (t) => [
    uniqueIndex("hashtags_tag_key").on(t.tag),
    check("hashtags_format", sql`${t.tag} ~ '^[[:alnum:]_]{1,50}$'`),
    pgPolicy("hashtags_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("hashtags_insert", { for: "insert", to: appRole, withCheck: signedIn }),
  ],
).enableRLS();

export const postHashtags = pgTable(
  "post_hashtags",
  {
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    hashtagId: uuid("hashtag_id").notNull().references(() => hashtags.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.hashtagId] }),
    index("post_hashtags_tag_idx").on(t.hashtagId, t.createdAt),
    pgPolicy("post_hashtags_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("post_hashtags_insert", { for: "insert", to: appRole, withCheck: sql`exists (select 1 from posts p where p.id = ${t.postId} and p.author_id = ${me})` }),
  ],
).enableRLS();

export const mentions = pgTable(
  "mentions",
  {
    id: id(),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mentionedUserId: uuid("mentioned_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("mentions_user_idx").on(t.mentionedUserId, t.createdAt),
    pgPolicy("mentions_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("mentions_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.authorId} = ${me}` }),
  ],
).enableRLS();

/** Written only by workers (from outbox events). Users can read and mark their own. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    recipientId: uuid("recipient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // like | comment | follow | mention | repost
    postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id"),
    // The outbox event that created it: makes the worker idempotent.
    eventId: text("event_id").notNull(),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("notifications_event_key").on(t.eventId, t.recipientId),
    index("notifications_recipient_idx").on(t.recipientId, t.createdAt),
    check("notifications_type", sql`${t.type} in ('like', 'comment', 'follow', 'mention', 'repost', 'follow_request', 'follow_accept')`),
    pgPolicy("notifications_select_self", { for: "select", to: appRole, using: sql`${t.recipientId} = ${me}` }),
    pgPolicy("notifications_update_self", { for: "update", to: appRole, using: sql`${t.recipientId} = ${me}`, withCheck: sql`${t.recipientId} = ${me}` }),
  ],
).enableRLS();

/** Stories disappear after 24 hours: hidden by the policy, then deleted by a worker. */
export const stories = pgTable(
  "stories",
  {
    id: id(),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").notNull().references(() => media.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '24 hours'`),
  },
  (t) => [
    index("stories_author_idx").on(t.authorId, t.expiresAt),
    pgPolicy("stories_select_active", { for: "select", to: appRole, using: sql`${signedIn} and ${t.expiresAt} > now() and ${canSee(t.authorId)}` }),
    pgPolicy("stories_insert_self", {
      for: "insert", to: appRole,
      withCheck: sql`${t.authorId} = ${me} and exists (select 1 from media m where m.id = ${t.mediaId} and m.owner_id = ${me})`,
    }),
    pgPolicy("stories_delete_self", { for: "delete", to: appRole, using: sql`${t.authorId} = ${me}` }),
  ],
).enableRLS();

export const storyViews = pgTable(
  "story_views",
  {
    storyId: uuid("story_id").notNull().references(() => stories.id, { onDelete: "cascade" }),
    viewerId: uuid("viewer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.storyId, t.viewerId] }),
    pgPolicy("story_views_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.viewerId} = ${me}` }),
    // You see your own views, and the story's author sees who viewed it.
    pgPolicy("story_views_select", {
      for: "select", to: appRole,
      using: sql`${t.viewerId} = ${me} or exists (select 1 from stories s where s.id = ${t.storyId} and s.author_id = ${me})`,
    }),
  ],
).enableRLS();

export const postLikes = pgTable(
  "post_likes",
  {
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.userId] }),
    pgPolicy("post_likes_select", { for: "select", to: appRole, using: signedIn }),
    // RLS applies inside the subquery too: you can only like a post the posts policy lets you see.
    pgPolicy("post_likes_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.userId} = ${me} and exists (select 1 from posts p where p.id = ${t.postId})` }),
    pgPolicy("post_likes_delete_self", { for: "delete", to: appRole, using: sql`${t.userId} = ${me}` }),
  ],
).enableRLS();

export const comments = pgTable(
  "comments",
  {
    id: id(),
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("comments_post_created_idx").on(t.postId, t.createdAt),
    check("comments_body_len", sql`char_length(${t.body}) between 1 and 1000`),
    pgPolicy("comments_select", { for: "select", to: appRole, using: sql`${signedIn} and exists (select 1 from posts p where p.id = ${t.postId})` }),
    pgPolicy("comments_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.authorId} = ${me} and exists (select 1 from posts p where p.id = ${t.postId})` }),
    // The comment's author, or the owner of the post, can delete it.
    pgPolicy("comments_delete", {
      for: "delete", to: appRole,
      using: sql`${t.authorId} = ${me} or exists (select 1 from posts p where p.id = ${t.postId} and p.author_id = ${me})`,
    }),
  ],
).enableRLS();

export const commentLikes = pgTable(
  "comment_likes",
  {
    commentId: uuid("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.commentId, t.userId] }),
    pgPolicy("comment_likes_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("comment_likes_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.userId} = ${me}` }),
    pgPolicy("comment_likes_delete_self", { for: "delete", to: appRole, using: sql`${t.userId} = ${me}` }),
  ],
).enableRLS();

// ---------- direct messages (end-to-end encrypted) ----------

/**
 * A conversation is "direct" (exactly two people; user_a < user_b so a pair can't be duplicated)
 * or "group" (up to 32 members). Who can see it is decided by conversation_members.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    kind: text("kind").notNull().default("direct"), // direct | group
    title: text("title"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    userA: uuid("user_a").references(() => users.id, { onDelete: "cascade" }),
    userB: uuid("user_b").references(() => users.id, { onDelete: "cascade" }),
    // Group encryption: the current key epoch. A member left and the key must be rotated before the next message.
    currentEpoch: integer("current_epoch").notNull().default(0),
    needsRotation: boolean("needs_rotation").notNull().default(false),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversations_pair_key").on(t.userA, t.userB),
    check("conversations_kind", sql`(${t.kind} = 'direct' and ${t.userA} < ${t.userB}) or (${t.kind} = 'group' and ${t.userA} is null and ${t.userB} is null)`),
    check("conversations_title_len", sql`${t.title} is null or char_length(${t.title}) between 1 and 60`),
    pgPolicy("conversations_select_member", { for: "select", to: appRole, using: isMember(t.id) }),
    pgPolicy("conversations_insert", {
      for: "insert", to: appRole,
      withCheck: sql`${t.createdBy} = ${me} and (${t.kind} = 'group' or ${me} in (${t.userA}, ${t.userB}))`,
    }),
    pgPolicy("conversations_update_member", { for: "update", to: appRole, using: isMember(t.id), withCheck: isMember(t.id) }),
  ],
).enableRLS();

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | member
    joinedEpoch: integer("joined_epoch").notNull().default(0),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index("conversation_members_user_idx").on(t.userId),
    pgPolicy("members_select", { for: "select", to: appRole, using: isMember(t.conversationId) }),
    // The creator adds the first members; after that, any active member can add people.
    pgPolicy("members_insert", {
      for: "insert", to: appRole,
      withCheck: sql`${isMember(t.conversationId)} or app.is_creator(${t.conversationId})`,
    }),
    pgPolicy("members_update", { for: "update", to: appRole, using: isMember(t.conversationId), withCheck: sql`true` }),
  ],
).enableRLS();

/** A group key, wrapped (encrypted) for one member by whoever created that epoch. The server can't unwrap it. */
export const groupKeys = pgTable(
  "group_keys",
  {
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    epoch: integer("epoch").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    wrappedBy: uuid("wrapped_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    wrappedKey: text("wrapped_key").notNull(),
    nonce: text("nonce").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.epoch, t.userId] }),
    pgPolicy("group_keys_select_own", { for: "select", to: appRole, using: sql`${t.userId} = ${me}` }),
    pgPolicy("group_keys_insert", { for: "insert", to: appRole, withCheck: sql`${t.wrappedBy} = ${me} and ${isMember(t.conversationId)}` }),
  ],
).enableRLS();

/** Messages hold only ciphertext and a nonce (and, in groups, the key epoch). The server can't read them. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    epoch: integer("epoch"),
    ciphertext: text("ciphertext").notNull(), // base64
    nonce: text("nonce").notNull(), // base64
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    check("messages_ciphertext_len", sql`char_length(${t.ciphertext}) <= 20000`),
    pgPolicy("messages_select_member", { for: "select", to: appRole, using: isMember(t.conversationId) }),
    // In a 1:1 chat, a block on either side stops new messages (old ones stay readable).
    pgPolicy("messages_insert_member", { for: "insert", to: appRole, withCheck: sql`${t.senderId} = ${me} and ${isMember(t.conversationId)} and not app.direct_blocked(${t.conversationId})` }),
  ],
).enableRLS();

// ---------- idempotency ----------

/**
 * Remembers the result of each "create" request by its Idempotency-Key, so a double click or a
 * network retry returns the first result instead of creating a duplicate.
 */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: text("status").notNull(), // in_progress | done
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("idempotency_created_idx").on(t.createdAt),
    check("idempotency_key_format", sql`${t.key} ~ '^[A-Za-z0-9_-]{8,100}$'`),
    pgPolicy("idempotency_select_self", { for: "select", to: appRole, using: sql`${t.userId} = ${me}` }),
    pgPolicy("idempotency_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.userId} = ${me}` }),
    pgPolicy("idempotency_update_self", { for: "update", to: appRole, using: sql`${t.userId} = ${me}`, withCheck: sql`${t.userId} = ${me}` }),
    pgPolicy("idempotency_delete_self", { for: "delete", to: appRole, using: sql`${t.userId} = ${me}` }),
  ],
).enableRLS();

// ---------- sign-in with Google ----------

/** Linked social accounts. No app access: only the auth.* SECURITY DEFINER functions touch it. */
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    provider: text("provider").notNull(), // google
    providerUserId: text("provider_user_id").notNull(), // Google "sub"
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    email: citext("email"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerUserId] }), index("oauth_accounts_user_idx").on(t.userId)],
).enableRLS();

// ---------- transactional outbox ----------

/**
 * Events written in the SAME transaction as the change they describe. A relay moves them to the
 * queue. If the transaction rolls back, the event never existed; if the process crashes after
 * commit, the relay still finds it. See DECISIONS.md D5.
 */
export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: text("type").notNull(),
    actorId: uuid("actor_id"),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [
    index("outbox_unpublished_idx").on(t.id).where(sql`${t.publishedAt} is null`),
    pgPolicy("outbox_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.actorId} = ${me}` }),
  ],
).enableRLS();

export type Notification = typeof notifications.$inferSelect;
export type Story = typeof stories.$inferSelect;
