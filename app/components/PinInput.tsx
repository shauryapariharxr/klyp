"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

const LENGTH = 4;

/**
 * One frosted-glass treatment shared by all four slots, so the PIN field
 * matches the glass surfaces on the send page — no per-box colour tints.
 */
const BOX_STYLE = "border-white/20 bg-white/[0.08]";

const BOX_FOCUS = "focus:border-white/50 focus:bg-white/[0.14]";

const BOX_TEXT = "text-slate-100";

/** Read-only twin of PinInput, so the sender sees the same four boxes. */
export function PinDisplay({ value }: { value: string }) {
  const digits = value
    .replace(/\D/g, "")
    .padEnd(LENGTH, " ")
    .slice(0, LENGTH)
    .split("");
  return (
    <div
      role="group"
      aria-label={`Your PIN is ${value.replace(/\D/g, "")}`}
      className="grid grid-cols-4 gap-3"
    >
      {digits.map((digit, index) => (
        <div
          key={index}
          aria-hidden="true"
          className={`glass flex aspect-square w-full items-center justify-center rounded-2xl font-mono text-3xl font-bold ${BOX_STYLE} ${BOX_TEXT}`}
        >
          {digit.trim()}
        </div>
      ))}
    </div>
  );
}

type Props = {
  /** Exactly LENGTH chars; a space means "this slot is empty". */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

export default function PinInput({ value, onChange, disabled, autoFocus }: Props) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const slots = Array.from({ length: LENGTH }, (_, i) => {
    const char = value[i] ?? "";
    return /^\d$/.test(char) ? char : "";
  });

  const commit = (next: string[]) =>
    onChange(next.map((char) => char || " ").join(""));

  function focusSlot(index: number) {
    const el = inputs.current[Math.max(0, Math.min(LENGTH - 1, index))];
    el?.focus();
    el?.select();
  }

  /** Digits typed into a slot; keeps positions so out-of-order entry works. */
  function write(index: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    const next = [...slots];
    if (!typed) {
      next[index] = "";
      commit(next);
      return;
    }
    for (let i = 0; i < typed.length && index + i < LENGTH; i++) {
      next[index + i] = typed[i];
    }
    commit(next);
    focusSlot(index + typed.length - 1);
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...slots];
      if (next[index]) {
        next[index] = "";
      } else if (index > 0) {
        next[index - 1] = "";
        commit(next);
        focusSlot(index - 1);
        return;
      }
      commit(next);
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      const next = [...slots];
      next[index] = "";
      commit(next);
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusSlot(index - 1);
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      focusSlot(index + 1);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = Array.from({ length: LENGTH }, (_, i) => pasted[i] ?? "");
    commit(next);
    focusSlot(pasted.length - 1);
  }

  return (
    <div className="grid grid-cols-4 gap-3">
      {slots.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            inputs.current[index] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={1}
          disabled={disabled}
          autoFocus={autoFocus && index === 0}
          value={digit}
          aria-label={`PIN digit ${index + 1} of ${LENGTH}`}
          onChange={(e) => write(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.currentTarget.select()}
          className={`glass aspect-square w-full min-w-0 rounded-2xl text-center font-mono text-3xl font-bold outline-none transition-colors disabled:opacity-60 ${BOX_STYLE} ${BOX_FOCUS} ${BOX_TEXT}`}
        />
      ))}
    </div>
  );
}
