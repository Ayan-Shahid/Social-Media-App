// Glimpse database schema (Postgres).
//
// Every table has row-level security (RLS) turned on. The API connects as the "glimpse_app" role,
// which can't bypass RLS. Before each request's queries, the API sets `app.user_id` for the
// transaction, and the policies below decide which rows that user may read or change.
// Even a bug in a route can't leak another user's private data, because the database refuses.
import { sql } from "drizzle-orm";
import {
  pgTable, pgRole, pgPolicy, uuid, text, timestamp, integer, primaryKey, index, uniqueIndex, check, jsonb, customType,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({ dataType: () => "citext" });

/** The app role. Created by the migration runner (with a password from the environment). */
export const appRole = pgRole("glimpse_app").existing();

/** The signed-in user for the current transaction, or NULL. */
const me = sql`nullif(current_setting('app.user_id', true), '')::uuid`;
const signedIn = sql`${me} is not null`;

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
    fileName: text("file_name").notNull(), // server-generated, never from the user
    posterFileName: text("poster_file_name"), // video thumbnail
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    durationMs: integer("duration_ms"),
    bytes: integer("bytes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("media_kind", sql`${t.kind} in ('image', 'video')`),
    pgPolicy("media_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("media_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.ownerId} = ${me}` }),
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
    pgPolicy("follows_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.followerId} = ${me}` }),
    pgPolicy("follows_delete_self", { for: "delete", to: appRole, using: sql`${t.followerId} = ${me}` }),
  ],
).enableRLS();

// ---------- posts, likes, comments ----------

export const posts = pgTable(
  "posts",
  {
    id: id(),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mediaId: uuid("media_id").notNull().references(() => media.id),
    caption: text("caption").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("posts_author_created_idx").on(t.authorId, t.createdAt),
    index("posts_created_idx").on(t.createdAt),
    check("posts_caption_len", sql`char_length(${t.caption}) <= 2200`),
    pgPolicy("posts_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("posts_insert_self", {
      for: "insert", to: appRole,
      // You can only post as yourself, and only with media you uploaded.
      withCheck: sql`${t.authorId} = ${me} and exists (select 1 from media m where m.id = ${t.mediaId} and m.owner_id = ${me})`,
    }),
    pgPolicy("posts_update_self", { for: "update", to: appRole, using: sql`${t.authorId} = ${me}`, withCheck: sql`${t.authorId} = ${me}` }),
    pgPolicy("posts_delete_self", { for: "delete", to: appRole, using: sql`${t.authorId} = ${me}` }),
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
    pgPolicy("post_likes_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.userId} = ${me}` }),
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
    pgPolicy("comments_select", { for: "select", to: appRole, using: signedIn }),
    pgPolicy("comments_insert_self", { for: "insert", to: appRole, withCheck: sql`${t.authorId} = ${me}` }),
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

/** One conversation per pair of users. user_a is always the smaller id, so a pair can't be duplicated. */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    userA: uuid("user_a").notNull().references(() => users.id, { onDelete: "cascade" }),
    userB: uuid("user_b").notNull().references(() => users.id, { onDelete: "cascade" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversations_pair_key").on(t.userA, t.userB),
    index("conversations_user_b_idx").on(t.userB),
    check("conversations_ordered", sql`${t.userA} < ${t.userB}`),
    pgPolicy("conversations_select_member", { for: "select", to: appRole, using: sql`${me} in (${t.userA}, ${t.userB})` }),
    pgPolicy("conversations_insert_member", { for: "insert", to: appRole, withCheck: sql`${me} in (${t.userA}, ${t.userB})` }),
    pgPolicy("conversations_update_member", { for: "update", to: appRole, using: sql`${me} in (${t.userA}, ${t.userB})`, withCheck: sql`${me} in (${t.userA}, ${t.userB})` }),
  ],
).enableRLS();

/** Messages hold only ciphertext and a nonce. The server can't read them. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ciphertext: text("ciphertext").notNull(), // base64
    nonce: text("nonce").notNull(), // base64
    createdAt: createdAt(),
  },
  (t) => [
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    check("messages_ciphertext_len", sql`char_length(${t.ciphertext}) <= 20000`),
    pgPolicy("messages_select_member", {
      for: "select", to: appRole,
      using: sql`exists (select 1 from conversations c where c.id = ${t.conversationId} and ${me} in (c.user_a, c.user_b))`,
    }),
    pgPolicy("messages_insert_member", {
      for: "insert", to: appRole,
      withCheck: sql`${t.senderId} = ${me} and exists (select 1 from conversations c where c.id = ${t.conversationId} and ${me} in (c.user_a, c.user_b))`,
    }),
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
