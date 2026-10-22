"use client";
import Link from "next/link";
import clsx from "clsx";
import type { User } from "@/lib/types";
import { stampDate } from "@/lib/dates";

/** `ring`: "unseen" draws the orange story ring, "seen" a quiet grey one. */
export function Avatar({ user, size = 36, online, ring }: { user: Pick<User, "username" | "avatarUrl">; size?: number; online?: boolean; ring?: "unseen" | "seen" }) {
  const inner = (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" width={size} height={size} className="h-full w-full rounded-full object-cover ring-1 ring-black/5" />
      ) : (
        <span className="grid h-full w-full place-items-center rounded-full bg-fog-deep font-semibold text-graphite" style={{ fontSize: size * 0.42 }}>
          {user.username.slice(0, 1).toUpperCase()}
        </span>
      )}
      {online && <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" aria-label="Online" />}
    </span>
  );
  if (!ring) return inner;
  return (
    <span className={clsx("inline-flex rounded-full p-[2.5px]", ring === "unseen" ? "bg-[conic-gradient(from_200deg,#f2691b,#ffb36b,#e0323b,#f2691b)]" : "bg-rule")}>
      <span className="rounded-full bg-white p-[2px]">{inner}</span>
    </span>
  );
}

export function UserLink({ user, sub, size = 36, online }: { user: User; sub?: React.ReactNode; size?: number; online?: boolean }) {
  return (
    <Link href={`/u/${user.username}`} className="flex min-w-0 items-center gap-3">
      <Avatar user={user} size={size} online={online} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold leading-tight">{user.username}</span>
        {sub && <span className="block truncate text-[13px] text-graphite">{sub}</span>}
      </span>
    </Link>
  );
}

/** The orange camera date imprint, in the corner of a photo. */
export function DateStamp({ iso, className }: { iso: string; className?: string }) {
  return (
    <time dateTime={iso} className={clsx("stamp pointer-events-none select-none text-[15px]", className)} title={new Date(iso).toLocaleString()}>
      {stampDate(iso)}
    </time>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx("inline-block h-5 w-5 animate-spin rounded-full border-2 border-rule border-t-ink", className)} role="status" aria-label="Loading" />;
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div data-surface className="rounded-2xl px-6 py-12 text-center">
      <p className="display text-lg">{title}</p>
      {children && <div className="mt-2 text-[15px] text-graphite">{children}</div>}
    </div>
  );
}

export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="text-[13px] font-medium text-heart" role="alert">{children}</p>;
}

export function PageTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <h1 className="display text-[28px] leading-none">{children}</h1>
      {right}
    </div>
  );
}
