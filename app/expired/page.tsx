export const metadata = { title: "Transfer expired" };

export default function ExpiredPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <div className="glass-strong w-full max-w-md rounded-3xl p-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-2xl">
          ⏳
        </div>
        <h1 className="font-display mt-6 text-2xl font-bold tracking-tight">
          This transfer has expired
        </h1>
        <p className="mt-3 text-sm text-slate-400">
          Transfers are deleted automatically 30 minutes after they are created.
          Ask the sender to share the files or text again.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href="/send"
            className="flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-slate-950 shadow-[0_0_24px_rgba(165,180,252,0.3)] transition-shadow hover:shadow-[0_0_36px_rgba(165,180,252,0.5)]"
          >
            Send something
          </a>
          <a
            href="/receive"
            className="glass flex h-11 items-center justify-center rounded-full px-6 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
          >
            I have another PIN
          </a>
        </div>
      </div>
    </div>
  );
}
