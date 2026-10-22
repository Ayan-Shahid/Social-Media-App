"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import clsx from "clsx";
import { useSession } from "@/lib/session";
import { Avatar, Spinner } from "@/components/ui";
import { ChatIcon, HomeIcon, PlusIcon, SearchIcon } from "@/components/icons";

const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/explore", label: "Explore", Icon: SearchIcon },
  { href: "/new", label: "New post", Icon: PlusIcon },
  { href: "/messages", label: "Messages", Icon: ChatIcon },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, logout } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { if (me === null) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [me, router, path]);
  if (!me) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <div className="mx-auto flex min-h-dvh max-w-[1180px]">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-rule px-4 py-7 md:flex">
        <Link href="/" className="display mb-9 px-3 text-[26px]">Glimpse<span className="text-stamp">.</span></Link>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} className={clsx("flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-[15px] transition hover:bg-fog-deep", active(href) && "font-semibold bg-paper shadow-sm")}>
              <Icon className="h-6 w-6" />{label}
            </Link>
          ))}
          <Link href={`/u/${me.username}`} className={clsx("flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-[15px] transition hover:bg-fog-deep", path === `/u/${me.username}` && "font-semibold bg-paper shadow-sm")}>
            <Avatar user={me} size={24} />Profile
          </Link>
        </nav>
        <div className="mt-auto space-y-1 px-3 text-[14px] text-graphite">
          <Link href="/settings" className="block py-1 hover:text-ink">Edit profile</Link>
          <button onClick={async () => { await logout(); router.replace("/login"); }} className="block py-1 hover:text-ink">Log out</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-rule bg-fog/90 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/" className="display text-[22px]">Glimpse<span className="text-stamp">.</span></Link>
          <Link href="/settings" aria-label="Edit profile"><Avatar user={me} size={28} /></Link>
        </header>
        <main className="px-4 pt-6 pb-28 md:px-10 md:pt-10 md:pb-16">{children}</main>
      </div>

      {/* Mobile bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-rule bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {[...NAV, { href: `/u/${me.username}`, label: "Profile", Icon: null }].map(({ href, label, Icon }) => (
          <Link key={href} href={href} aria-label={label} className={clsx("grid h-14 flex-1 place-items-center", active(href) ? "text-ink" : "text-graphite")}>
            {Icon ? <Icon className="h-6 w-6" /> : <Avatar user={me} size={24} />}
          </Link>
        ))}
      </nav>
    </div>
  );
}
