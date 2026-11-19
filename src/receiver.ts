import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { open, OpenError, seal, type Envelope, type Identity } from "./crypto.js";
import { connectBox, sendEnvelope, type BoxConnection } from "./relayClient.js";
import { finishInvites } from "./pair.js";
import { decide, setRule } from "./rules.js";
import { runAgent, redact } from "./agent.js";
import { appendLog, ensureDir, p, readJson, writeJson } from "./home.js";
import { boxId } from "./crypto.js";
import {
  listPending, loadConfig, loadIdentity, loadInstructions, loadPeers, loadPending, loadResult, newId, removePending, savePending, saveResult,
  seenBefore, pendingFile, type Config, type Mode, type Payload, type Peer, type Pending, type ResultRecord,
} from "./state.js";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const lockFile = (): string => p("receiver.pid");

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Pid of a running receiver, or null. */
export function receiverPid(): number | null {
  if (!existsSync(lockFile())) return null;
  const pid = Number(readFileSync(lockFile(), "utf8").trim());
  return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
}

/** What the running listener writes about itself, so `status` and `start` can tell what it is doing. */
export interface ListenerInfo {
  pid: number;
  /** "start" = a terminal, "mcp" = an AI session, "app" = the Mac app, "ask" = a short wait for a result */
  via: "start" | "mcp" | "app" | "ask";
  version: string;
  name: string;
  box: string;
  relay: string;
  connected: boolean;
  since: string;
  /** last heartbeat (ISO); older than ~30 s means the process is stuck */
  beat: string;
  /** messages from computers we are not paired with (dropped) */
  strangers: number;
}
export const VERSION = "0.2.0";
const infoFile = (): string => p("listener.json");

/** The running listener's own report, or null (no listener, or an older version that does not write one). */
export function listenerInfo(): ListenerInfo | null {
  const pid = receiverPid();
  if (pid === null) return null;
  const x = readJson<ListenerInfo | null>(infoFile(), null);
  return x && x.pid === pid ? x : null;
}

/** Exclusive lock: create the pid file with "wx"; clear it only if its owner is dead. */
function takeLock(): boolean {
  for (let i = 0; i < 2; i++) {
    try {
      ensureDir(p());
      writeFileSync(lockFile(), String(process.pid), { mode: 0o600, flag: "wx" });
      return true;
    } catch {
      const other = receiverPid();
      if (other !== null) return other === process.pid;
      try { unlinkSync(lockFile()); } catch { /* someone else cleared it */ }
    }
  }
  return false;
}

const MAX_RESULT_BYTES = 150_000; // keeps the sealed envelope under the relay's 256 KB

function capBytes(text: string, max: number): string {
  const b = Buffer.from(text, "utf8");
  if (b.length <= max) return text;
  return `${b.subarray(0, max).toString("utf8").replace(/\uFFFD+$/, "")}\n…(cut: the result was longer than ${Math.round(max / 1000)} KB)`;
}

export async function sendTo(me: Identity, peer: Peer, payload: Payload): Promise<void> {
  await sendEnvelope(peer.relay, peer.box, seal(me, peer.encPub, peer.box, payload));
}

export interface ReceiverOptions {
  me: Identity;
  cfg: Config;
  interactive: boolean;
  via?: ListenerInfo["via"];
  /** false = only collect results and invites; leave incoming tasks in the mailbox for a full receiver */
  runJobs?: boolean;
  log?: (s: string) => void;
}

export interface Receiver { close(): void }

/** A late or repeated status must never move a task backwards. */
const RANK: Record<ResultRecord["status"], number> = { sent: 0, "waiting-approval": 1, working: 2, completed: 3, failed: 3, rejected: 3 };

/**
 * Listen on our mailbox: run or queue incoming tasks, store incoming results,
 * finish open invites, and apply approvals made from the terminal, the CLI, or the AI.
 * Returns null if another receiver already runs for this ELEFANT_RELAY_HOME.
 */
export function startReceiver(o: ReceiverOptions): Receiver | null {
  if (!takeLock()) return null;
  const log = o.log ?? ((s: string) => process.stderr.write(`${s}\n`));
  // The setup can change while we run (setup again, a new relay, new keys): follow it instead of
  // listening on the old mailbox forever. Peers are read fresh for every message.
  let me = o.me;
  let cfg = o.cfg;
  const info: ListenerInfo = {
    pid: process.pid, via: o.via ?? (o.interactive ? "start" : "mcp"), version: VERSION, name: me.name, box: boxId(me.signPub),
    relay: cfg.relay, connected: false, since: new Date().toISOString(), beat: new Date().toISOString(), strangers: 0,
  };
  const writeInfo = (): void => { info.beat = new Date().toISOString(); try { writeJson(infoFile(), info); } catch { /* best effort */ } };
  writeInfo();
  /** peer count when we first held a stranger's message (-1 = none held) */
  let held = -1;
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>): void => { queue = queue.then(job, job); };
  let rl: Interface | null = null;
  const asked = new Set<string>();
  const promptQueue: Pending[] = [];
  let prompting = false;

  const peerByBox = (box: string): Peer | undefined => loadPeers().find((x) => x.box === box);
  const reply = (peer: Peer, payload: Payload): Promise<void> =>
    sendTo(me, peer, payload).catch((e: unknown) => log(`could not reply to ${peer.name}: ${e instanceof Error ? e.message : String(e)}`));

  const runJob = (peer: Peer, taskId: string, mode: Mode, text: string, how: string): void => {
    enqueue(async () => {
      log(`▶ working on ${peer.name}'s request (${mode}, ${how})`);
      await reply(peer, { type: "status", taskId, state: "working" });
      const r = await runAgent(cfg, me.name, peer.name, mode, text, loadInstructions())
        .catch((e: unknown) => ({ ok: false, text: e instanceof Error ? e.message : String(e) }));
      const clean = redact(r.text, [me.signPriv, me.encPriv]);
      const status = r.ok ? "completed" : "failed";
      try {
        await sendTo(me, peer, { type: "result", taskId, status, text: capBytes(clean.text, MAX_RESULT_BYTES) });
      } catch (e) {
        log(`could not send the result to ${peer.name}: ${e instanceof Error ? e.message : String(e)}`);
        await reply(peer, { type: "result", taskId, status: "failed", text: "The result could not be delivered (too large or relay error)." });
      }
      appendLog({ event: "done", peer: peer.name, task: taskId, mode, status: r.ok ? "completed" : "failed", redacted: clean.count });
      log(`${r.ok ? "✓" : "✗"} sent result to ${peer.name}${clean.count ? ` (${clean.count} secret(s) masked)` : ""}`);
    });
  };

  const applyDecision = (x: Pending): void => {
    const peer = loadPeers().find((q) => q.name === x.replyTo);
    removePending(x.id);
    asked.delete(x.id);
    if (!peer) return;
    if (x.decision === "always") setRule({ peer: peer.name, mode: x.mode, action: "allow", note: "approved with 'always'" });
    if (x.decision === "deny-always") setRule({ peer: peer.name, mode: x.mode, action: "deny", note: "denied with 'never'" });
    appendLog({ event: "decision", peer: peer.name, task: x.id, mode: x.mode, decision: x.decision });
    if (x.decision === "once" || x.decision === "always") runJob(peer, x.taskId, x.mode, x.text, x.decision);
    else {
      void reply(peer, { type: "result", taskId: x.taskId, status: "rejected", text: `${me.name} declined this request.` });
      log(`✗ declined ${peer.name}'s request`);
    }
  };

  const askNext = (): void => {
    if (!rl || prompting) return;
    const x = promptQueue.shift();
    if (!x) return;
    if (!existsSync(pendingFile(x.id))) { askNext(); return; }
    prompting = true;
    const preview = x.text.length > 600 ? `${x.text.slice(0, 600)}…` : x.text;
    process.stdout.write(`\n📨 ${x.peer} asks your AI (${x.mode === "read" ? "read only" : "may write files"}):\n${preview}\n`);
    rl.question(`   [y] once  [a] always allow ${x.peer}/${x.mode}  [n] no  [N] never  > `, (ans) => {
      prompting = false;
      const a = ans.trim();
      const decision = a === "a" ? "always" : a === "y" || a === "" ? "once" : a === "N" ? "deny-always" : "deny";
      const cur = loadPending(x.id);
      if (cur && cur.decision === undefined) applyDecision({ ...cur, decision });
      askNext();
    });
  };

  const onTask = (peer: Peer, payload: Extract<Payload, { type: "task" }>): void => {
    const t = payload.task;
    if (!ID_RE.test(t.id) || (t.mode !== "read" && t.mode !== "write")) return;
    // a task id can be used once per peer: a second message with the same id cannot swap what gets approved
    if (seenBefore(`task:${peer.box}:${t.id}`, Math.floor(Date.now() / 1000) + 30 * 86400)) {
      appendLog({ event: "drop", peer: peer.name, task: t.id, reason: "duplicate task id" });
      return;
    }
    const text = (t.message?.parts ?? []).filter((x) => x.kind === "text").map((x) => String(x.text)).join("\n").slice(0, 100_000);
    const d = decide(peer.name, t.mode);
    appendLog({ event: "task", peer: peer.name, task: t.id, mode: t.mode, decision: d.action, rule: d.rule?.id });
    if (d.action === "allow") { runJob(peer, t.id, t.mode, text, `rule ${d.rule?.id}`); return; }
    if (d.action === "deny") {
      void reply(peer, { type: "result", taskId: t.id, status: "rejected", text: `${me.name}'s rules decline this request.` });
      log(`✗ declined ${peer.name}'s request by rule`);
      return;
    }
    const x: Pending = { id: newId(), taskId: t.id, peer: peer.name, mode: t.mode, text, received: new Date().toISOString(), replyTo: peer.name };
    savePending(x);
    void reply(peer, { type: "status", taskId: t.id, state: "waiting-approval" });
    log(`⏳ ${peer.name} sent a request — waiting for your OK (elefant-relay pending)`);
    if (rl) { asked.add(x.id); promptQueue.push(x); askNext(); }
  };

  const onResult = (peer: Peer, payload: Payload): void => {
    if (payload.type !== "result" && payload.type !== "status") return;
    const mine = loadResult(payload.taskId);
    if (!mine || mine.peer !== peer.name) return; // only for tasks we sent to this peer
    const next = payload.type === "status" ? payload.state : payload.status;
    if (RANK[next] === undefined || RANK[next] <= RANK[mine.status]) return;
    if (payload.type === "status") saveResult({ ...mine, status: payload.state, updated: new Date().toISOString() });
    else {
      saveResult({ ...mine, status: payload.status, text: payload.text, updated: new Date().toISOString() });
      log(`📬 result from ${peer.name}: ${payload.status}`);
    }
  };

  const onEnvelope = async (env: Envelope): Promise<boolean> => {
    const peer = peerByBox(env.h?.from ?? "");
    if (!peer) {
      // Right after pairing the other side may write before we have saved them: while an invite of ours
      // is open, leave the message in the mailbox (it is delivered again once the pairing is saved).
      if (openInvites()) { if (held < 0) held = loadPeers().length; return false; }
      info.strangers++;
      writeInfo();
      appendLog({ event: "drop", reason: "unknown sender" });
      return true;
    }
    let payload: Payload;
    try { payload = open(me, peer.signPub, env) as Payload; } catch (e) {
      appendLog({ event: "drop", peer: peer.name, reason: e instanceof OpenError ? e.message : "error" });
      return true;
    }
    if (payload.type === "task" && o.runJobs === false) return false;
    if (seenBefore(env.h.id, env.h.exp)) { appendLog({ event: "drop", peer: peer.name, reason: "replay" }); return true; }
    if (payload.type === "task") onTask(peer, payload);
    else onResult(peer, payload);
    return true;
  };

  const onState = (up: boolean): void => { info.connected = up; writeInfo(); };
  let conn: BoxConnection = connectBox(cfg.relay, me, onEnvelope, log, onState);
  const reconnect = (why: string): void => {
    conn.close();
    info.connected = false;
    info.name = me.name; info.box = boxId(me.signPub); info.relay = cfg.relay;
    writeInfo();
    if (why) log(why);
    conn = connectBox(cfg.relay, me, onEnvelope, log, onState);
  };
  let beat = 0;
  if (o.interactive && process.stdin.isTTY) rl = createInterface({ input: process.stdin, output: process.stdout });

  // pick up approvals from the CLI or the AI, and invites answered by the other side
  const tick = setInterval(() => {
    try {
      const m2 = loadIdentity();
      const c2 = loadConfig();
      if (m2 && c2) {
        const moved = m2.signPub !== me.signPub || c2.relay !== cfg.relay;
        me = m2;
        cfg = c2;
        if (moved) reconnect(`setup changed — now listening as ${me.name} via ${cfg.relay}`);
        else if (info.name !== me.name) { info.name = me.name; writeInfo(); }
      }
    } catch { /* a half-written file: try again next tick */ }
    if (++beat % 5 === 0) writeInfo();
    // a held message: deliver it again once someone new is paired (or once no invite is open, so it gets dropped)
    if (held >= 0 && (loadPeers().length !== held || !openInvites())) { held = -1; reconnect(""); }
    for (const x of listPendingDecided()) applyDecision(x);
    if (rl) for (const x of listPending()) if (!asked.has(x.id)) { asked.add(x.id); promptQueue.push(x); askNext(); }
    if (readJson<unknown[]>(p("invites.json"), []).length > 0) {
      finishInvites(me, loadConfig() ?? cfg).then((added) => {
        for (const x of added) log(`🤝 paired with ${x.peer.name} — check number ${x.peer.safety}${x.note ? `\n${x.note}` : ""}`);
        // pick up anything the new peer sent before we had saved them
        if (added.length) reconnect("");
      }).catch(() => { /* retry next tick */ });
    }
  }, 1000);

  return {
    close: () => {
      clearInterval(tick);
      conn.close();
      rl?.close();
      if (receiverPid() === process.pid) {
        try { unlinkSync(infoFile()); } catch { /* already gone */ }
        unlinkSync(lockFile());
      }
    },
  };
}

/** One of our invites is still open (not answered, not expired). */
function openInvites(): boolean {
  return readJson<{ created: number }[]>(p("invites.json"), []).some((i) => Date.now() - i.created < 600_000);
}

function listPendingDecided(): Pending[] {
  const dir = p("pending");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson<Pending | null>(p("pending", f), null))
    .filter((x): x is Pending => x !== null && x.decision !== undefined);
}

