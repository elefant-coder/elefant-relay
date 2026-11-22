import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startLocalRelay } from "./localRelay.js";

// What went wrong on 2026-11-19: a listener started from an older setup kept listening on the old
// mailbox, so a friend's request was never picked up and nobody could see why.

const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "src", "cli.js");
const agent = `"${process.execPath}" "${join(root, "test", "fixtures", "echo-agent.mjs")}"`;
const home = (n: string): string => mkdtempSync(join(tmpdir(), `elefant-relay-${n}-`));
const C = home("carol");
const D = home("dave");
const E = home("erin");
const F = home("fred");
const relays: string[] = [];
const procs: ChildProcess[] = [];

const env = (h: string): NodeJS.ProcessEnv => ({ ...process.env, ELEFANT_RELAY_HOME: h, ELEFANT_RELAY_URL: "" });
const run = (h: string, ...args: string[]): { code: number; out: string } => {
  const r = spawnSync(process.execPath, [cli, ...args], { env: env(h), encoding: "utf8", timeout: 60_000 });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};
const json = <T,>(h: string, f: string): T => JSON.parse(readFileSync(join(h, f), "utf8")) as T;
const until = async (fn: () => boolean, ms = 15_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 200)); }
};
const daemon = (h: string): ChildProcess => {
  const c = spawn(process.execPath, [cli, "start"], { env: env(h), stdio: ["ignore", "pipe", "pipe"] });
  procs.push(c);
  return c;
};
const setupArgs = (relay: string, name: string): string[] =>
  ["setup", "--relay", relay, "--name", name, "--agent", "command", "--command", agent, "--no-register", "--people", "--no-files"];
const codeOf = (out: string): string => {
  const c = out.match(/([2-9A-Z]{3}-[2-9A-Z]{3}@\S+)/)?.[1];
  assert.ok(c, out);
  return c;
};

before(async () => {
  for (let i = 0; i < 2; i++) {
    const { proc: rp, url } = await startLocalRelay(cli);
    procs.push(rp);
    relays.push(url);
  }
});

after(() => { for (const c of procs) c.kill(); });

test("a listener started on an old setup follows a new relay, and the request arrives", async () => {
  const [old, cur] = relays as [string, string];
  assert.equal(run(D, ...setupArgs(old, "dave")).code, 0);
  daemon(D);
  await until(() => existsSync(join(D, "listener.json")) && json<{ connected: boolean }>(D, "listener.json").connected);
  // dave sets up again with another relay while the old listener keeps running
  const re = run(D, ...setupArgs(cur, "dave"));
  assert.match(re.out, /relay changed/);
  await until(() => json<{ relay: string; connected: boolean }>(D, "listener.json").relay === cur
    && json<{ connected: boolean }>(D, "listener.json").connected);
  assert.equal(run(C, ...setupArgs(cur, "carol")).code, 0);
  const code = codeOf(run(C, "invite", "--no-wait").out);
  assert.equal(run(D, "join", code).code, 0);
  run(C, "ask", "dave", "are you there", "--wait", "2");
  await until(() => run(D, "pending").out.includes("are you there"));
});

test("status says where the listener runs and whether it is connected", () => {
  const s = run(D, "status").out;
  assert.match(s, /listening in a terminal/);
  assert.match(s, /connected/);
  assert.match(s, /1 request\(s\) waiting/);
});

test("the sender sees 'waiting for OK' after the fact, even when it was not listening", async () => {
  const sent = run(C, "ask", "dave", "second one", "--wait", "0").out;
  const id = sent.match(/task ([0-9a-f]{16})/)?.[1];
  assert.ok(id, sent);
  await until(() => run(D, "pending").out.includes("second one"));
  // nobody listens on carol's side now: `result` collects what is waiting in the relay
  const r = run(C, "result", id);
  assert.match(r.out, /waiting for dave's OK/, r.out);
});

test("new keys (setup --force) are followed too", async () => {
  const before = json<{ box: string }>(D, "listener.json").box;
  assert.equal(run(D, ...setupArgs(relays[1]!, "dave"), "--force").code, 0);
  await until(() => json<{ box: string }>(D, "listener.json").box !== before);
});

test("the AI app's listener stops when the app goes away, and frees the mailbox", async () => {
  assert.equal(run(E, ...setupArgs(relays[1]!, "erin")).code, 0);
  const m = spawn(process.execPath, [cli, "mcp"], { env: env(E), stdio: ["pipe", "pipe", "pipe"] });
  procs.push(m);
  await until(() => existsSync(join(E, "listener.json")) && json<{ via: string }>(E, "listener.json").via === "mcp");
  // `start` while the AI app listens: not an error, it points at the running one
  const s = run(E, "start");
  assert.equal(s.code, 0, s.out);
  assert.match(s.out, /already listening in your AI app/);
  const exited = new Promise<number | null>((res) => m.on("exit", (c) => res(c)));
  m.stdin!.end();
  assert.equal(await Promise.race([exited, new Promise((r) => setTimeout(() => r("still running"), 5000))]), 0);
  assert.equal(existsSync(join(E, "receiver.pid")), false);
  assert.match(run(E, "status").out, /not listening/);
});

test("one line to join: a fresh computer is set up from the code, and an early request is not lost", async () => {
  const code = codeOf(run(C, "invite", "--no-wait").out);
  const j = run(F, "join", code, "--name", "fred", "--agent", "command", "--command", agent, "--no-register");
  assert.equal(j.code, 0, j.out);
  assert.match(j.out, /ready as "fred"/);
  assert.equal(json<{ relay: string }>(F, "config.json").relay, relays[1]);
  // fred writes right away, before carol has saved the pairing: carol's listener starts with fred's
  // message already in the mailbox and an invite still open — it must keep the message, not drop it
  run(F, "ask", "carol", "early hello", "--wait", "0");
  daemon(C);
  await until(() => run(C, "pending").out.includes("early hello"));
  assert.equal(json<{ strangers: number }>(C, "listener.json").strangers, 0);
});

test("setup --name renames without new keys", () => {
  const box = json<{ signPub: string }>(F, "identity.json").signPub;
  assert.match(run(F, "setup", "--name", "Fred-Y", "--no-register").out, /renamed to "Fred-Y"/);
  const id = json<{ name: string; signPub: string }>(F, "identity.json");
  assert.equal(id.name, "Fred-Y");
  assert.equal(id.signPub, box);
});
