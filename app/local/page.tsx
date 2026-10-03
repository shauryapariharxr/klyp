"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/format";
import { localEngine, type LocalEngineState } from "@/lib/local-engine";

/**
 * klyp Local — same-Wi-Fi peer-to-peer transfers. Presence and the WebRTC
 * handshake go through the /api/local/* signaling endpoints; file bytes flow
 * directly between the two browsers over a DataChannel and never touch the
 * server. See lib/local-engine.ts.
 */

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
  const adjective = ["Blue", "Swift", "Quiet", "Amber", "Nova"][Math.floor(Math.random() * 5)];
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

  const onFilePicked = useCallback(
    (list: FileList | null) => {
      const peerId = sendTargetRef.current;
      const file = list?.[0];
      if (!peerId || !file) return;
      sendTargetRef.current = null;
      localEngine
        .sendTo(peerId, file)
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : "Could not start the transfer."),
        );
    },
    [],
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
            <label htmlFor="device-name" className="text-sm font-medium">
              Name this device
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="device-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                placeholder={suggestedName()}
                className="glass w-full rounded-2xl border-white/20 bg-white/[0.06] px-4 py-3 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 hover:border-white/40 focus:border-white/40 focus:bg-white/10"
              />
              <button
                type="button"
                onClick={() => void handleJoin()}
                disabled={joining}
                className="h-12 shrink-0 rounded-2xl bg-white px-5 text-sm font-semibold text-slate-950 shadow-[0_0_28px_rgba(165,180,252,0.35)] transition-shadow hover:shadow-[0_0_40px_rgba(165,180,252,0.55)] disabled:opacity-50"
              >
                {joining ? "Joining…" : "Join"}
              </button>
            </div>

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

        <div className="glass-strong-tinted mt-10 rounded-3xl p-6 sm:p-8">
          {state.peers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/20 p-8 text-center">
              <div className="text-3xl">📡</div>
              <p className="mt-3 text-sm font-medium">Listening for nearby devices…</p>
              <p className="mt-1 text-xs text-slate-500">
                Open klyp Local on another device connected to the same Wi-Fi.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {state.peers.map((peer) => (
                <li key={peer.id} className="glass flex items-center justify-between rounded-xl px-4 py-3">
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

          {progress && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="min-w-0 truncate">
                  {progress.direction === "send" ? "Sending" : "Receiving"} “{progress.fileName}”
                </span>
                <span className="ml-2 shrink-0 tabular-nums">
                  {progress.fileSize > 0 ? Math.round((progress.sentBytes / progress.fileSize) * 100) : 0}%
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-300 via-indigo-300 to-cyan-300 shadow-[0_0_16px_rgba(165,180,252,0.6)] transition-all"
                  style={{
                    width: `${
                      progress.fileSize > 0 ? Math.round((progress.sentBytes / progress.fileSize) * 100) : 0
                    }%`,
                  }}
                />
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">
                {formatBytes(progress.sentBytes)} of {formatBytes(progress.fileSize)}
              </p>
            </div>
          )}

          {state.lastEvent && !progress && (
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
          <div className="glass-strong-tinted w-full max-w-sm rounded-3xl p-6 text-center">
            <div className="text-3xl">📥</div>
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
