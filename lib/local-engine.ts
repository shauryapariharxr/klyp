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
  meta: LocalFileMeta;
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
  progress: TransferProgress | null;
  receipt: TransferReceipt | null;
  refreshing: boolean;
  lastEvent: string | null;
};

type SignalPayload =
  | { kind: "offer"; sdp: RTCSessionDescriptionInit; meta: LocalFileMeta; senderName: string }
  | { kind: "answer"; sdp: RTCSessionDescriptionInit }
  | { kind: "accept" }
  | { kind: "decline" }
  | { kind: "busy" };

const CHUNK_SIZE = 16 * 1024;
const BUFFER_HIGH = 512 * 1024;
const BUFFER_LOW = 128 * 1024;
/** Extra headroom the receiver grants so the last chunks always drain. */
const BUFFER_DRAIN_HEADROOM_MS = 500;
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
    { file: File; meta: LocalFileMeta; pc: RTCPeerConnection; channel: RTCDataChannel }
  >();
  private connections = new Map<string, RTCPeerConnection>();
  private incomingFiles = new Map<
    string,
    { meta: LocalFileMeta; chunks: ArrayBuffer[]; received: number; startedAt: number }
  >();
  /** Peers with a send in flight (offer through completion). */
  private sendingPeers = new Set<string>();
  /** Give up on a peer that never answers the offer (closed tab, Wi-Fi drop). */
  private offerTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private iceQueueByPeer = new Map<string, RTCIceCandidateInit[]>();

  private listeners = new Set<(state: LocalEngineState) => void>();
  private state: LocalEngineState = {
    status: "offline",
    selfId: null,
    selfName: null,
    peers: [],
    incomingRequest: null,
    progress: null,
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
    this.setState({ progress: null, receipt });
    this.receiptTimer = setTimeout(() => {
      this.receiptTimer = null;
      this.setState({ receipt: null });
    }, RECEIPT_VISIBLE_MS);
  }

  /** Clear a finished-transfer receipt early (user dismissed it). */
  dismissReceipt(): void {
    if (this.receiptTimer) {
      clearTimeout(this.receiptTimer);
      this.receiptTimer = null;
    }
    this.setState({ receipt: null });
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
    this.peers = [];
    this.afterSeq = 0;
    if (this.receiptTimer) {
      clearTimeout(this.receiptTimer);
      this.receiptTimer = null;
    }
    this.setState({
      status: "offline",
      selfId: null,
      selfName: null,
      peers: [],
      progress: null,
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
            meta: payload.meta,
            accept: () => void this.answerOffer(from, payload.sdp, payload.meta),
            decline: () => void this.sendSignal(from, { kind: "decline" }),
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

  /** Entry point for the sender: request consent, then connect. */
  async sendTo(peerId: string, file: File): Promise<void> {
    if (!this.deviceId) throw new Error("Join the room first.");
    if (this.sendingPeers.has(peerId)) throw new Error("Already sending to this device.");
    this.sendingPeers.add(peerId);

    const meta: LocalFileMeta = {
      fileId: randomId(),
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    };

    const pc = this.newConnection(peerId);
    const channel = pc.createDataChannel("klyp", { ordered: true });
    this.wireSendChannel(peerId, channel, file, meta);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // No trickle-ICE signaling channel — wait (briefly) for the full candidate
    // list so one SDP exchange is enough. On a LAN this is near-instant.
    await this.waitIceGathering(pc);
    await this.sendSignal(peerId, {
      kind: "offer",
      sdp: { type: pc.localDescription!.type, sdp: pc.localDescription!.sdp },
      meta,
      senderName: this.selfName ?? "A device",
    });
    this.event(`Waiting for the other device to accept “${file.name}”…`);
    this.armOfferTimeout(peerId);
  }

  private armOfferTimeout(peerId: string): void {
    this.clearOfferTimeout(peerId);
    this.offerTimeouts.set(
      peerId,
      setTimeout(() => {
        if (this.sendingPeers.has(peerId)) {
          this.cleanupPeer(peerId);
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
    file: File,
    meta: LocalFileMeta,
  ): void {
    channel.onopen = () => {
      void this.pumpFile(peerId, channel, file, meta);
    };
    channel.onerror = () => this.cleanupPeer(peerId);
  }

  private async answerOffer(from: string, sdp: RTCSessionDescriptionInit, meta: LocalFileMeta): Promise<void> {
    this.setState({ incomingRequest: null });
    const pc = this.newConnection(from);
    pc.ondatachannel = (event) => {
      const channel = event.channel;
      this.incomingFiles.set(from, { meta, chunks: [], received: 0, startedAt: Date.now() });
      this.setState({
        progress: {
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          sentBytes: 0,
          direction: "receive",
          startedAt: Date.now(),
          peerName: this.peerName(from),
        },
      });
      channel.onmessage = (msg) => void this.onReceiveChunk(from, channel, msg.data);
      channel.onclose = () => this.finalizeIncoming(from);
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
    this.event(`Connecting to receive “${meta.fileName}”…`);
  }

  private async pumpFile(
    peerId: string,
    channel: RTCDataChannel,
    file: File,
    meta: LocalFileMeta,
  ): Promise<void> {
    this.pendingByPeer.set(peerId, { file, meta, pc: this.connections.get(peerId)!, channel });
    const startedAt = Date.now();
    this.setState({
      progress: {
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        sentBytes: 0,
        direction: "send",
        startedAt,
        peerName: this.peerName(peerId),
      },
    });

    let offset = 0;
    try {
      while (offset < file.size) {
        if (channel.readyState !== "open") throw new Error("Connection lost.");

        if (channel.bufferedAmount > BUFFER_HIGH) {
          await this.waitForDrain(channel);
          continue;
        }

        const slice = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        channel.send(buffer);
        offset += buffer.byteLength;

        this.setState({
          progress: {
            fileName: meta.fileName,
            fileSize: meta.fileSize,
            sentBytes: offset,
            direction: "send",
            startedAt,
            peerName: this.peerName(peerId),
          },
        });
      }
    } catch (err) {
      this.event(err instanceof Error ? err.message : "Transfer failed.");
      this.cleanupPeer(peerId);
      return;
    }

    // Signal completion with a JSON control frame, then close politely once
    // the receiver acknowledges.
    try {
      channel.send(JSON.stringify({ done: true, fileId: meta.fileId }));
      await this.waitForDrain(channel);
    } catch {
      // Receiver may have closed first.
    }
    await new Promise((r) => setTimeout(r, BUFFER_DRAIN_HEADROOM_MS));
    // Hand off to a receipt instead of leaving the bar parked at 100%. This
    // was the "glitch": the sender's progress state was never cleared.
    this.showReceipt({
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      direction: "send",
      peerName: this.peerName(peerId),
    });
    this.event(`Sent “${meta.fileName}”.`);
    this.cleanupPeer(peerId);
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

  private async onReceiveChunk(from: string, channel: RTCDataChannel, data: unknown): Promise<void> {
    const entry = this.incomingFiles.get(from);
    if (!entry) return;

    if (typeof data === "string") {
      try {
        const control = JSON.parse(data) as { done?: boolean };
        if (control.done) {
          await this.finalizeIncoming(from);
        }
      } catch {
        // Ignore malformed control frames.
      }
      return;
    }

    const buffer = data as ArrayBuffer;
    entry.chunks.push(buffer);
    entry.received += buffer.byteLength;
    this.setState({
      progress: {
        fileName: entry.meta.fileName,
        fileSize: entry.meta.fileSize,
        sentBytes: entry.received,
        direction: "receive",
        startedAt: entry.startedAt,
        peerName: this.peerName(from),
      },
    });
  }

  private async finalizeIncoming(from: string): Promise<void> {
    const entry = this.incomingFiles.get(from);
    if (!entry) return;
    this.incomingFiles.delete(from);

    const blob = new Blob(entry.chunks, { type: entry.meta.mimeType });
    const url = URL.createObjectURL(blob);
    // Debug/test hook — lets automated checks verify the received bytes.
    const hook = (window as unknown as { __klypLocal?: { lastFileUrl: string | null } }).__klypLocal;
    if (hook) hook.lastFileUrl = url;
    const link = document.createElement("a");
    link.href = url;
    link.download = entry.meta.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);

    this.event(`Received “${entry.meta.fileName}”.`);
    this.showReceipt({
      fileName: entry.meta.fileName,
      fileSize: entry.meta.fileSize,
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
