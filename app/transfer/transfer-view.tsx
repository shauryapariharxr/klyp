"use client";

import { useState } from "react";
import Link from "next/link";
import { formatBytes } from "@/lib/format";
import CopyButton from "@/app/components/CopyButton";
import Countdown from "@/app/components/Countdown";
import type { TransferView } from "@/lib/transfers";

type Props = {
  view: TransferView;
};

export default function TransferViewClient({ view }: Props) {
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleDownload(fileId: string, fileName: string) {
    setDownloadError(null);
    try {
      const url = new URL(window.location.origin);
      url.pathname = `/api/file/${fileId}`;
      url.searchParams.set("transferId", view.id);
      url.searchParams.set("token", tokenFromUrl());
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error("Download link could not be created.");
      const data = (await res.json()) as { downloadUrl: string };
      const a = document.createElement("a");
      a.href = data.downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Download failed. Refresh and try again.",
      );
    }
  }

  function tokenFromUrl(): string {
    return new URLSearchParams(window.location.search).get("token") ?? "";
  }

  const hasFiles = view.files.length > 0;
  const hasText = Boolean(view.textContent);

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-12">
      <div className="glass-strong w-full max-w-xl rounded-3xl p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-display text-2xl font-bold tracking-tight">Transfer received</h1>
          <div className="glass shrink-0 rounded-full px-4 py-1.5 text-sm text-slate-300">
            Expires in <Countdown expiresAt={view.expiresAt} />
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Save what you need — this transfer is deleted after the countdown ends.
        </p>

        {hasText && (
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-400">Text</h2>
              <CopyButton value={view.textContent ?? ""} label="Copy text" />
            </div>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-100">
              {view.textContent}
            </pre>
            <div className="mt-2 text-right">
              <span className="text-xs text-slate-500">
                {view.textContent?.length ?? 0} characters
              </span>
            </div>
          </section>
        )}

        {hasFiles && (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-slate-400">
              Files ({view.files.length})
            </h2>
            <ul className="mt-2 space-y-2">
              {view.files.map((file) => (
                <li
                  key={file.id}
                  className="glass flex items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{file.fileName}</p>
                    <p className="text-xs text-slate-500">
                      {formatBytes(file.fileSize)} · {file.mimeType}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(file.id, file.fileName)}
                    className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-950 shadow-[0_0_16px_rgba(165,180,252,0.3)] transition-shadow hover:shadow-[0_0_26px_rgba(165,180,252,0.5)]"
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
            {downloadError && (
              <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {downloadError}
              </p>
            )}
          </section>
        )}

        {!hasFiles && !hasText && (
          <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
            This transfer has no content.
          </p>
        )}

        <Link
          href="/"
          className="glass mt-10 inline-flex h-11 items-center justify-center rounded-full px-6 text-sm font-medium text-slate-200 transition-colors hover:bg-white/10"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
