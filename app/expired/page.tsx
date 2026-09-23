export const metadata = { title: "Transfer expired" };

export default function ExpiredPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <div className="w-full max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100 text-2xl dark:bg-zinc-900">
          ⏳
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          This transfer has expired
        </h1>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Transfers are deleted automatically 30 minutes after they are created.
          Ask the sender to share the files or text again.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href="/send"
            className="flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Send something
          </a>
          <a
            href="/receive"
            className="flex h-11 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            I have another PIN
          </a>
        </div>
      </div>
    </div>
  );
}
