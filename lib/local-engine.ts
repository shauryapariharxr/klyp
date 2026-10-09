"use client";

/**
 * Client-side engine for klyp Local: WebRTC peer-to-peer file transfer with a
 * database-backed signaling poller (see app/api/local/*). Presence, offers,
 * answers and accept/decline decisions flow through the signaling endpoints;
 * the file bytes themselves travel only between the two browsers over an
 * RTCDataChannel, chunked and flow-controlled — they never touch the server
 * or object storage.
 */

import { LOCAL_DEVICE_NAME_MAX, LOCAL_SYNC_INTERVAL_MS } from "@/lib/limits";

export type LocalPeer = { id: string; name: string; lastSeenAt: string };

export type LocalFileMeta = {
  fileId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

export type IncomingRequest = {
  peerId: string;
  peerName: string;
  files: LocalFileMeta[];
  accept: () => void;
  decline: () => void;
};

export type TransferProgress = {
  fileName: string;
  fileSize: number;
  sentBytes: number;
  direction: "send" | "receive";
  /** Wall-clock start, used to show a live rate instead of a frozen bar. */
  startedAt: number;
  /** Display name of the other end, when known. */
  peerName: string | null;
  /** Owning peer — lets the UI cancel exactly this transfer. */
  peerId: string | null;
  /** 1-based position when several files travel in one transfer. */
  fileIndex?: number;
  fileCount?: number;
};

/** Shown briefly after a transfer finishes, so the UI never dead-ends at 100%. */
export type TransferReceipt = {
  fileName: string;
  fileSize: number;
  direction: "send" | "receive";
  peerName: string | null;
};

export type LocalEngineState = {
  status: "offline" | "joining" | "online" | "rejoining" | "error";
  selfId: string | null;
  selfName: string | null;
  peers: LocalPeer[];
  incomingRequest: IncomingRequest | null;
  /** One entry per in-flight transfer (several can run at once after a fan-out). */
  progresses: TransferProgress[];
  /** Peers with a send awaiting acceptance or mid-transfer, for UI highlighting. */
  activeSendPeers: string[];
  receipt: TransferReceipt | null;
  refreshing: boolean;
  lastEvent: string | null;
};

type SignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit; meta: LocalFileMeta[]; senderName: string }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "accept" }
  | { kind: "decline" }
  | { kind: "busy" };

/**
 * Throughput tuning. 64KB is the safe cross-browser SCTP message ceiling —
 * the effective chunk shrinks to channel.maxMessageSize when a browser
 * reports something smaller. The watermarks keep the wire full without
 * overflowing the sender's buffer.
 */
const CHUNK_SIZE = 64 * 1024;
const BUFFER_HIGH = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;
/** Progress repaints at most this often — chunk events are far too frequent to render one-by-one. */
const PROGRESS_PAINT_MS = 80;
/** Short guard after the done frame so in-flight messages settle before close. */
const POST_DONE_GUARD_MS = 100;
/** How long a finished-transfer receipt stays on screen. */
const RECEIPT_VISIBLE_MS = 6000;

function randomId(): string {
  return crypto.randomUUID();
}

export class LocalTransferEngine {
  private deviceId: string | null = null;
  private deviceToken: string | null = null;
  private selfName: string | null = null;
  private status: LocalEngineState["status"] = "offline";
  private peers: LocalPeer[] = [];
  private afterSeq = 0;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private leaveBeaconWired = false;

  // One pending send per target peer; receiving is independent of sending.
  private pendingByPeer = new Map<
    string,
    { files: File[]; metas: LocalFileMeta[]; pc: RTCPeerConnection; channel: RTCDataChannel }
  >();
  private connections = new Map<string, RTCPeerConnection>();
  private incomingFiles = new Map<
    string,
    {
      files: LocalFileMeta[];
      index: number;
      chunks: ArrayBuffer[];
      received: number;
      startedAt: number;
      paintedAt: number;
    }
  >();
  /** Peers with a send in flight (offer through completion). */
  private sendingPeers = new Set<string>();
  /** Give up on a peer that never answers the offer (closed tab, Wi-Fi drop). */
  private offerTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private iceQueueByPeer = new Map<string, RTCIceCandidateInit[]>();

  /** Live per-peer transfer cards (send and receive), keyed by peer id. */
  private progressByPeer = new Map<string, TransferProgress>();
  /** Resolvers so batched sends can wait until a peer's transfer finishes. */
  private completionByPeer = new Map<string, () => void>();
  /** Peers whose in-flight send the user asked to cancel. */
  private canceledPeers = new Set<string>();

  private listeners = new Set<(state: LocalEngineState) => void>();
  private state: LocalEngineState = {
    status: "offline",
    selfId: null,
    selfName: null,
    peers: [],
    incomingRequest: null,
    progresses: [],
    activeSendPeers: [],
    receipt: null,
    refreshing: false,
    lastEvent: null,
  };
  private receiptTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(listener: (state: LocalEngineState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<LocalEngineState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private event(message: string): void {
    this.setState({ lastEvent: message });
  }

/**
 * Show a finished-transfer receipt for a few seconds. Without this the UI
 * snapped from a full progress bar straight back to a small grey text line,
 * which is what read as a glitch after sending a document. The receipt is a
 * deliberate end state instead of an abrupt teardown.
 */
  private showReceipt(receipt: TransferReceipt): void {
    if (this.receiptTimer) clearTimeout(this.receiptTimer);
    // Drop the card for the peer whose transfer just finished.
    const finishedPeerId = receipt.peerName
      ? [...this.progressByPeer.entries()].find(
          ([, p]) => p.peerName === receipt.peerName,
        )?.[0] ?? null
      : null;
    if (finishedPeerId) this.setPeerProgress(finishedPeerId, null);
    this.dropActiveFinished();
    this.setState({ receipt });
    this.receiptTimer = setTimeout(() => {
      this.receiptTimer = null;
      this.setState({ receipt: null });
    }, RECEIPT_VISIBLE_MS);
  }

  /** After a transfer settles, only that peer's card should go away. */
  private dropActiveFinished(): void {
    const gone = [...this.progressByPeer.keys()].filter(
      (id) =>
        !this.sendingPeers.has(id) &&
        !this.incomingFiles.has(id) &&
        !this.state?.incomingRequest,
    );
    for (const id of gone) this.setPeerProgress(id, null);
  }

  /** Clear a finished-transfer receipt early (user dismissed it). */
  dismissReceipt(): void {
    if (this.receiptTimer) {
      clearTimeout(this.receiptTimer);
      this.receiptTimer = null;
    }
    this.setState({ receipt: null });
  }

  /** Keep progressByPeer and the broadcast list in sync, then push. */
  private setPeerProgress(peerId: string | null, next?: TransferProgress | null): void {
    if (peerId === null) return;
    if (!next || next.peerId === null) this.progressByPeer.delete(peerId);
    else this.progressByPeer.set(peerId, next);
    this.setState({ progresses: [...this.progressByPeer.values()] });
  }

  /** Peers with an offer pending or bytes in flight — the UI highlights these. */
  private broadcastActiveSends(): void {
    this.setState({ activeSendPeers: [...this.sendingPeers] });
  }

  /** Manual presence refresh, for the button next to the device list. */
  async refresh(): Promise<void> {
    if (!this.deviceId) return;
    this.setState({ refreshing: true });
    try {
      await this.syncOnce();
    } finally {
      this.setState({ refreshing: false });
    }
  }

  // --- Room membership -----------------------------------------------------

  async join(name: string): Promise<void> {
    const trimmed = name.trim().slice(0, LOCAL_DEVICE_NAME_MAX);
    if (!trimmed) throw new Error("Enter a device name first.");

    this.setState({ status: "joining" });
    try {
      const res = await fetch("/api/local/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Could not join the room.");
      }
      const creds = (await res.json()) as { deviceId: string; deviceToken: string };
      this.deviceId = creds.deviceId;
      this.deviceToken = creds.deviceToken;
      this.selfName = trimmed;
      sessionStorage.setItem("klyp-local-creds", JSON.stringify(creds));
      sessionStorage.setItem("klyp-local-name", trimmed);

      this.setState({ status: "online", selfId: creds.deviceId, selfName: trimmed });
      this.wireLeaveBeacon();
      this.startSync();
      this.event(`You joined as “${trimmed}”.`);
    } catch (err) {
      this.setState({ status: "error" });
      throw err;
    }
  }

  /** Restore a session after a page reload instead of orphaning the old row. */
  async resume(): Promise<boolean> {
    const raw = sessionStorage.getItem("klyp-local-creds");
    const name = sessionStorage.getItem("klyp-local-name");
    if (!raw || !name) return false;

    try {
      const creds = JSON.parse(raw) as { deviceId: string; deviceToken: string };
      this.deviceId = creds.deviceId;
      this.deviceToken = creds.deviceToken;
      this.selfName = name;

      const ok = await this.syncOnce();
      if (ok) {
        this.setState({ status: "online", selfId: creds.deviceId, selfName: name });
        this.wireLeaveBeacon();
        this.startSync();
        this.event(`You are visible as “${name}”.`);
      } else {
        this.setState({ status: "error" });
      }
      return ok;
    } catch {
      sessionStorage.removeItem("klyp-local-creds");
      sessionStorage.removeItem("klyp-local-name");
      this.setState({ status: "error" });
      return false;
    }
  }

  leave(): void {
    this.stopSync();
    if (this.deviceId && this.deviceToken) {
      void fetch("/api/local/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: this.deviceId, deviceToken: this.deviceToken }),
        keepalive: true,
      }).catch(() => {});
    }
    for (const [peerId, pc] of this.connections) {
      pc.close();
      this.connections.delete(peerId);
    }
    this.pendingByPeer.clear();
    this.incomingFiles.clear();
    this.iceQueueByPeer.clear();
    sessionStorage.removeItem("klyp-local-creds");
    sessionStorage.removeItem("klyp-local-name");
    this.deviceId = null;
    this.deviceToken = null;
    this.selfName = null;
    this.setState({
      status: "offline",
      selfId: null,
      selfName: null,
      peers: [],
      progresses: [],
      activeSendPeers: [],
      receipt: null,
      refreshing: false,
      incomingRequest: null,
    });
  }

  // --- Signaling loop ------------------------------------------------------

  private startSync(): void {
    this.stopSync();
    this.syncTimer = setInterval(() => {
      void this.syncOnce();
    }, LOCAL_SYNC_INTERVAL_MS);
    void this.syncOnce();
  }

  private stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private async syncOnce(): Promise<boolean> {
    if (!this.deviceId || !this.deviceToken) return false;
    try {
      const res = await fetch("/api/local/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: this.deviceId,
          deviceToken: this.deviceToken,
          afterSeq: this.afterSeq,
        }),
      });
      if (res.status === 404) {
        // Our device row was pruned (server restart or long sleep).
        this.setState({ status: "rejoining" });
        const raw = sessionStorage.getItem("klyp-local-name");
        if (raw) {
          await this.join(raw);
          return true;
        }
        return false;
      }
      if (!res.ok) return false;

      const data = (await res.json()) as {
        peers: LocalPeer[];
        signals: { seq: number; from: string; payload: SignalPayload }[];
        cursor: number;
      };

      this.peers = data.peers;
      this.afterSeq = data.cursor;
      this.setState({ peers: data.peers });

      for (const signal of data.signals) {
        void this.handleSignal(signal.from, signal.payload);
      }
      return true;
    } catch {
      return false;
    }
  }

  // --- Signal handling -----------------------------------------------------

  private async handleSignal(from: string, payload: SignalPayload): Promise<void> {
    switch (payload.kind) {
      case "offer": {
        // A file request from a peer — show accept/decline unless we're busy.
        if (
          this.pendingByPeer.has(from) ||
          this.incomingFiles.has(from) ||
          this.sendingPeers.has(from) ||
          this.state.incomingRequest
        ) {
          await this.sendSignal(from, { kind: "busy" });
          return;
        }
        this.setState({
          incomingRequest: {
            peerId: from,
            peerName: payload.senderName,
            files: payload.meta,
            accept: () => void this.answerOffer(from, payload.sdp, payload.meta),
            decline: () => {
              // Dismiss the prompt right away — accept cleared it via
              // answerOffer but decline didn't, so Decline read as broken.
              this.setState({ incomingRequest: null });
              void this.sendSignal(from, { kind: "decline" });
            },
          },
        });
        break;
      }
      case "answer": {
        this.clearOfferTimeout(from);
        const pc = this.connections.get(from);
        if (pc) await pc.setRemoteDescription(payload.sdp);
        break;
      }
      case "decline": {
        this.cleanupPeer(from);
        this.event("Transfer declined.");
        break;
      }
      case "busy": {
        this.cleanupPeer(from);
        this.event("The other device is busy with another transfer.");
        break;
      }
    }
  }

  private async sendSignal(to: string, payload: SignalPayload): Promise<void> {
    if (!this.deviceId || !this.deviceToken) return;
    try {
      await fetch("/api/local/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: this.deviceId, deviceToken: this.deviceToken, toDeviceId: to, payload }),
      });
    } catch {
      // The next sync will surface connection issues via presence.
    }
  }

  // --- WebRTC --------------------------------------------------------------

  private newConnection(peerId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.cleanupPeer(peerId);
      }
    };
    this.connections.set(peerId, pc);
    return pc;
  }

  /** Entry point for the sender: request consent, then connect. Accepts
   *  several files — they queue and travel one by one over one connection. */
  async sendTo(peerId: string, firstFile: File, moreFiles?: File[]): Promise<void> {
    if (!this.deviceId) throw new Error("Join the room first.");
    const files = [firstFile, ...(moreFiles ?? [])];
    if (this.sendingPeers.has(peerId)) throw new Error("Already sending to this device.");
    this.sendingPeers.add(peerId);
    this.broadcastActiveSends();

    const metas = files.map((file) => ({
      fileId: randomId(),
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    }));

    const pc = this.newConnection(peerId);
    const channel = pc.createDataChannel("klyp", { ordered: true });
    this.wireSendChannel(peerId, channel, files, metas);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // No trickle-ICE signaling channel — wait (briefly) for the full candidate
    // list so one SDP exchange is enough. On a LAN this is near-instant.
    await this.waitIceGathering(pc);
    await this.sendSignal(peerId, {
      kind: "offer",
      sdp: { type: pc.localDescription!.type, sdp: pc.localDescription!.sdp },
      meta: metas,
      senderName: this.selfName ?? "A device",
    });
    this.event(
      files.length > 1
        ? `Waiting for the other device to accept ${files.length} files…`
        : `Waiting for the other device to accept “${files[0].name}”…`,
    );
    this.armOfferTimeout(peerId);
  }

  private armOfferTimeout(peerId: string): void {
    this.clearOfferTimeout(peerId);
    this.offerTimeouts.set(
      peerId,
      setTimeout(() => {
        if (this.sendingPeers.has(peerId) && !this.canceledPeers.has(peerId)) {
          this.cleanupPeer(peerId);
          this.setPeerProgress(peerId, null);
          this.event("No response from the other device.");
        }
      }, 30_000),
    );
  }

  private clearOfferTimeout(peerId: string): void {
    const timer = this.offerTimeouts.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.offerTimeouts.delete(peerId);
    }
  }

  /** Resolve once ICE gathering finishes or after a short timeout. */
  private waitIceGathering(pc: RTCPeerConnection, timeoutMs = 1500): Promise<void> {
    if (pc.iceGatheringState === "complete") return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(finish, timeoutMs);
      function finish() {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", onChange);
        resolve();
      }
      function onChange() {
        if (pc.iceGatheringState === "complete") finish();
      }
      pc.addEventListener("icegatheringstatechange", onChange);
    });
  }

  private wireSendChannel(
    peerId: string,
    channel: RTCDataChannel,
    files: File[],
    metas: LocalFileMeta[],
  ): void {
    channel.onopen = () => {
      void this.pumpFile(peerId, channel, files, metas);
    };
    channel.onerror = () => this.cleanupPeer(peerId);
  }

  private async answerOffer(from: string, sdp: RTCSessionDescriptionInit, metas: LocalFileMeta[]): Promise<void> {
    this.setState({ incomingRequest: null });
    const pc = this.newConnection(from);
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      const startedAt = Date.now();
      this.incomingFiles.set(from, { files: metas, index: 0, chunks: [], received: 0, startedAt, paintedAt: 0 });
      this.paintIncoming(from, startedAt);
      channel.onmessage = (msg) => void this.onReceiveChunk(from, channel, msg.data);
      // A clean close means the done frame already tore the transfer down and
      // this entry is gone. If the entry still exists here the channel died
      // mid-file (sender canceled, tab closed) — the bytes are truncated news,
      // so they are discarded instead of saved as if complete.
      channel.onclose = () => this.onIncomingChannelClose(from);
      channel.onerror = () => this.cleanupPeer(from);
    };

    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    // Mirror the offer side: without trickle-ICE the answer must carry the
    // answerer's candidates, or the offerer can never complete its checks.
    await this.waitIceGathering(pc);
    await this.sendSignal(from, {
      kind: "answer",
      sdp: { type: pc.localDescription!.type, sdp: pc.localDescription!.sdp },
    });
    this.event(
      metas.length > 1
        ? `Connecting to receive ${metas.length} files…`
        : `Connecting to receive “${metas[0].fileName}”…`,
    );
  }

  /**
   * Pump one peer's file queue over its open channel, in order, repainting a
   * per-peer progress card. Cancellation is cooperative: cancelSend marks the
   * peer and closes the channel, which surfaces here as "Connection lost." —
   * but a cancel must never log "Transfer failed.", so the caught error is
   * swallowed when the peer is already marked canceled.
   */
  private async pumpFile(
    peerId: string,
    channel: RTCDataChannel,
    files: File[],
    metas: LocalFileMeta[],
  ): Promise<void> {
    this.pendingByPeer.set(peerId, { files, metas, pc: this.connections.get(peerId)!, channel });
    const startedAt = Date.now();
    const totalCount = files.length;
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    // One progress card per peer covering the whole queue.
    let sentBytes = 0;

    const repaint = (bytes: number): void => {
      sentBytes = bytes;
      const idx = this.fileIndexOfOffset(files, sentBytes);
      this.setPeerProgress(peerId, {
        fileName: totalCount > 1 ? `${idx + 1}/${totalCount} · ${files[idx]?.name ?? ""}` : files[0]?.name ?? "",
        fileSize: totalBytes,
        sentBytes,
        direction: "send",
        startedAt,
        peerName: this.peerName(peerId),
        peerId,
        fileIndex: idx + 1,
        fileCount: totalCount,
      });
    };

    repaint(0);

    // Respect browsers that report a smaller SCTP message ceiling.
    const maxMessage = (channel as RTCDataChannel & { maxMessageSize?: number }).maxMessageSize;
    const chunkSize = maxMessage && maxMessage > 0 ? Math.min(CHUNK_SIZE, maxMessage) : CHUNK_SIZE;

    let paintedAt = 0;
    // One read-ahead slot: the next slice converts while the current chunk is
    // on the wire, so Blob reads never serialize the pump.
    let readAhead: { promise: Promise<ArrayBuffer>; start: number } | null = null;

    try {
      let offset = 0;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const meta = metas[i];
        offset = 0;

        while (offset < file.size) {
          if (channel.readyState !== "open") throw new Error("Connection lost.");

          if (channel.bufferedAmount > BUFFER_HIGH) {
            await this.waitForDrain(channel);
            continue;
          }

          let buffer: ArrayBuffer;
          if (readAhead && readAhead.start === offset) {
            buffer = await readAhead.promise;
          } else {
            buffer = await file.slice(offset, offset + chunkSize).arrayBuffer();
          }
          readAhead = null;

          channel.send(buffer);
          offset += buffer.byteLength;

          if (offset < file.size && channel.bufferedAmount <= BUFFER_HIGH) {
            readAhead = { promise: file.slice(offset, offset + chunkSize).arrayBuffer(), start: offset };
          }

          // Chunk events are far more frequent than useful repaints.
          const now = Date.now();
          if (now - paintedAt >= PROGRESS_PAINT_MS) {
            paintedAt = now;
            repaint(this.bytesUpTo(files, i, offset));
          }
        }
        // Force a final repaint so the bar reaches 100% before the receipt.
        repaint(this.bytesUpTo(files, i, file.size));

        // Signal completion of this file with a JSON control frame. `last`
        // tells the receiver whether it may tear down after reassembling, or
        // must keep the channel alive for the next file in the queue.
        try {
          channel.send(JSON.stringify({ done: true, fileId: meta.fileId, last: i === files.length - 1 }));
        } catch {
          // Receiver may have closed first; the outer engine will see it.
        }
      }

      await this.waitForBufferEmpty(channel);
    } catch (err) {
      if (this.canceledPeers.has(peerId)) return;
      this.event(err instanceof Error ? err.message : "Transfer failed.");
      this.cleanupPeer(peerId);
    }

    await new Promise((r) => setTimeout(r, POST_DONE_GUARD_MS));
    this.event(
      totalCount > 1 ? `Sent ${totalCount} files.` : `Sent “${metas[0].fileName}”.`,
    );
    this.showReceipt({
      fileName:
        totalCount > 1 ? `${totalCount} files` : metas[0].fileName,
      fileSize: totalBytes,
      direction: "send",
      peerName: this.peerName(peerId),
    });
    this.cleanupPeer(peerId);
  }

  /** Byte offset within the whole queue at the start of file `fileIndex`. */
  private queueOffset(files: File[], fileIndex: number): number {
    let sum = 0;
    for (let i = 0; i < fileIndex; i++) sum += files[i].size;
    return sum;
  }

  /** Queue-wide bytes sent once `fileIndex` has pushed `offset` bytes. */
  private bytesUpTo(files: File[], fileIndex: number, offset: number): number {
    return this.queueOffset(files, fileIndex) + offset;
  }

  /** Which file of the queue a queue-wide byte position falls in. */
  private fileIndexOfOffset(files: File[], bytes: number): number {
    let acc = 0;
    for (let i = 0; i < files.length; i++) {
      acc += files[i].size;
      if (bytes < acc || (files[i].size === 0 && bytes === acc)) return i;
    }
    return files.length - 1;
  }

  /** Best-effort display name for a peer id, for receipts. */
  private peerName(peerId: string): string | null {
    return this.peers.find((p) => p.id === peerId)?.name ?? null;
  }

  private waitForDrain(channel: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (channel.readyState !== "open" || channel.bufferedAmount <= BUFFER_LOW) {
          resolve();
          return;
        }
        setTimeout(check, 25);
        // Poll again on the next bufferedamountlow event if supported.
        channel.onbufferedamountlow = () => resolve();
      };
      check();
    });
  }

  /** Resolve once the channel has flushed everything handed to it. */
  private waitForBufferEmpty(channel: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (channel.readyState !== "open" || channel.bufferedAmount === 0) {
          resolve();
          return;
        }
        channel.onbufferedamountlow = () => resolve();
        setTimeout(check, 20);
      };
      check();
    });
  }

  private async onReceiveChunk(from: string, channel: RTCDataChannel, data: unknown): Promise<void> {
    const entry = this.incomingFiles.get(from);
    if (!entry) return;

    if (typeof data === "string") {
      try {
        const control = JSON.parse(data) as { done?: boolean; last?: boolean };
        if (control.done) {
          if (control.last !== false) {
            await this.finalizeIncoming(from);
          } else {
            // One file of a multi-file batch finished; reassemble and save it,
            // then keep the channel open for the rest of the queue.
            await this.rotateIncomingFile(from);
          }
        }
      } catch {
        // Ignore malformed control frames.
      }
      return;
    }

    const buffer = data as ArrayBuffer;
    entry.chunks.push(buffer);
    entry.received += buffer.byteLength;
    // Throttled repaint — rendering per chunk starved the event loop and
    // throttled the whole transfer.
    const now = Date.now();
    if (now - entry.paintedAt >= PROGRESS_PAINT_MS) {
      entry.paintedAt = now;
      this.paintIncoming(from, entry.startedAt);
    }
  }

  /** Repaint this peer's receive card from its incomingFiles entry. */
  private paintIncoming(from: string, startedAt: number): void {
    const entry = this.incomingFiles.get(from);
    if (!entry) return;
    const files = entry.files;
    const idx = entry.index;
    const current = files[idx];
    const totalBytes = files.reduce((sum, f) => sum + f.fileSize, 0);
    const before = files.slice(0, idx).reduce((sum, f) => sum + f.fileSize, 0);
    this.setPeerProgress(from, {
      fileName:
        files.length > 1 ? `${idx + 1}/${files.length} · ${current.fileName}` : current.fileName,
      fileSize: totalBytes,
      sentBytes: before + Math.min(entry.received, current.fileSize),
      direction: "receive",
      startedAt,
      peerName: this.peerName(from),
      peerId: from,
      fileIndex: idx + 1,
      fileCount: files.length,
    });
  }

  /**
   * A file of a multi-file batch just finished: turn its chunks into a Blob,
   * trigger the download prompt, and advance to the next file in the queue.
   */
  private async rotateIncomingFile(from: string): Promise<void> {
    const entry = this.incomingFiles.get(from);
    if (!entry) return;
    const finished = entry.files[entry.index];
    const blob = new Blob(entry.chunks, { type: finished.mimeType });
    this.saveBlob(blob, finished.fileName);
    entry.chunks = [];
    entry.received = 0;
    entry.index += 1;

    if (entry.index < entry.files.length) {
      this.event(
        entry.files.length > 1
          ? `Received ${entry.index}/${entry.files.length} files from ${this.peerName(from) ?? "device"}…`
          : `Received “${finished.fileName}”.`,
      );
      this.paintIncoming(from, entry.startedAt);
      return;
    }

    this.incomingFiles.delete(from);
    this.event(`Received ${entry.files.length > 1 ? `all ${entry.files.length} files` : `“${finished.fileName}”`}.`);
    this.showReceipt({
      fileName: entry.files.length > 1 ? `${entry.files.length} files` : finished.fileName,
      fileSize: entry.files.reduce((sum, f) => sum + f.fileSize, 0),
      direction: "receive",
      peerName: this.peerName(from),
    });
    this.cleanupPeer(from);
  }

  /** Reassemble received chunks, prompt a download, and expose the test hook. */
  private saveBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    // Debug/test hook — lets automated checks verify the received bytes.
    const hook = (window as unknown as { __klypLocal?: { lastFileUrl: string | null } }).__klypLocal;
    if (hook) hook.lastFileUrl = url;
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  /**
   * Channel closed while an incoming entry still existed: the sender went
   * away mid-file, so nothing complete arrived. Surface the partial-transfer
   * event and tear the peer down WITHOUT saving truncated bytes.
   */
  private onIncomingChannelClose(from: string): void {
    const entry = this.incomingFiles.get(from);
    this.incomingFiles.delete(from);
    const name = this.peerName(from) ?? "device";
    if (entry && entry.received > 0) {
      const idx = entry.index + 1;
      this.event(
        entry.files.length > 1
          ? `Transfer interrupted — ${idx}/${entry.files.length} files incomplete from ${name}.`
          : `Transfer interrupted — “${entry.files[0].fileName}” did not arrive.`,
      );
    }
    this.cleanupPeer(from);
  }

  private async finalizeIncoming(from: string): Promise<void> {
    const entry = this.incomingFiles.get(from);
    if (!entry) return;
    this.incomingFiles.delete(from);

    // For a multi-file queue, rotations (done with last:false) already
    // advanced entry.index — so files[entry.index] is the file that just
    // finished, not files[0].
    const meta = entry.files[entry.index] ?? entry.files[0];
    this.saveBlob(new Blob(entry.chunks, { type: meta.mimeType }), meta.fileName);

    this.event(`Received “${meta.fileName}”.`);
    this.showReceipt({
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      direction: "receive",
      peerName: this.peerName(from),
    });
    this.cleanupPeer(from);
  }

  private cleanupPeer(peerId: string): void {
    this.clearOfferTimeout(peerId);
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }
    this.pendingByPeer.delete(peerId);
    this.sendingPeers.delete(peerId);
    this.iceQueueByPeer.delete(peerId);
    this.canceledPeers.delete(peerId);
    this.broadcastActiveSends();
    const resolver = this.completionByPeer.get(peerId);
    if (resolver) {
      this.completionByPeer.delete(peerId);
      resolver();
    }
  }

  /** Public cancel for the X button on a send progress card (item 1). */
  cancelSend(peerId: string): void {
    this.canceledPeers.add(peerId);
    const pc = this.connections.get(peerId);
    if (pc) pc.close();
    const channel = this.pendingByPeer.get(peerId)?.channel;
    if (channel) channel.close();
    const name = this.peerName(peerId) ?? "device";
    this.cleanupPeer(peerId);
    this.setPeerProgress(peerId, null);
    this.event(`Transfer to ${name} canceled.`);
  }

  /**
   * Fan one file set out to several peers, one at a time. Each peer gets its
   * own consent prompt and its own connection — and peers that answer "busy"
   * just fall through, so one busy device never blocks the others. Resolves
   * when every peer's transfer (accept, decline, busy, failure or completion)
   * has settled.
   */
  async sendToAll(peerIds: string[], file: File, moreFiles?: File[]): Promise<void> {
    if (!this.deviceId) throw new Error("Join the room first.");
    const targets = [...new Set(peerIds)].filter((id) => !this.sendingPeers.has(id));
    if (targets.length === 0) throw new Error("Every device is already receiving a transfer.");

    try {
      for (const peerId of targets) {
        if (this.canceledPeers.has(peerId)) continue;
        const settled = new Promise<void>((resolve) => {
          this.completionByPeer.set(peerId, resolve);
        });
        try {
          await this.sendTo(peerId, file, moreFiles);
        } catch {
          // sendTo throws for a peer mid-send; cleanupPeer already ran, so the
          // settled promise above may never resolve — bail out of the loop.
          this.completionByPeer.delete(peerId);
          continue;
        }
        // The resolver also fires on decline/busy/failure/cancel, so this
        // await can never hang past the 30 s offer timeout.
        const timeout = new Promise<void>((resolve) => setTimeout(resolve, 45_000));
        await Promise.race([settled, timeout]);
        this.completionByPeer.delete(peerId);
      }
    } finally {
      this.completionByPeer.clear();
      this.canceledPeers.clear();
    }
  }

  private wireLeaveBeacon(): void {
    if (this.leaveBeaconWired) return;
    this.leaveBeaconWired = true;
    window.addEventListener("pagehide", () => {
      if (this.deviceId && this.deviceToken) {
        // keepalive so the request survives navigation/unload.
        void fetch("/api/local/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: this.deviceId, deviceToken: this.deviceToken }),
          keepalive: true,
        }).catch(() => {});
      }
    });
  }
}

export const localEngine = new LocalTransferEngine();
