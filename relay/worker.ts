/**
 * elefant-relay relay — a mailbox that only ever sees encrypted envelopes.
 * Deploy to your own Cloudflare account (free plan works): `npx elefant-relay relay deploy`
 *
 *   POST /send/<box>            store an envelope (≤256 KB) for <box>; pushed live to the owner
 *   GET  /box/<box>?pub&ts&sig  WebSocket for the owner of <box> (Ed25519 proof); ack to delete
 *   PUT  /pair/<slot>/<a|b>     pairing blob (≤8 KB, write-once, gone after 10 min)
 *   GET  /pair/<slot>/<a|b>
 */
import { DurableObject } from "cloudflare:workers";

interface Env { BOX: DurableObjectNamespace<Box> }

const MAX_MSG = 256 * 1024;
const MAX_PAIR = 8 * 1024;
const MSG_TTL = 7 * 86400 * 1000;
const PAIR_TTL = 600 * 1000;
const MAX_BOX_MSGS = 200;

const tooBig = (req: Request, max: number): boolean => Number(req.headers.get("content-length") ?? "0") > max;

const unb64u = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const b64u = (a: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function ownerOk(box: string, pub: string, ts: string, sig: string): Promise<boolean> {
  try {
    if (Math.abs(Date.now() / 1000 - Number(ts)) >= 300) return false;
    const raw = unb64u(pub);
    if (b64u(await crypto.subtle.digest("SHA-256", raw)).slice(0, 32) !== box) return false;
    const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, unb64u(sig), new TextEncoder().encode(`elefant-relay-box|${box}|${ts}`));
  } catch {
    return false;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const [kind, a, b] = url.pathname.split("/").filter(Boolean);
    if (!kind) return new Response("elefant-relay relay ok");
    if (kind === "send" && a && req.method === "POST") return env.BOX.get(env.BOX.idFromName(`box:${a}`)).fetch(req);
    if (kind === "box" && a) {
      if (req.headers.get("upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
      const q = url.searchParams;
      if (!(await ownerOk(a, q.get("pub") ?? "", q.get("ts") ?? "", q.get("sig") ?? ""))) return new Response("unauthorized", { status: 401 });
      return env.BOX.get(env.BOX.idFromName(`box:${a}`)).fetch(req);
    }
    if (kind === "pair" && a && (b === "a" || b === "b")) return env.BOX.get(env.BOX.idFromName(`pair:${a}`)).fetch(req);
    return new Response("not found", { status: 404 });
  },
};

export class Box extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const [kind, box, side] = url.pathname.split("/").filter(Boolean);
    const now = Date.now();

    if (kind === "send" && box) {
      if (tooBig(req, MAX_MSG)) return new Response("too large", { status: 413 });
      const queued = await this.ctx.storage.list({ prefix: "m:", limit: MAX_BOX_MSGS });
      if (queued.size >= MAX_BOX_MSGS) return new Response("mailbox full", { status: 507 });
      const text = await req.text();
      if (text.length > MAX_MSG) return new Response("too large", { status: 413 });
      try {
        const e = JSON.parse(text) as { h?: { to?: string } };
        if (e.h?.to !== box) throw new Error();
      } catch {
        return new Response("bad envelope", { status: 400 });
      }
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
      await this.ctx.storage.put(`m:${now}:${id}`, text);
      for (const ws of this.ctx.getWebSockets()) ws.send(`{"type":"msg","id":"${now}:${id}","env":${text}}`);
      await this.ctx.storage.setAlarm(now + MSG_TTL);
      return Response.json({ id }, { status: 202 });
    }

    if (kind === "box") {
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      const queued = await this.ctx.storage.list<string>({ prefix: "m:" });
      for (const [k, v] of queued) server.send(`{"type":"msg","id":"${k.slice(2)}","env":${v}}`);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (kind === "pair" && (side === "a" || side === "b")) {
      const key = `p:${side}`;
      const cur = await this.ctx.storage.get<{ blob: string; at: number }>(key);
      const live = cur && now - cur.at < PAIR_TTL ? cur : undefined;
      if (req.method === "PUT") {
        if (live) return new Response("taken", { status: 409 });
        if (tooBig(req, MAX_PAIR)) return new Response("too large", { status: 413 });
        const blob = await req.text();
        if (blob.length > MAX_PAIR) return new Response("too large", { status: 413 });
        await this.ctx.storage.put(key, { blob, at: now });
        await this.ctx.storage.setAlarm(now + PAIR_TTL);
        return new Response(null, { status: 204 });
      }
      if (req.method === "GET") return live ? new Response(live.blob) : new Response("not found", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    try {
      const m = JSON.parse(message) as { type?: string; id?: string };
      if (m.type === "ack" && m.id) await this.ctx.storage.delete(`m:${m.id}`);
    } catch { /* ignore */ }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const all = await this.ctx.storage.list();
    const dead: string[] = [];
    for (const [k, v] of all) {
      if (k.startsWith("m:") && now - Number(k.split(":")[1]) > MSG_TTL) dead.push(k);
      if (k.startsWith("p:") && now - (v as { at: number }).at >= PAIR_TTL) dead.push(k);
    }
    if (dead.length) await this.ctx.storage.delete(dead);
  }
}
