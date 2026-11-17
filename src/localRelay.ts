import { createServer, type IncomingMessage, type Server } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { verifyBytes, unb64u } from "./crypto.js";

/** Same API as relay/worker.ts, in memory. For local use and tests. */
const MAX_MSG = 256 * 1024;
const MAX_PAIR = 8 * 1024;
const MSG_TTL = 7 * 86400 * 1000;
const PAIR_TTL = 600 * 1000;
const MAX_BOX_MSGS = 200;
const MAX_BOX_BYTES = 8 * 1024 * 1024;
const MAX_PAIRS = 10_000;

const boxOf = (pub: string): string =>
  createHash("sha256").update(unb64u(pub)).digest().toString("base64url").slice(0, 32);

export function startRelay(port: number, host = "127.0.0.1"): Promise<{ server: Server; url: string; close: () => Promise<void> }> {
  const boxes = new Map<string, Map<string, { env: string; at: number }>>();
  const sockets = new Map<string, Set<WebSocket>>();
  const pairs = new Map<string, { blob: string; at: number }>();
  const wss = new WebSocketServer({ noServer: true });

  const deliver = (box: string, id: string, env: string): void => {
    for (const s of sockets.get(box) ?? []) s.send(`{"type":"msg","id":"${id}","env":${env}}`);
  };

  const body = (req: IncomingMessage, max: number): Promise<string | null> => new Promise((res) => {
    const chunks: Buffer[] = []; let n = 0;
    req.on("data", (c: Buffer) => { n += c.length; if (n <= max) chunks.push(c); else req.destroy(); });
    req.on("close", () => { if (n > max) res(null); });
    req.on("end", () => res(n > max ? null : Buffer.concat(chunks).toString("utf8")));
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean);
    const now = Date.now();
    for (const [k, v] of pairs) if (now - v.at > PAIR_TTL) pairs.delete(k);
    if (parts[0] === "send" && parts[1] && req.method === "POST") {
      const box = parts[1];
      const text = await body(req, MAX_MSG);
      if (text === null) { res.writeHead(413).end("too large"); return; }
      try {
        const env = JSON.parse(text) as { h?: { to?: string } };
        if (env.h?.to !== box) throw new Error();
      } catch { res.writeHead(400).end("bad envelope"); return; }
      const id = randomBytes(8).toString("hex");
      const m = boxes.get(box) ?? new Map(); boxes.set(box, m);
      for (const [k, v] of m) if (now - v.at > MSG_TTL) m.delete(k);
      let bytes = 0; for (const v of m.values()) bytes += v.env.length;
      if (m.size >= MAX_BOX_MSGS || bytes + text.length > MAX_BOX_BYTES) { res.writeHead(507).end("mailbox full"); return; }
      m.set(id, { env: text, at: now });
      deliver(box, id, text);
      res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ id }));
      return;
    }
    if (parts[0] === "pair" && parts[1] && (parts[2] === "a" || parts[2] === "b")) {
      const key = `${parts[1]}/${parts[2]}`;
      if (req.method === "PUT") {
        const text = await body(req, MAX_PAIR);
        if (text === null) { res.writeHead(413).end(); return; }
        if (pairs.has(key)) { res.writeHead(409).end("taken"); return; }
        if (pairs.size >= MAX_PAIRS) { res.writeHead(507).end("busy"); return; }
        pairs.set(key, { blob: text, at: now });
        res.writeHead(204).end(); return;
      }
      if (req.method === "GET") {
        const v = pairs.get(key);
        if (!v) { res.writeHead(404).end(); return; }
        res.writeHead(200).end(v.blob); return;
      }
    }
    if (url.pathname === "/") { res.writeHead(200).end("elefant-relay relay ok"); return; }
    res.writeHead(404).end();
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean);
    const box = parts[1] ?? "";
    const pub = url.searchParams.get("pub") ?? "";
    const ts = url.searchParams.get("ts") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
    const ok = parts[0] === "box" && box && pub && fresh && boxOf(pub) === box
      && verifyBytes(pub, Buffer.from(`elefant-relay-box|${box}|${ts}`), sig);
    if (!ok) { socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const set = sockets.get(box) ?? new Set(); set.add(ws); sockets.set(box, set);
      for (const [id, v] of boxes.get(box) ?? []) ws.send(`{"type":"msg","id":"${id}","env":${v.env}}`);
      ws.on("message", (raw) => {
        const s = raw.toString();
        if (s === "ping") { ws.send("pong"); return; }
        try {
          const m = JSON.parse(s) as { type?: string; id?: string };
          if (m.type === "ack" && m.id) boxes.get(box)?.delete(m.id);
        } catch { /* ignore */ }
      });
      ws.on("close", () => set.delete(ws));
      ws.on("error", () => { set.delete(ws); ws.terminate(); });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server, url: `http://${host}:${actual}`,
        close: () => new Promise<void>((r) => { for (const c of wss.clients) c.terminate(); server.close(() => r()); }),
      });
    });
  });
}
