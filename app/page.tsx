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
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Share anything.{" "}
          <span className="text-zinc-500 dark:text-zinc-400">No account needed.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base text-zinc-600 dark:text-zinc-400">
          Upload files or paste text, get a 4-digit PIN, and share it. The receiver
          enters the PIN to download. Everything is deleted after 30 minutes.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/send"
            className="flex h-12 w-full items-center justify-center rounded-full bg-zinc-900 px-8 text-sm font-medium text-white transition-colors hover:bg-zinc-700 sm:w-auto dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Send files or text
          </Link>
          <Link
            href="/receive"
            className="flex h-12 w-full items-center justify-center rounded-full border border-zinc-300 px-8 text-sm font-medium transition-colors hover:bg-zinc-100 sm:w-auto dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Receive with a PIN
          </Link>
        </div>

        <ol className="mx-auto mt-14 grid max-w-md grid-cols-2 gap-3 text-left text-sm sm:grid-cols-4">
          {steps.map((step) => (
            <li
              key={step.n}
              className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="text-xs font-medium text-zinc-400">Step {step.n}</div>
              <div className="mt-1 font-medium">{step.label}</div>
            </li>
          ))}
        </ol>

        <p className="mt-10 text-xs text-zinc-400 dark:text-zinc-600">
          Up to 10 files · 100 MB total · PIN expires in 30 minutes
        </p>
      </div>
    </div>
  );
}
