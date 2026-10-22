"use client";
import { use } from "react";
import { MessagesShell, Thread } from "@/components/Messages";

export default function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <MessagesShell activeId={id}><Thread id={id} /></MessagesShell>;
}
