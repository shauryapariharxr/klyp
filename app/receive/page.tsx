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
      <div className="glass-strong w-full max-w-sm rounded-3xl p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Receive a transfer</h1>
        <p className="mt-2 text-sm text-slate-400">
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
            className="w-full rounded-2xl border border-white/15 bg-white/5 px-4 py-5 text-center font-mono text-3xl tracking-[0.5em] text-slate-100 outline-none transition-colors focus:border-cyan-300/60 focus:bg-white/10"
          />

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="flex h-12 w-full items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-950 shadow-[0_0_28px_rgba(165,180,252,0.35)] transition-shadow hover:shadow-[0_0_40px_rgba(165,180,252,0.55)] disabled:opacity-50"
          >
            {submitting ? "Checking…" : "View transfer"}
          </button>
        </form>
      </div>
    </div>
  );
}
