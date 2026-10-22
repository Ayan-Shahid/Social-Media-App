"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { api, ApiError } from "@/lib/api";
import type { Collection, Post } from "@/lib/types";
import { PostGrid } from "@/components/Grid";
import { Button } from "@/components/Button";
import { Empty, ErrorText, PageTitle, Spinner } from "@/components/ui";

export default function SavedPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const cols = useQuery({ queryKey: ["collections"], queryFn: () => api<{ all: { count: number; coverUrl: string | null }; collections: Collection[] }>("/api/collections") });
  const posts = useQuery({ queryKey: ["saved", active], queryFn: () => api<{ posts: Post[] }>(`/api/collections/saved${active ? `?collection=${active}` : ""}`).then((r) => r.posts) });
  const create = useMutation({
    mutationFn: () => api<{ collection: Collection }>("/api/collections", { method: "POST", body: { name } }),
    onSuccess: () => { setName(""); setErr(null); qc.invalidateQueries({ queryKey: ["collections"] }); },
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Couldn't create it."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/collections/${id}`, { method: "DELETE" }),
    onSuccess: () => { setActive(null); qc.invalidateQueries({ queryKey: ["collections"] }); },
  });
  const tiles = [{ id: null as string | null, name: "All saved", count: cols.data?.all.count ?? 0, coverUrl: cols.data?.all.coverUrl ?? null }, ...(cols.data?.collections ?? [])];

  return (
    <div className="mx-auto max-w-[920px]">
      <PageTitle>Saved</PageTitle>
      <p className="-mt-3 mb-6 text-[14px] text-graphite">Only you can see what you&apos;ve saved.</p>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((c) => (
          <button key={c.id ?? "all"} onClick={() => setActive(c.id)} data-surface className={clsx("overflow-hidden rounded-xl text-left transition", active === c.id && "ring-2 ring-ink")}>
            <div className="aspect-[4/3] bg-fog-deep">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.coverUrl && <img src={c.coverUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="px-3 py-2"><p className="truncate font-semibold">{c.name}</p><p className="text-[12px] text-graphite">{c.count} saved</p></div>
          </button>
        ))}
      </div>
      <form className="mb-8 flex max-w-md gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="New collection name" aria-label="New collection name" className="field" />
        <Button variant="line" loading={create.isPending} disabled={!name.trim()}>Create</Button>
      </form>
      <ErrorText>{err}</ErrorText>
      {active && <div className="mb-4 flex justify-end"><Button variant="line" size="sm" onClick={() => confirm("Delete this collection? Saved posts stay in All saved.") && remove.mutate(active)}>Delete collection</Button></div>}
      {posts.isPending ? <Spinner /> : !posts.data?.length ? <Empty title="Nothing saved here">Tap the bookmark on any post to save it.</Empty> : <PostGrid posts={posts.data} />}
    </div>
  );
}
