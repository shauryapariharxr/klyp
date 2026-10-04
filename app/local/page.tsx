"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { localEngine, type LocalEngineState, type TransferProgress } from "@/lib/local-engine";
import { LOCAL_DEVICE_NAME_MAX } from "@/lib/limits";

/**
 * klyp Local — same-Wi-Fi peer-to-peer transfers. Presence and the WebRTC
 * handshake go through the /api/local/* signaling endpoints; file bytes flow
 * directly between the two browsers over a DataChannel and never touch the
 * server. See lib/local-engine.ts.
 */

/** Average throughput over the elapsed time on the fly. */
function formatRate(bytes: number, ms: number): string {
  if (ms <= 0 || bytes <= 0) return "";
  const perSecond = (bytes / ms) * 1000;
  if (perSecond < 1024) return `${Math.round(perSecond)} B/s`;
  if (perSecond < 1024 * 1024) return `${(perSecond / 1024).toFixed(1)} KB/s`;
  return `${(perSecond / (1024 * 1024)).toFixed(1)} MB/s`;
}

/**
 * Coarse time-to-finish. Only offered once enough bytes have moved for the
 * estimate to mean anything — a wildly wrong ETA is worse than none. */
function formatEta(progress: TransferProgress): string | null {
  const elapsed = Date.now() - progress.startedAt;
  if (elapsed < 500 || progress.sentBytes <= 0) return null;
  const msLeft = (progress.fileSize - progress.sentBytes) / (progress.sentBytes / elapsed);
  if (msLeft <= 0) return null;
  if (msLeft < 60_000) return `${Math.max(1, Math.round(msLeft / 1000))}s left`;
  return `${Math.round(msLeft / 60_000)} min left`;
}

/** Best-effort device name suggestion from the user agent. */
function suggestedName(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iPhone"
      : /Mac/i.test(ua)
        ? "Mac"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Device";
  const adjective = ["Blue", "Swift", "Quiet", "Amber", "Nova", "Calm", "Bright"][
    Math.floor(Math.random() * 7)
  ];
  return `${adjective} ${os}`.slice(0, 24);
}

export default function LocalPage() {
  const [state, setState] = useState<LocalEngineState | null>(null);
  const stateRef = useRef<LocalEngineState | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendTargetRef = useRef<string | null>(null);
  /** A file is being dragged over the card (desktop drag-and-drop send). */
  const [dragOver, setDragOver] = useState(false);
  /** Peer row currently hovered with a dragged file. */
  const [dropPeerId, setDropPeerId] = useState<string | null>(null);
  /** Ticking clock so transfer rate/ETA stay live between chunk events. */
  const [now, setNow] = useState(0);
  const dragDepth = useRef(0);
  const [suggestions] = useState<string[]>(() => {
    const out: string[] = [];
    for (let i = 0; i < 8 && out.length < 3; i++) {
      const s = suggestedName();
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  });
  const suggested = suggestions[0] ?? "";

  useEffect(() => {
    const unsubscribe = localEngine.subscribe((next) => {
      stateRef.current = next;
      setState(next);
    });
    // Try to silently resume a previous session (e.g. after reload).
    void localEngine.resume();
    // Debug/test hook: drive a transfer without the native file picker.
    const globalWindow = window as unknown as {
      __klypLocal?: {
        state: () => LocalEngineState | null;
        engine: typeof localEngine;
        sendToPeerName: (peerName: string, file: File) => Promise<void>;
        lastFileUrl: string | null;
      };
    };
    globalWindow.__klypLocal = {
      state: () => stateRef.current,
      engine: localEngine,
      sendToPeerName: (peerName, file) => {
        const peer = stateRef.current?.peers.find((p) => p.name === peerName);
        if (!peer) return Promise.reject(new Error(`No nearby device named “${peerName}”.`));
        return localEngine.sendTo(peer.id, file);
      },
      lastFileUrl: null,
    };
    return () => {
      unsubscribe();
    };
  }, []);

  // Rate and ETA need a clock tick between chunk events to stay honest. The
  // first tick lands 500ms in; until then the rate reads as an em dash.
  const hasProgress = state?.progress != null;
  useEffect(() => {
    if (!hasProgress) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [hasProgress]);

  const handleJoin = useCallback(async () => {
    setError(null);
    setJoining(true);
    try {
      await localEngine.join(name || suggestedName());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join.");
    } finally {
      setJoining(false);
    }
  }, [name]);

  const openPickerFor = useCallback((peerId: string) => {
    sendTargetRef.current = peerId;
    fileInputRef.current?.click();
  }, []);

  const sendFile = useCallback((peerId: string, file: File) => {
    void localEngine.sendTo(peerId, file).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Could not start the transfer."),
    );
  }, []);

  const onFilePicked = useCallback(
    (list: FileList | null) => {
      const peerId = sendTargetRef.current;
      const file = list?.[0];
      if (!peerId || !file) return;
      sendTargetRef.current = null;
      sendFile(peerId, file);
    },
    [sendFile],
  );

  if (state === null) return null;

  if (state.status === "offline" || state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          <h1 className="font-display text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
            klyp Local.
            <br />
            <span className="accent-text">Same Wi-Fi, zero cloud.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-sm text-center text-sm text-slate-400">
            Devices on the same Wi-Fi see each other here. Pick one, choose a file, and it travels
            straight between the two devices — nothing is uploaded anywhere.
          </p>

          <div className="glass-strong-tinted mt-10 rounded-3xl p-6 sm:p-8">
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="device-name"
                className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300"
              >
                Name this device
              </label>
              <span className="text-xs tabular-nums text-slate-500">
                {name.length}/{LOCAL_DEVICE_NAME_MAX}
              </span>
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              Nearby devices will see this name. You can change it anytime.
            </p>

            <input
              id="device-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !joining) void handleJoin();
              }}
              maxLength={LOCAL_DEVICE_NAME_MAX}
              placeholder={suggested}
              className="mt-4 w-full rounded-2xl border border-white/15 bg-white/[0.06] px-4 py-3.5 text-base text-slate-100 outline-none transition-colors placeholder:text-slate-500 hover:border-white/30 focus:border-cyan-300/60 focus:bg-white/10 focus:shadow-[0_0_28px_rgba(103,232,249,0.15)]"
            />

            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setName(s)}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-200"
                >
                  {s}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void handleJoin()}
              disabled={joining}
              className="mt-6 flex h-12 w-full items-center justify-center rounded-full bg-white text-sm font-semibold text-slate-950 shadow-[0_0_28px_rgba(165,180,252,0.35)] transition-shadow hover:shadow-[0_0_40px_rgba(165,180,252,0.55)] disabled:opacity-50"
            >
              {joining ? "Joining…" : "Join the room"}
            </button>

            {error && (
              <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error}
              </p>
            )}

            <p className="mt-6 text-center text-xs text-slate-500">
              Open this page on every device that shares your Wi-Fi.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const incoming = state.incomingRequest;
  const progress = state.progress;
  const pct =
    progress && progress.fileSize > 0
      ? Math.min(100, Math.round((progress.sentBytes / progress.fileSize) * 100))
      : 0;
  const eta = progress ? formatEta(progress) : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <h1 className="font-display text-center text-3xl font-extrabold tracking-tight sm:text-4xl">
          Nearby devices.
          <br />
          <span className="accent-text">Tap one to send.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-center text-sm text-slate-400">
          You are visible as{" "}
          <span className="font-medium text-slate-200">{state.selfName}</span>. Transfers go
          device-to-device over your Wi-Fi and never touch the cloud.
        </p>

        <div
          className={`glass-strong-tinted mt-10 rounded-3xl p-6 transition-shadow sm:p-8 ${
            dragOver && state.peers.length > 0
              ? "shadow-[0_0_48px_rgba(103,232,249,0.28)] ring-1 ring-cyan-300/60"
              : ""
          }`}
          onDragEnter={() => {
            dragDepth.current += 1;
            setDragOver(true);
          }}
          onDragLeave={() => {
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (dragDepth.current === 0) setDragOver(false);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragOver(false);
            setDropPeerId(null);
            const file = e.dataTransfer?.files?.[0];
            if (!file) return;
            const peer = state.peers.length === 1 ? state.peers[0] : null;
            if (peer) sendFile(peer.id, file);
            else if (state.peers.length > 1)
              setError("Drop the file onto a device to send it.");
          }}
        >
          <div className="mb-4 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Devices nearby
            </span>
            <button
              type="button"
              onClick={() => void localEngine.refresh()}
              disabled={state.refreshing}
              className="flex h-8 items-center gap-1.5 rounded-full border border-white/15 px-3 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className={`h-3.5 w-3.5 ${state.refreshing ? "animate-spin" : ""}`}
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M8 16H3v5" />
              </svg>
              {state.refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {state.peers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/20 px-6 py-10 text-center">
              <div className="relative mx-auto h-24 w-24" aria-hidden>
                <div className="radar-ring" />
                <div className="radar-ring" style={{ animationDelay: "-0.93s" }} />
                <div className="radar-ring" style={{ animationDelay: "-1.87s" }} />
                <div className="radar-sweep" />
                <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.9)]" />
              </div>
              <p className="mt-5 text-sm font-semibold">Searching for nearby devices…</p>
              <p className="mt-1 text-xs text-slate-500">
                Open klyp Local on another device connected to the same Wi-Fi.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {state.peers.map((peer) => (
                <li
                  key={peer.id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropPeerId(peer.id);
                  }}
                  onDragLeave={() => setDropPeerId((cur) => (cur === peer.id ? null : cur))}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dragDepth.current = 0;
                    setDragOver(false);
                    setDropPeerId(null);
                    const file = e.dataTransfer?.files?.[0];
                    if (file) sendFile(peer.id, file);
                  }}
                  className={`glass flex items-center justify-between rounded-xl px-4 py-3 transition-all ${
                    dropPeerId === peer.id
                      ? "border border-cyan-300/70 bg-cyan-300/10 shadow-[0_0_36px_rgba(103,232,249,0.25)]"
                      : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    </span>
                    <span className="min-w-0 truncate text-sm">{peer.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => openPickerFor(peer.id)}
                    disabled={progress !== null}
                    className="ml-4 shrink-0 rounded-full bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-slate-100 transition-colors hover:bg-white/20 disabled:opacity-40"
                  >
                    Send
                  </button>
                </li>
              ))}
            </ul>
          )}

          {dragOver && state.peers.length > 0 && (
            <p className="mt-3 text-center text-xs text-cyan-300">
              {state.peers.length === 1
                ? `Release to send to ${state.peers[0].name}.`
                : "Release on a device to send the file."}
            </p>
          )}

          {progress && (
            <div className="rise-in mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 text-slate-400">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className={`h-3.5 w-3.5 shrink-0 ${
                      progress.direction === "send" ? "text-violet-300" : "text-cyan-300"
                    }`}
                  >
                    {progress.direction === "send" ? (
                      <path d="M12 19V5m0 0-6 6m6-6 6 6" />
                    ) : (
                      <path d="M12 5v14m0 0 6-6m-6 6-6-6" />
                    )}
                  </svg>
                  <span className="truncate">
                    {progress.direction === "send" ? "Sending to" : "Receiving from"}{" "}
                    <span className="font-medium text-slate-200">{progress.peerName ?? "device"}</span>
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-cyan-300">
                  {pct}%
                </span>
              </div>
              <p className="mt-1.5 truncate text-xs text-slate-500">“{progress.fileName}”</p>

              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="shimmer-bar relative h-full overflow-hidden rounded-full bg-gradient-to-r from-violet-400 via-indigo-400 to-cyan-300 shadow-[0_0_16px_rgba(165,180,252,0.55)] transition-[width] duration-200 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>

              <div className="mt-2 flex items-center justify-between text-[11px] tabular-nums text-slate-500">
                <span>
                  {formatBytes(progress.sentBytes)} of {formatBytes(progress.fileSize)}
                </span>
                <span>
                  {progress.sentBytes > 0 && now > progress.startedAt
                    ? formatRate(progress.sentBytes, now - progress.startedAt)
                    : "—"}
                  {eta ? ` · ${eta}` : ""}
                </span>
              </div>
            </div>
          )}

          {state.receipt && !progress && (
            <div className="rise-in mt-5 flex items-center justify-between gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] px-4 py-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="check-pop flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400/15">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className="h-4 w-4 text-emerald-300"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-100">
                    {state.receipt.direction === "send" ? "Sent" : "Received"} “
                    {state.receipt.fileName}”
                  </span>
                  <span className="block text-xs text-slate-500">
                    {formatBytes(state.receipt.fileSize)}
                    {state.receipt.peerName
                      ? ` · ${
                          state.receipt.direction === "send"
                            ? `to ${state.receipt.peerName}`
                            : `from ${state.receipt.peerName}`
                        }`
                      : ""}
                  </span>
                </span>
              </span>
              <button
                type="button"
                onClick={() => localEngine.dismissReceipt()}
                aria-label="Dismiss"
                className="shrink-0 rounded-full p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className="h-3.5 w-3.5"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          )}

          {state.lastEvent && !progress && !state.receipt && (
            <p className="mt-5 text-center text-xs text-slate-400">{state.lastEvent}</p>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => localEngine.leave()}
            className="mt-6 flex h-11 w-full items-center justify-center rounded-full border border-white/15 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            Leave the room
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          Both devices must be on the same Wi-Fi. Some office or school networks block
          device-to-device connections.
        </p>
      </div>

      {/* Hidden picker: clicking a peer's Send button routes the chosen file to it. */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          onFilePicked(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Incoming request prompt. */}
      {incoming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="glass-strong-tinted rise-in w-full max-w-sm rounded-3xl p-6 text-center">
            <span
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-cyan-300/10"
              aria-hidden
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-5 w-5 text-cyan-300"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="m7 10 5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
            </span>
            <p className="mt-3 text-sm font-semibold">
              {incoming.peerName} wants to send you
            </p>
            <p className="mt-1 truncate text-sm text-slate-300">
              “{incoming.meta.fileName}”{" "}
              <span className="text-slate-500">({formatBytes(incoming.meta.fileSize)})</span>
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={incoming.decline}
                className="h-11 rounded-full border border-white/15 text-sm font-medium text-slate-300 transition-colors hover:bg-white/10"
              >
                Decline
              </button>
              <button
                type="button"
                onClick={incoming.accept}
                className="h-11 rounded-full bg-white text-sm font-semibold text-slate-950 shadow-[0_0_28px_rgba(165,180,252,0.35)] transition-shadow hover:shadow-[0_0_40px_rgba(165,180,252,0.55)]"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
