import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { decide } from "./rules.js";
import { p } from "./home.js";
import { receiverPid } from "./receiver.js";
import { loadConfig, loadIdentity, loadPeers, loadRules, listPending, type Mode, type Peer, type Rule } from "./state.js";
import { UI_HTML } from "./uiPage.js";

export interface Perm {
  action: "allow" | "deny" | "ask";
  ruleId?: string;
  ruleLabel?: string;
  until?: string;
  note?: string;
  expiredRuleId?: string;
  expiredUntil?: string;
}

export interface UiPeer {
  name: string;
  kind: "own" | "people";
  added: string;
  safety: string;
  folderPath?: string;
  runsEverythingWithoutAsking: boolean;
  perms: Record<Mode, Perm>;
}

export interface UiRule extends Rule { expired: boolean; command: string }

export interface UiLogEntry { at: string; peer?: string; event: string; mode?: string; status?: string }

export interface UiState {
  me: { name: string; use: "own" | "people"; files: boolean; relay: string; agent: string; listening: boolean } | null;
  peers: UiPeer[];
  rules: UiRule[];
  pending: { id: string; peer: string; mode: Mode; text: string; received: string }[];
  log: UiLogEntry[];
  now: string;
}

const MODES: Mode[] = ["read", "write"];
const LOG_ENTRIES = 20;
const LOG_TAIL_BYTES = 128 * 1024;

const isExpired = (r: Rule, now: number): boolean => r.until !== undefined && Date.parse(r.until) <= now;

function perm(peer: string, mode: Mode, rules: Rule[], now: number): Perm {
  const d = decide(peer, mode, rules, now);
  if (d.rule) {
    return { action: d.action, ruleId: d.rule.id, ruleLabel: `${d.rule.peer}/${d.rule.mode}`, until: d.rule.until, note: d.rule.note };
  }
  const expired = rules.filter((r) => isExpired(r, now) && (r.peer === "*" || r.peer === peer) && (r.mode === "*" || r.mode === mode))
    .sort((a, b) => ((b.peer === "*" ? 0 : 2) + (b.mode === "*" ? 0 : 1)) - ((a.peer === "*" ? 0 : 2) + (a.mode === "*" ? 0 : 1)))[0];
  return { action: "ask", expiredRuleId: expired?.id, expiredUntil: expired?.until };
}

function peerView(peer: Peer, rules: Rule[], now: number): UiPeer {
  const perms = { read: perm(peer.name, "read", rules, now), write: perm(peer.name, "write", rules, now) };
  const own = peer.kind === "own";
  const everything = own && MODES.every((m) => perms[m].action === "allow" && rules.some((r) => r.id === perms[m].ruleId && r.peer === peer.name));
  return {
    name: peer.name, kind: own ? "own" : "people", added: peer.added, safety: peer.safety,
    folderPath: peer.folder?.path, runsEverythingWithoutAsking: everything, perms,
  };
}

function tailLines(file: string): string[] {
  if (!existsSync(file)) return [];
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, LOG_TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    return len < size ? lines.slice(1) : lines;
  } finally { closeSync(fd); }
}

const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

function recentLog(): UiLogEntry[] {
  const out: UiLogEntry[] = [];
  for (const line of tailLines(p("log.jsonl")).slice(-LOG_ENTRIES).reverse()) {
    try {
      const e = JSON.parse(line) as Record<string, unknown>;
      out.push({
        at: text(e.at) ?? "", peer: text(e.peer), event: text(e.event) ?? "?", mode: text(e.mode),
        status: text(e.status) ?? text(e.decision) ?? text(e.reason),
      });
    } catch { /* skip a damaged line */ }
  }
  return out;
}

export function buildState(now = Date.now()): UiState {
  const me = loadIdentity();
  const cfg = loadConfig();
  const rules = loadRules();
  return {
    me: me && cfg ? { name: me.name, use: cfg.use ?? "people", files: cfg.files === true, relay: cfg.relay, agent: cfg.agent, listening: receiverPid() !== null } : null,
    peers: loadPeers().map((x) => peerView(x, rules, now)),
    rules: rules.map((r) => ({ ...r, expired: isExpired(r, now), command: `elefant-relay unrule ${r.id}` })),
    pending: listPending().map((x) => ({ id: x.id, peer: x.peer, mode: x.mode, text: x.text.slice(0, 1000), received: x.received })),
    log: recentLog(),
    now: new Date(now).toISOString(),
  };
}

function sameToken(given: string | null, token: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface UiServer { server: Server; port: number; token: string; url: string; close(): Promise<void> }

export function startUi(opts: { port?: number; token?: string } = {}): Promise<UiServer> {
  const token = opts.token ?? randomBytes(24).toString("hex");
  let port = 0;
  const send = (res: ServerResponse, status: number, type: string, body: string): void => {
    res.writeHead(status, {
      "Content-Type": `${type}; charset=utf-8`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(body);
  };
  const handle = (req: IncomingMessage, res: ServerResponse): void => {
    const host = req.headers.host;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) { send(res, 403, "text/plain", "forbidden"); return; }
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (!sameToken(url.searchParams.get("t"), token)) { send(res, 403, "text/plain", "forbidden"); return; }
    if (req.method !== "GET" && req.method !== "HEAD") { send(res, 405, "text/plain", "read-only"); return; }
    if (url.pathname === "/") { send(res, 200, "text/html", UI_HTML); return; }
    if (url.pathname === "/api/state") {
      try { send(res, 200, "application/json", JSON.stringify(buildState())); } catch (e) {
        send(res, 500, "application/json", JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
      }
      return;
    }
    send(res, 404, "text/plain", "not found");
  };
  const server = createServer(handle);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      port = (server.address() as AddressInfo).port;
      resolve({
        server, port, token, url: `http://127.0.0.1:${port}/?t=${token}`,
        close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }),
      });
    });
  });
}
