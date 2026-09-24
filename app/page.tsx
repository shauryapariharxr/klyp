import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl text-center">
        <p className="glass mx-auto inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs text-slate-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" />
          </span>
          Anonymous · Login-free · Self-destructing
        </p>

        <h1 className="font-display mt-6 text-4xl font-extrabold tracking-tight sm:text-5xl">
          Share it like a secret. <span className="accent-text">Then it&apos;s gone.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base text-slate-400">
          Files or text, sealed behind a 4-digit PIN. The receiver types it in,
          takes what they need, and the whole thing self-destructs on the clock.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/send"
            className="flex h-12 w-full items-center justify-center rounded-full bg-white px-8 text-sm font-semibold text-slate-950 shadow-[0_0_32px_rgba(165,180,252,0.35)] transition-all hover:shadow-[0_0_44px_rgba(165,180,252,0.55)] sm:w-auto"
          >
            Send files or text
          </Link>
          <Link
            href="/receive"
            className="glass flex h-12 w-full items-center justify-center rounded-full px-8 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10 sm:w-auto"
          >
            Receive with a PIN
          </Link>
        </div>

        <p className="mt-10 text-xs text-slate-500">
          Up to 10 files · 100 MB total · PIN expires in 30 minutes
        </p>
      </div>
    </div>
  );
}
