// Minimal Wisp (v1) server for Cloudflare Workers, built on connect() TCP sockets.
// The browser (epoxy) does TLS itself, so this only relays raw bytes, and only to
// Roblox hosts on port 443, so it is not an open proxy.
import { connect } from "cloudflare:sockets";

const ALLOWED_HOST = /(^|\.)(roblox\.com|rbxcdn\.com|robloxlabs\.com|arkoselabs\.com|funcaptcha\.com)$/i;
const BUFFER = 128;
const MAX_STREAMS = 256;

const CONNECT = 0x01;
const DATA = 0x02;
const CONTINUE = 0x03;
const CLOSE = 0x04;

const VOLUNTARY = 0x02;
const UNEXPECTED = 0x03;
const INVALID = 0x41;
const UNREACHABLE = 0x42;
const BLOCKED = 0x48;

type Stream = { socket: Socket; writer: WritableStreamDefaultWriter<Uint8Array>; queue: Promise<void> };

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

class Session {
  private streams = new Map<number, Stream>();

  constructor(private ws: WebSocket) {
    ws.addEventListener("message", (e) => this.onMessage(e.data));
    ws.addEventListener("close", () => this.closeAll());
    ws.addEventListener("error", () => this.closeAll());
    this.send(CONTINUE, 0, u32(BUFFER)); // v1 handshake: initial buffer for stream 0
  }

  private send(type: number, id: number, payload: Uint8Array) {
    const out = new Uint8Array(5 + payload.length);
    out[0] = type;
    new DataView(out.buffer).setUint32(1, id, true);
    out.set(payload, 5);
    try {
      this.ws.send(out);
    } catch {
      this.closeAll();
    }
  }

  private sendClose(id: number, reason: number) {
    this.send(CLOSE, id, new Uint8Array([reason]));
  }

  private onMessage(data: string | ArrayBuffer) {
    if (typeof data === "string") return;
    const bytes = new Uint8Array(data);
    if (bytes.length < 5) return;
    const type = bytes[0]!;
    const id = new DataView(bytes.buffer, bytes.byteOffset + 1, 4).getUint32(0, true);
    const payload = bytes.subarray(5);

    if (type === CONNECT) {
      if (payload.length < 4) return this.sendClose(id, INVALID);
      const streamType = payload[0];
      const port = new DataView(payload.buffer, payload.byteOffset + 1, 2).getUint16(0, true);
      const host = new TextDecoder().decode(payload.subarray(3)).toLowerCase();
      if (streamType !== 1) return this.sendClose(id, INVALID); // TCP only
      if (port !== 443 || !ALLOWED_HOST.test(host)) return this.sendClose(id, BLOCKED);
      this.open(id, host, port);
    } else if (type === DATA) {
      const stream = this.streams.get(id);
      if (!stream) return;
      const chunk = payload.slice();
      stream.queue = stream.queue
        .then(async () => {
          await stream.writer.write(chunk);
          this.send(CONTINUE, id, u32(BUFFER));
        })
        .catch(() => this.end(id, stream, UNEXPECTED));
    } else if (type === CLOSE) {
      const stream = this.streams.get(id);
      if (!stream) return;
      this.streams.delete(id);
      try {
        stream.socket.close();
      } catch {}
    }
  }

  private open(id: number, host: string, port: number) {
    if (this.streams.has(id) || this.streams.size >= MAX_STREAMS) return this.sendClose(id, UNEXPECTED);
    let socket: Socket;
    try {
      socket = connect({ hostname: host, port }, { secureTransport: "off", allowHalfOpen: false });
    } catch {
      return this.sendClose(id, UNREACHABLE);
    }
    const stream: Stream = { socket, writer: socket.writable.getWriter(), queue: Promise.resolve() };
    this.streams.set(id, stream);
    socket.opened.catch(() => this.end(id, stream, UNREACHABLE));
    void this.pump(id, stream);
  }

  private async pump(id: number, stream: Stream) {
    const reader = stream.socket.readable.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (this.streams.get(id) !== stream) return;
        this.send(DATA, id, value);
      }
      this.end(id, stream, VOLUNTARY);
    } catch {
      this.end(id, stream, UNEXPECTED);
    }
  }

  private end(id: number, stream: Stream, reason: number) {
    if (this.streams.get(id) !== stream) return;
    this.streams.delete(id);
    this.sendClose(id, reason);
    try {
      stream.socket.close();
    } catch {}
  }

  private closeAll() {
    for (const stream of this.streams.values()) {
      try {
        stream.socket.close();
      } catch {}
    }
    this.streams.clear();
  }
}

export function handleWisp(request: Request): Response {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();
  new Session(server);
  return new Response(null, { status: 101, webSocket: client });
}
