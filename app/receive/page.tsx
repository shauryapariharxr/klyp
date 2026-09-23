"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PIN_PATTERN = /^\d{4}$/;

export default function ReceivePage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!PIN_PATTERN.test(pin)) {
      setError("Enter the 4-digit PIN.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/transfer/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        transferId?: string;
        accessToken?: string;
      } | null;

      if (!res.ok || !data?.transferId || !data.accessToken) {
        setError(data?.error ?? "Could not verify the PIN. Try again.");
        return;
      }

      router.push(`/transfer/${data.transferId}?token=${encodeURIComponent(data.accessToken)}`);
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Receive a transfer</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Enter the 4-digit PIN the sender shared with you.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="••••"
            aria-label="4-digit PIN"
            className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-5 text-center font-mono text-3xl tracking-[0.5em] outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-400"
          />

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex h-12 w-full items-center justify-center rounded-full bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {submitting ? "Checking…" : "View transfer"}
          </button>
        </form>
      </div>
    </div>
  );
}
