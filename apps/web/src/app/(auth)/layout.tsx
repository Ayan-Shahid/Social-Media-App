export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* A contact sheet of empty frames: the app before anyone has posted. */}
      <div className="relative hidden overflow-hidden bg-ink lg:block" aria-hidden>
        <div className="absolute inset-0 grid grid-cols-3 gap-3 p-10 opacity-90">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="relative rounded-[3px] bg-white/[0.06] ring-1 ring-white/10">
              <span className="stamp absolute right-2 bottom-1.5 text-[11px] opacity-70">{i + 1}</span>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-ink via-ink/95 to-transparent" />
        <div className="absolute inset-x-10 bottom-10">
          <p className="display text-[56px] leading-[0.95] text-white">Glimpse<span className="text-stamp">.</span></p>
          <p className="mt-3 max-w-sm text-[17px] text-white/70">Photos and videos from your friends, and messages only the two of you can read.</p>
        </div>
      </div>
      <div className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px]">{children}</div>
      </div>
    </div>
  );
}
