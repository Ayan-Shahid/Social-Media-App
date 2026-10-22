"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isDark, useThemePref } from "@/lib/theme";
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Avatar, Spinner } from "@/components/ui";
import { BellIcon, BookmarkIcon, ChatIcon, GaugeIcon, HomeIcon, MoonIcon, PlayIcon, PlusIcon, SearchIcon, SunIcon } from "@/components/icons";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, logout, isAdmin } = useSession();
  const router = useRouter();
  const path = usePathname();
  const unread = useQuery({ queryKey: ["unread"], queryFn: () => api<{ count: number }>("/api/notifications/unread-count").then((r) => r.count), enabled: !!me, refetchInterval: 120_000 });
  useEffect(() => { if (me === null) router.replace(`/login?next=${encodeURIComponent(path)}`); }, [me, router, path]);
  if (!me) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>;

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const badge = (unread.data ?? 0) > 0 ? <span className="absolute -top-1 -right-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-heart px-1 text-[11px] font-bold text-white">{unread.data! > 9 ? "9+" : unread.data}</span> : null;
  const NAV = [
    { href: "/", label: "Home", icon: <HomeIcon className="h-6 w-6" /> },
    { href: "/explore", label: "Explore", icon: <SearchIcon className="h-6 w-6" /> },
    { href: "/shorts", label: "Shorts", icon: <PlayIcon className="h-6 w-6" /> },
    { href: "/new", label: "New post", icon: <PlusIcon className="h-6 w-6" /> },
    { href: "/messages", label: "Messages", icon: <ChatIcon className="h-6 w-6" /> },
    { href: "/notifications", label: "Notifications", icon: <span className="relative"><BellIcon className="h-6 w-6" />{badge}</span> },
    { href: "/saved", label: "Saved", icon: <BookmarkIcon className="h-6 w-6" /> },
    ...(isAdmin ? [{ href: "/ops", label: "Ops", icon: <GaugeIcon className="h-6 w-6" /> }] : []),
  ];
  const mobile = ["/", "/explore", "/shorts", "/new", "/notifications"];

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1240px]">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col px-4 py-7 md:flex">
        <Link href="/" className="display mb-9 px-3 text-[26px]">Glimpse<span className="text-stamp">.</span></Link>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ href, label, icon }) => (
            <Link key={href} href={href} data-surface={active(href) ? "" : undefined} data-pulse-anchor={href === "/messages" ? "messages" : undefined}
              className={clsx("flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-[15px] transition hover:bg-paper/50", active(href) && "font-semibold")}>
              {icon}{label}
            </Link>
          ))}
          <Link href={`/u/${me.username}`} data-surface={path === `/u/${me.username}` ? "" : undefined}
            className={clsx("flex items-center gap-3.5 rounded-xl px-3 py-2.5 text-[15px] transition hover:bg-paper/50", path === `/u/${me.username}` && "font-semibold")}>
            <Avatar user={me} size={24} />Profile
          </Link>
        </nav>
        <div className="mt-auto space-y-1 px-3 text-[14px] text-graphite">
          <ThemeToggle />
          <Link href="/settings" className="block py-1 hover:text-ink">Edit profile</Link>
          <button onClick={async () => { await logout(); router.replace("/login"); }} className="block py-1 hover:text-ink">Log out</button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center justify-between bg-fog/70 px-4 py-3 backdrop-blur md:hidden">
          <Link href="/" className="display text-[22px]">Glimpse<span className="text-stamp">.</span></Link>
          <div className="flex items-center gap-4">
            <Link href="/messages" aria-label="Messages"><ChatIcon className="h-6 w-6" /></Link>
            <Link href="/settings" aria-label="Edit profile"><Avatar user={me} size={28} /></Link>
          </div>
        </header>
        <main className="px-4 pt-6 pb-28 md:px-10 md:pt-10 md:pb-16">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-rule bg-paper/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {[...NAV.filter((n) => mobile.includes(n.href)), { href: `/u/${me.username}`, label: "Profile", icon: <Avatar user={me} size={24} /> }].map(({ href, label, icon }) => (
          <Link key={href} href={href} aria-label={label} className={clsx("grid h-14 flex-1 place-items-center", active(href) ? "text-ink" : "text-graphite")}>{icon}</Link>
        ))}
      </nav>
    </div>
  );
}

/** Flips between light and dark (Settings also offers "System"). */
function ThemeToggle() {
  const [pref, setPref] = useThemePref();
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(isDark()); }, [pref]);
  return (
    <button onClick={() => setPref(dark ? "light" : "dark")} className="flex items-center gap-2 py-1 hover:text-ink" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      {dark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}{dark ? "Light mode" : "Dark mode"}
    </button>
  );
}
