"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import PinInput from "@/app/components/PinInput";

const PIN_PATTERN = /^\d{4}$/;

export default function ReceivePage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const digits = pin.replace(/\s/g, "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!PIN_PATTERN.test(digits)) {
      setError("Fill in all four digits to continue.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/transfer/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: digits }),
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
      <div className="w-full max-w-md">        <h1 className="font-display text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
          Enter the 4-digit PIN. <span className="accent-text">Open the transfer.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-center text-sm text-slate-400">
          The sender handed you four digits. Type them straight in — the boxes fill themselves as
          you go, and anything you paste lands in all four at once.
        </p>

        <div className="glass-strong-tinted mt-10 rounded-3xl p-6 sm:p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <PinInput value={pin} onChange={setPin} disabled={submitting} autoFocus />

            {error && (
              <p
                role="alert"
                className="glass rounded-xl border-red-400/30 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200"
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

          <p className="mt-5 text-center text-xs text-slate-500">
            Just start typing — no need to click each box. Backspace removes the last digit.
          </p>
        </div>
      </div>
    </div>
  );
}
