import type { Envelope, Identity } from "./crypto.js";
import { boxAuth } from "./crypto.js";

const base = (relay: string): string => relay.replace(/\/+$/, "");

export async function sendEnvelope(relay: string, toBox: string, env: Envelope): Promise<void> {
  const r = await fetch(`${base(relay)}/send/${toBox}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(env),
  });
  if (r.status !== 202) throw new Error(`relay refused the message (${r.status}): ${await r.text()}`);
}

export async function pairPut(relay: string, slot: string, side: "a" | "b", blob: string): Promise<void> {
  const r = await fetch(`${base(relay)}/pair/${slot}/${side}`, { method: "PUT", body: blob });
  if (r.status === 409) throw new Error("this code is already in use — make a new one");
  if (!r.ok) throw new Error(`relay pairing failed (${r.status})`);
}

export async function pairGet(relay: string, slot: string, side: "a" | "b"): Promise<string | null> {
  const r = await fetch(`${base(relay)}/pair/${slot}/${side}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`relay pairing failed (${r.status})`);
  return await r.text();
}

export async function waitPair(relay: string, slot: string, side: "a" | "b", timeoutMs: number): Promise<string> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await pairGet(relay, slot, side);
    if (v) return v;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("timed out waiting for the other side");
}

export interface BoxConnection { close(): void }

/**
 * Keep a WebSocket open to our mailbox. Each delivered envelope is passed to `onEnvelope`;
 * after it resolves we ack it so the relay deletes it (unless it returns false: leave it for later). Reconnects with backoff.
 */
export function connectBox(
  relay: string, me: Identity,
  onEnvelope: (env: Envelope) => Promise<boolean | void>,
  log: (s: string) => void = () => {},
): BoxConnection {
  let closed = false;
  let ws: WebSocket | null = null;
  let delay = 1000;
  let ping: NodeJS.Timeout | null = null;

  const open = (): void => {
    if (closed) return;
    const a = boxAuth(me);
    const url = `${base(relay).replace(/^http/, "ws")}/box/${a.box}?pub=${a.pub}&ts=${a.ts}&sig=${a.sig}`;
    ws = new WebSocket(url);
    ws.addEventListener("open", () => {
      delay = 1000;
      log("connected to relay");
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 30_000);
    });
    ws.addEventListener("message", (ev) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      if (data === "pong") return;
      let m: { type?: string; id?: string; env?: Envelope };
      try { m = JSON.parse(data); } catch { return; }
      if (m.type !== "msg" || !m.id || !m.env) return;
      const id = m.id;
      onEnvelope(m.env)
        .then((keep) => keep !== false, (e: unknown) => { log(`message error: ${e instanceof Error ? e.message : String(e)}`); return true; })
        .then((ack) => { if (ack && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ack", id })); });
    });
    ws.addEventListener("close", () => {
      if (ping) clearInterval(ping);
      if (closed) return;
      log(`relay connection lost, retrying in ${Math.round(delay / 1000)}s`);
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 30_000);
    });
    ws.addEventListener("error", () => { /* close handler retries */ });
  };
  open();
  return { close: () => { closed = true; if (ping) clearInterval(ping); ws?.close(); } };
}
