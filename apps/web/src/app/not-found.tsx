import Link from "next/link";
export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div><p className="stamp text-[28px]">404</p><p className="display mt-2 text-xl">Nothing developed here</p>
        <Link href="/" className="btn-ink mt-6">Back to Glimpse</Link></div>
    </div>
  );
}
