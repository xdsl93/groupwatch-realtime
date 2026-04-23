import Peer, { type DataConnection } from "peerjs";
import { decryptJSON, encryptJSON, importKey } from "./crypto";
import type { Identity, WireMessage } from "./types";

// Deterministic peer-id namespace from room code so peers can find each other
// via the public PeerJS broker without a separate signaling step.
function roomPeerId(code: string, suffix: string) {
  return `tactrack-${code.toLowerCase()}-${suffix}`;
}

function randomSuffix() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}

export type MeshHandlers = {
  onMessage: (msg: WireMessage, fromPeerId: string) => void;
  onPeerConnected: (peerId: string) => void;
  onPeerDisconnected: (peerId: string) => void;
  onSelfId: (id: string) => void;
  onError: (err: Error) => void;
};

export class Mesh {
  private peer: Peer | null = null;
  private key: CryptoKey | null = null;
  private conns = new Map<string, DataConnection>();
  private knownPeerIds = new Set<string>();
  private pendingConnectIds = new Set<string>();
  private suffix = randomSuffix();
  private destroyed = false;
  private opened = false;

  constructor(
    private roomCode: string,
    private keyB64: string,
    private identity: Identity,
    private handlers: MeshHandlers,
  ) {}

  async start() {
    this.key = await importKey(this.keyB64);
    const selfId = roomPeerId(this.roomCode, this.suffix);
    this.peer = new Peer(selfId, {
      debug: 1,
      host: "0.peerjs.com",
      port: 443,
      path: "/",
      secure: true,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      },
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled || this.destroyed) return;
        settled = true;
        reject(new Error("Timed out connecting to mesh broker."));
      }, 12000);

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      };

      const settleReject = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      };

      this.peer!.on("open", (id) => {
        this.opened = true;
        this.handlers.onSelfId(id);
        this.flushPendingConnects();
        settleResolve();
      });

      this.peer!.on("connection", (conn) => this.attachConn(conn));

      this.peer!.on("error", (err) => {
        const type = (err as { type?: string }).type ?? "";
        // Non-fatal when dialing peers that may be offline.
        if (type === "peer-unavailable") return;

        this.handlers.onError(err as Error);

        // Before initial open, this is a hard startup failure.
        if (!this.opened) {
          const message =
            (err as { message?: string }).message ||
            "Mesh connection failed.";
          settleReject(new Error(message));
        }
      });
    });
  }

  connectTo(peerId: string) {
    const target = peerId.trim();
    if (!target) return;
    if (this.destroyed) return;
    if (!this.peer || !this.opened) {
      this.pendingConnectIds.add(target);
      return;
    }
    if (target === this.peer.id) return;
    if (this.conns.has(target)) return;
    const conn = this.peer.connect(target, { reliable: true });
    this.attachConn(conn);
  }

  private flushPendingConnects() {
    if (!this.pendingConnectIds.size) return;
    const ids = Array.from(this.pendingConnectIds);
    this.pendingConnectIds.clear();
    for (const id of ids) this.connectTo(id);
  }

  private attachConn(conn: DataConnection) {
    this.conns.set(conn.peer, conn);
    conn.on("open", async () => {
      this.knownPeerIds.add(conn.peer);
      this.handlers.onPeerConnected(conn.peer);
      // Send hello + known peers so newcomer can bootstrap mesh
      await this.sendTo(conn, {
        t: "hello",
        id: this.identity.id,
        callsign: this.identity.callsign,
        color: this.identity.color,
      });
      await this.sendTo(conn, { t: "peers", ids: Array.from(this.knownPeerIds) });
    });
    conn.on("data", async (data) => {
      try {
        if (typeof data !== "string" || !this.key) return;
        const msg = await decryptJSON<WireMessage>(this.key, data);
        if (msg.t === "peers") {
          for (const id of msg.ids) this.connectTo(id);
          return;
        }
        this.handlers.onMessage(msg, conn.peer);
      } catch (e) {
        // Wrong key or corrupted message — ignore silently
        console.warn("decrypt failed", e);
      }
    });
    conn.on("close", () => {
      this.conns.delete(conn.peer);
      this.handlers.onPeerDisconnected(conn.peer);
    });
    conn.on("error", () => {
      this.conns.delete(conn.peer);
      this.handlers.onPeerDisconnected(conn.peer);
    });
  }

  private async sendTo(conn: DataConnection, msg: WireMessage) {
    if (!this.key || !conn.open) return;
    const ct = await encryptJSON(this.key, msg);
    conn.send(ct);
  }

  async broadcast(msg: WireMessage) {
    if (!this.key) return;
    const ct = await encryptJSON(this.key, msg);
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(ct);
    }
  }

  get peerCount() {
    let n = 0;
    for (const c of this.conns.values()) if (c.open) n++;
    return n;
  }

  destroy() {
    this.destroyed = true;
    this.opened = false;
    this.pendingConnectIds.clear();
    for (const c of this.conns.values()) c.close();
    this.conns.clear();
    this.peer?.destroy();
    this.peer = null;
  }
}
