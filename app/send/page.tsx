"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import CopyButton from "@/app/components/CopyButton";

const MAX_FILES = 10;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_LENGTH = 10_000;

type SendFile = { file: File; id: string };

type CreateResult = {
  transferId: string;
  accessToken: string;
  pin: string;
  expiresAt: string;
};

type UploadPlanItem = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  uploadUrl: string;
};

export default function SendPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<SendFile[]>([]);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"form" | "uploading" | "done">("form");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<CreateResult | null>(null);

  const totalSize = useMemo(() => items.reduce((sum, i) => sum + i.file.size, 0), [items]);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    setError(null);
    setItems((current) => {
      const seen = new Set(current.map((i) => i.id));
      const next = [...current];
      for (const file of Array.from(list)) {
        const id = `${file.name}:${file.size}:${file.lastModified}`;
        if (seen.has(id)) continue;
        seen.add(id);
        next.push({ file, id });
      }
      return next.slice(0, MAX_FILES);
    });
  }, []);

  function validateSelection(): string | null {
    if (items.length > MAX_FILES) return `You can attach up to ${MAX_FILES} files.`;
    for (const item of items) {
      if (item.file.size > MAX_FILE_BYTES) {
        return `"${item.file.name}" is larger than 50 MB.`;
      }
    }
    if (totalSize > MAX_TOTAL_BYTES) return "Total size exceeds 100 MB.";
    return null;
  }

  async function uploadFileToStorage(
    uploadUrl: string,
    file: File,
    contentType: string,
    onProgress: (pct: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(file);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const selectionError = validateSelection();
    if (selectionError) {
      setError(selectionError);
      return;
    }
    if (items.length === 0 && text.trim().length === 0) {
      setError("Add at least one file or enter some text.");
      return;
    }

    const filesPending = items.length > 0;
    setStage("uploading");
    setProgress(0);

    try {
      // 1. Create the transfer server-side and get a PIN.
      const createRes = await fetch("/api/transfer/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() ? text : undefined, hasFiles: filesPending }),
      });
      if (!createRes.ok) {
        const data = (await createRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not create the transfer.");
      }
      const created: CreateResult = await createRes.json();

      // 2. Upload files directly to object storage with progress feedback.
      if (filesPending) {
        const planRes = await fetch(`/api/transfer/${created.transferId}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accessToken: created.accessToken,
            files: items.map((i) => ({
              fileName: i.file.name,
              fileSize: i.file.size,
              mimeType: i.file.type || "application/octet-stream",
            })),
          }),
        });
        if (!planRes.ok) {
          const data = (await planRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Could not prepare the upload.");
        }
        const plan = (await planRes.json()) as { uploadUrls: UploadPlanItem[] };

        let completedBytes = 0;
        const uploaded: { fileName: string; fileSize: number; mimeType: string; storageKey: string }[] = [];
        const grandTotal = Math.max(totalSize, 1);

        for (const [index, planItem] of plan.uploadUrls.entries()) {
          const item = items[index];
          await uploadFileToStorage(planItem.uploadUrl, item.file, planItem.mimeType, (pct) => {
            const fileBytes = (item.file.size * pct) / 100;
            setProgress(Math.round(((completedBytes + fileBytes) / grandTotal) * 100));
          });
          completedBytes += item.file.size;
          uploaded.push({
            fileName: planItem.fileName,
            fileSize: planItem.fileSize,
            mimeType: planItem.mimeType,
            storageKey: planItem.storageKey,
          });
        }

        // 3. Confirm all uploads landed; marks the transfer ready.
        const completeRes = await fetch(`/api/transfer/${created.transferId}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: created.accessToken, uploaded }),
        });
        if (!completeRes.ok) {
          const data = (await completeRes.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "Could not finalize the transfer.");
        }
      }

      setProgress(100);
      setResult(created);
      setStage("done");
    } catch (err) {
      setStage("form");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  function reset() {
    setItems([]);
    setText("");
    setError(null);
    setStage("form");
    setProgress(0);
    setResult(null);
  }

  if (stage === "done" && result) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Share this PIN with the receiver</p>
          <div className="mt-3 flex items-center justify-center gap-4">
            <div
              className="rounded-2xl border border-zinc-300 bg-white px-8 py-4 font-mono text-5xl font-bold tracking-[0.3em] dark:border-zinc-700 dark:bg-zinc-900"
              aria-label={`Your PIN is ${result.pin}`}
            >
              {result.pin}
            </div>
            <CopyButton value={result.pin} label="Copy PIN" />
          </div>
          <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">
            Expires in 30 minutes. The receiver enters this PIN at{" "}
            <span className="font-mono">/receive</span>.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="flex h-11 items-center justify-center rounded-full bg-zinc-900 px-6 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Send another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 py-12">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">Send files or text</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Files upload directly to encrypted storage. You&apos;ll get a 4-digit PIN to share.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
              dragOver
                ? "border-zinc-500 bg-zinc-100 dark:bg-zinc-900"
                : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
            }`}
          >
            <div className="text-3xl">📁</div>
            <p className="mt-3 text-sm font-medium">Drag & drop files here, or click to browse</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Up to {MAX_FILES} files · 50 MB each · 100 MB total
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <span className="min-w-0 truncate">
                    {item.file.name}{" "}
                    <span className="text-zinc-500">({formatBytes(item.file.size)})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setItems((current) => current.filter((i) => i.id !== item.id))}
                    className="ml-4 shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    aria-label={`Remove ${item.file.name}`}
                  >
                    ✕
                  </button>
                </li>
          ))}
            </ul>
          )}

          <div>
            <label htmlFor="text" className="text-sm font-medium">
              Or paste text <span className="text-zinc-400">(optional)</span>
            </label>
            <textarea
              id="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_TEXT_LENGTH}
              rows={4}
              placeholder="Type or paste a message, code snippet, link…"
              className="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-400"
            />
          </div>

          {error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </p>
          )}

          {stage === "uploading" ? (
            <div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                <div
                  className="h-full rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-2 text-center text-xs text-zinc-500">Uploading… {progress}%</p>
            </div>
          ) : (
            <button
              type="submit"
              className="flex h-12 w-full items-center justify-center rounded-full bg-zinc-900 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Generate PIN
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
