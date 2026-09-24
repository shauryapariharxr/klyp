"use client";

import { useRef, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from "react";

const LENGTH = 4;

/**
 * One frosted-glass treatment shared by all four slots, so the PIN field
 * matches the glass surfaces on the rest of the site — no per-box tints.
 * Hover wakes the pane the same way the drop zone does: brighter border,
 * a touch more fill.
 */
const BOX_STYLE =
  "glass select-none border-white/20 bg-white/[0.08] text-slate-100 hover:border-white/40 hover:bg-white/[0.12]";

/** The box the next keystroke lands in — the field's own accent, echoed by
 *  the caret the moment you start typing. Solid 1px cyan line, slight lift,
 *  soft cyan floor-glow; deliberately not a rainbow halo. */
const BOX_ACTIVE =
  "border-cyan-300 bg-cyan-300/[0.06] text-white -translate-y-0.5 shadow-[0_6px_20px_-6px_rgba(2,6,23,0.8),0_0_0_1px_rgba(103,232,249,0.35)]";

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
          className={`flex aspect-square w-full items-center justify-center rounded-2xl font-mono text-3xl font-bold ${BOX_STYLE}`}
        >
          {digit.trim()}
        </div>
      ))}
    </div>
  );
}

type Props = {
  /** Up to LENGTH digits, padded with spaces so every slot has a character. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * Four glass boxes backed by a single transparent input stretched over them.
 * Anchoring the field to one element means the boxes fill in as you type, so
 * there is never a need to click (or re-click) an individual digit — one tap
 * anywhere on the row is enough. Backspace, paste and select-all-for-overwrite
 * all behave the way they would in any other text field.
 */
export default function PinInput({ value, onChange, disabled = false, autoFocus = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const digits = value.replace(/\D/g, "").slice(0, LENGTH);
  const slots = Array.from({ length: LENGTH }, (_, i) => digits[i] ?? "");
  // Once the PIN is full, hold the highlight on the last box.
  const activeIndex = Math.min(digits.length, LENGTH - 1);

  function emit(next: string) {
    onChange(next.padEnd(LENGTH, " "));
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    // Hard cap at four digits — extra keystrokes are ignored, so the field can
    // never hold more (or less) than a full PIN. Typing over a full field still
    // works because onFocus selects everything first.
    emit(e.target.value.replace(/\D/g, "").slice(0, LENGTH));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Backspace is the browser's job now that the whole PIN lives in one field;
    // only when the field is already empty do we swallow it so the page cannot
    // navigate back.
    if (e.key === "Backspace" && digits.length === 0) e.preventDefault();
    if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault();
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (!pasted) return;
    e.preventDefault();
    emit(pasted);
  }

  return (
    <div
      className="relative"
      onClick={() => {
        if (!disabled) inputRef.current?.focus();
      }}
    >
      <div aria-hidden="true" className="grid grid-cols-4 gap-3">
        {slots.map((digit, index) => (
          <div
            key={index}
            className={`flex aspect-square w-full min-w-0 items-center justify-center rounded-2xl font-mono text-3xl font-bold transition-all duration-200 ${
              index === activeIndex && !disabled ? BOX_ACTIVE : BOX_STYLE
            }`}
          >
            {digit}
          </div>
        ))}
      </div>

      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        enterKeyHint="go"
        spellCheck={false}
        disabled={disabled}
        autoFocus={autoFocus}
        value={digits}
        aria-label="4-digit PIN"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={(e) => {
          // Already full? Select it so the next keystroke starts the PIN over.
          if (digits.length >= LENGTH) e.currentTarget.select();
        }}
        className="absolute inset-0 h-full w-full cursor-pointer rounded-2xl bg-transparent text-base text-transparent caret-transparent outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}
