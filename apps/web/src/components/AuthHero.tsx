"use client";
// Left side of log in / sign up: the 3D camera on a darkroom backdrop. When its shutter fires, the
// panel flashes white for a moment and a fresh "print" with today's date stamp slides out.
import Link from "next/link";
import { useState } from "react";
import { Camera3D } from "./Camera3D";
import { DateStamp } from "./ui";

export function AuthHero() {
  const [shots, setShots] = useState(0);
  return (
    <div className="auth-hero relative hidden overflow-hidden lg:block" aria-hidden>
      <Camera3D className="absolute inset-x-0 top-[6%] h-[62%]" onFlash={() => setShots((n) => n + 1)} />
      {shots > 0 && <span key={`f${shots}`} className="camera-flash pointer-events-none absolute inset-0 bg-white" />}
      {shots > 0 && (
        <span key={`p${shots}`} className="print-out absolute top-[58%] right-[12%] block w-36 rotate-[5deg] rounded-[3px] bg-[#fbfaf7] p-2 pb-7 shadow-2xl">
          <span className="develop-print block aspect-square rounded-[2px] bg-[linear-gradient(135deg,#ff8a3d,#3a1d5e_55%,#ffd36e)]" />
          <DateStamp iso={new Date().toISOString()} className="absolute right-3 bottom-1.5 text-[12px]" />
        </span>
      )}
      <div className="absolute inset-x-12 bottom-12">
        <Link href="/welcome" className="display text-[56px] leading-[0.95] text-white">Glimpse<span className="text-stamp">.</span></Link>
        <p className="mt-3 max-w-sm text-[17px] text-white/70">Photos, shorts and stories from your friends, and messages only the two of you can read.</p>
      </div>
    </div>
  );
}
