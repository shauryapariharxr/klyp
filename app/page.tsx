import Link from "next/link";

const steps = [
  { n: 1, label: "Send files or text" },
  { n: 2, label: "Get a 4-digit PIN" },
  { n: 3, label: "Share the PIN" },
  { n: 4, label: "Receiver downloads" },
];

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

        <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-5xl">
          Share anything.{" "}
          <span className="accent-gradient">No account needed.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base text-slate-400">
          Upload files or paste text, get a 4-digit PIN, and share it. The
          receiver enters the PIN to download. Everything is deleted after 30
          minutes.
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

        {/* Glass PIN mockup — shows the product at a glance */}
        <div className="glass-strong mx-auto mt-14 w-full max-w-xs rounded-2xl p-5">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Your transfer PIN
          </p>
          <div className="mt-2 flex items-center justify-center gap-2 font-mono text-4xl font-bold tracking-[0.25em]">
            {"4207".split("").map((d, i) => (
              <span
                key={i}
                className="glass rounded-lg px-3 py-2 accent-gradient"
                style={{ animation: `twinkle 3s ease-in-out ${i * 0.4}s infinite alternate` }}
              >
                {d}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            2 files · 18.4 MB · expires in 29:41
          </p>
        </div>

        <ol className="mx-auto mt-14 grid max-w-md grid-cols-2 gap-3 text-left text-sm sm:grid-cols-4">
          {steps.map((step) => (
            <li key={step.n} className="glass rounded-xl p-3">
              <div className="text-xs font-medium text-slate-500">
                Step {step.n}
              </div>
              <div className="mt-1 font-medium">{step.label}</div>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-xs text-slate-500">
          Up to 10 files · 100 MB total · PIN expires in 30 minutes
        </p>
      </div>
    </div>
  );
}
