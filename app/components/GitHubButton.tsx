"use client";

import { useEffect, useState } from "react";

const REPO_URL = "https://github.com/shauryapariharxr/klyp";
const REPO_API = "https://api.github.com/repos/shauryapariharxr/klyp";

/** 1_200 -> "1.2k", 13_000 -> "13k" — keeps the chip short next to the mark. */
function compactStars(count: number) {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}k`;
}

/**
 * Navbar chip linking to the public source, in the shape GitHub badges use:
 * mark, star count, star. The count is fetched client-side so a rate-limited,
 * private or offline repo just hides the number instead of breaking the header —
 * the mark and star stay put, so the button still reads as "source code".
 */
export default function GitHubButton() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(REPO_API, { signal: controller.signal, headers: { Accept: "application/vnd.github+json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { stargazers_count?: number } | null) => {
        if (data && typeof data.stargazers_count === "number") setStars(data.stargazers_count);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="Source code on GitHub"
      title="Source code on GitHub"
      className="glass flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 fill-current">
        <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
      </svg>
      {stars !== null && stars > 0 && <span className="font-semibold tabular-nums">{compactStars(stars)}</span>}
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 fill-current">
        <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
      </svg>
    </a>
  );
}
