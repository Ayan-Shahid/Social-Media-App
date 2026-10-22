"use client";
import { MessagesShell } from "@/components/Messages";
import { LockIcon } from "@/components/icons";

export default function MessagesPage() {
  return (
    <MessagesShell>
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div className="max-w-xs space-y-2">
          <LockIcon className="mx-auto h-9 w-9" />
          <p className="display text-lg">Your messages</p>
          <p className="text-[14px] text-graphite">End-to-end encrypted. Only you and the person you&apos;re talking to can read them, not even Glimpse.</p>
        </div>
      </div>
    </MessagesShell>
  );
}
