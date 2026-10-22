import Link from "next/link";
import { AuthHero } from "@/components/AuthHero";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <AuthHero />
      <div className="flex flex-col items-center justify-center px-5 py-10">
        <Link href="/welcome" className="display mb-6 text-[30px] lg:hidden">Glimpse<span className="text-stamp">.</span></Link>
        <div className="w-full max-w-[400px]">{children}</div>
      </div>
    </div>
  );
}
