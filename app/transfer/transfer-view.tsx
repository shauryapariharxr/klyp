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
      <div className="w-full max-w-xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Transfer received</h1>
          <div className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">
            Expires in <Countdown expiresAt={view.expiresAt} />
          </div>
        </div>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Save what you need — this transfer is deleted after the countdown ends.
        </p>

        {hasText && (
          <section className="mt-8">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Text</h2>
              <CopyButton value={view.textContent ?? ""} label="Copy text" />
            </div>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              {view.textContent}
            </pre>
            <div className="mt-2 text-right">
              <span className="text-xs text-zinc-400">
                {view.textContent?.length ?? 0} characters
              </span>
            </div>
          </section>
        )}

        {hasFiles && (
          <section className="mt-8">
            <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              Files ({view.files.length})
            </h2>
            <ul className="mt-2 space-y-2">
              {view.files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{file.fileName}</p>
                    <p className="text-xs text-zinc-500">
                      {formatBytes(file.fileSize)} · {file.mimeType}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDownload(file.id, file.fileName)}
                    className="shrink-0 rounded-full bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
            {downloadError && (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
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
          className="mt-10 inline-flex h-11 items-center justify-center rounded-full border border-zinc-300 px-6 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
