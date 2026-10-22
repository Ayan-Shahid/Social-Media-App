"use client";
import Link from "next/link";
import { use, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { timeAgo } from "@/lib/dates";
import type { Comment, Post } from "@/lib/types";
import { useSession } from "@/lib/session";
import { LikeButton, MediaView } from "@/components/PostCard";
import { Avatar, Empty, ErrorText, Spinner, UserLink } from "@/components/ui";
import { HeartIcon, TrashIcon } from "@/components/icons";

export default function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { me } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const post = useQuery({ queryKey: ["post", id], queryFn: () => api<{ post: Post }>(`/api/posts/${id}`) });
  const comments = useQuery({ queryKey: ["comments", id], queryFn: () => api<{ comments: Comment[] }>(`/api/posts/${id}/comments`).then((r) => r.comments) });

  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const commentKey = useRef(newIdempotencyKey());
  const add = useMutation({
    mutationFn: (text: string) => api<{ comment: Comment }>(`/api/posts/${id}/comments`, { method: "POST", body: { body: text }, idempotencyKey: commentKey.current }),
    onSuccess: (r) => {
      commentKey.current = newIdempotencyKey(); // next comment is a new action
      setBody("");
      qc.setQueryData<Comment[]>(["comments", id], (old) => [...(old ?? []).filter((c) => c.id !== r.comment.id), r.comment]);
      qc.setQueryData<{ post: Post }>(["post", id], (old) => old && { post: { ...old.post, commentCount: old.post.commentCount + 1 } });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Couldn't post your comment."),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/posts/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries(); router.replace(me ? `/u/${me.username}` : "/"); },
  });

  if (post.isPending) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (post.isError) return <Empty title="Post not found">It may have been deleted.</Empty>;
  const p = post.data.post;
  const mine = me?.id === p.author.id;

  return (
    <div className="mx-auto grid max-w-[1000px] gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="print h-fit pb-2.5"><MediaView post={p} priority /></div>
      <section className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-rule pb-4">
          <UserLink user={p.author} sub={timeAgo(p.createdAt)} />
          {mine && (
            <button onClick={() => confirm("Delete this post? This can't be undone.") && del.mutate()} className="text-graphite hover:text-heart" aria-label="Delete post">
              <TrashIcon className="h-5 w-5" />
            </button>
          )}
        </div>
        {p.caption && <p className="border-b border-rule py-4 text-[15px] whitespace-pre-wrap break-words">{p.caption}</p>}
        <ul className="flex-1 space-y-4 overflow-y-auto py-4 lg:max-h-[52vh]">
          {comments.isPending && <Spinner />}
          {comments.data?.length === 0 && <li className="text-[14px] text-graphite">No comments yet.</li>}
          {comments.data?.map((c) => <CommentRow key={c.id} c={c} postId={id} />)}
        </ul>
        <div className="border-t border-rule pt-4">
          <LikeButton post={p} />
          <form className="mt-4 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (body.trim() && !add.isPending) { setError(null); add.mutate(body.trim()); } }}>
            {me && <Avatar user={me} size={32} />}
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={1} placeholder="Add a comment…" aria-label="Add a comment"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
              className="field min-h-[42px] flex-1 resize-none py-2" />
            <button className="btn-ink" disabled={!body.trim() || add.isPending}>Post</button>
          </form>
          <ErrorText>{error}</ErrorText>
        </div>
      </section>
    </div>
  );
}

function CommentRow({ c, postId }: { c: Comment; postId: string }) {
  const qc = useQueryClient();
  const like = useMutation({
    mutationFn: (on: boolean) => api(`/api/comments/${c.id}/like`, { method: on ? "PUT" : "DELETE" }),
    onSuccess: (_r, on) => qc.setQueryData<Comment[]>(["comments", postId], (old) => old?.map((x) => x.id === c.id ? { ...x, likedByMe: on, likeCount: x.likeCount + (on ? 1 : -1) } : x)),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/comments/${c.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.setQueryData<Comment[]>(["comments", postId], (old) => old?.filter((x) => x.id !== c.id));
      qc.setQueryData<{ post: Post }>(["post", postId], (old) => old && { post: { ...old.post, commentCount: old.post.commentCount - 1 } });
    },
  });
  return (
    <li className="group flex gap-3">
      <Link href={`/u/${c.author.username}`}><Avatar user={c.author} size={30} /></Link>
      <div className="min-w-0 flex-1 text-[14px]">
        <p className="break-words"><Link href={`/u/${c.author.username}`} className="mr-1.5 font-semibold">{c.author.username}</Link>{c.body}</p>
        <p className="mt-0.5 flex gap-3 text-[12px] text-graphite">
          <span>{timeAgo(c.createdAt)}</span>
          {c.likeCount > 0 && <span>{c.likeCount} like{c.likeCount > 1 ? "s" : ""}</span>}
          {c.canDelete && <button className="opacity-0 transition group-hover:opacity-100 focus:opacity-100 hover:text-heart" onClick={() => del.mutate()}>Delete</button>}
        </p>
      </div>
      <button onClick={() => !like.isPending && like.mutate(!c.likedByMe)} aria-label={c.likedByMe ? "Unlike comment" : "Like comment"} aria-pressed={c.likedByMe}>
        <HeartIcon filled={c.likedByMe} className={clsx("h-4 w-4", c.likedByMe ? "text-heart" : "text-graphite")} />
      </button>
    </li>
  );
}
