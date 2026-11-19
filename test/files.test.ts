import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Two throwaway Syncthing instances on loopback (no discovery, no relays, no NAT).
// They never touch the Syncthing that may already run on this machine (GUI 8384 / port 22000).
const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "src", "cli.js");
const hasSyncthing = spawnSync("syncthing", ["--version"], { stdio: "ignore" }).status === 0;
const procs: ChildProcess[] = [];
const port = (): number => 30000 + Math.floor(Math.random() * 20000);

interface St { home: string; url: string; key: string; listen: number; id: string }
const sts: St[] = [];
const relay = { url: "" };

async function http<T>(st: St, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${st.url}${path}`, { method, headers: { "X-API-Key": st.key, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}`);
  const t = await r.text();
  return (t ? JSON.parse(t) : null) as T;
}

async function startSyncthing(): Promise<St> {
  const home = mkdtempSync(join(tmpdir(), "elefant-relay-st-"));
  assert.equal(spawnSync("syncthing", ["generate", "--home", home, "--no-port-probing"], { stdio: "ignore" }).status, 0);
  const gui = port();
  const listen = port();
  assert.notEqual(gui, 8384);
  const key = randomBytes(16).toString("hex");
  const f = join(home, "config.xml");
  let xml = readFileSync(f, "utf8");
  xml = xml.replace(/(<listenAddress>[^<]*<\/listenAddress>\s*)+/, `<listenAddress>tcp://127.0.0.1:${listen}</listenAddress>\n        `)
    .replace(/<globalAnnounceEnabled>true/, "<globalAnnounceEnabled>false").replace(/<localAnnounceEnabled>true/, "<localAnnounceEnabled>false")
    .replace(/<relaysEnabled>true/, "<relaysEnabled>false").replace(/<natEnabled>true/, "<natEnabled>false")
    .replace(/<startBrowser>true/, "<startBrowser>false").replace(/<urAccepted>0/, "<urAccepted>-1")
    .replace(/<crashReportingEnabled>true/, "<crashReportingEnabled>false");
  writeFileSync(f, xml);
  const url = `http://127.0.0.1:${gui}`;
  const c = spawn("syncthing", ["serve", "--home", home, "--no-browser", "--no-upgrade", "--no-restart", "--gui-address", url, "--gui-apikey", key],
    { stdio: "ignore" });
  procs.push(c);
  const st: St = { home, url, key, listen, id: "" };
  const end = Date.now() + 30_000;
  for (;;) {
    try { st.id = (await http<{ myID: string }>(st, "GET", "/rest/system/status")).myID; break; } catch { /* starting */ }
    if (Date.now() > end) throw new Error("syncthing did not start");
    await new Promise((r) => setTimeout(r, 300));
  }
  return st;
}

const env = (home: string, st: St): NodeJS.ProcessEnv => ({ ...process.env, ELEFANT_RELAY_HOME: home, ELEFANT_RELAY_SYNCTHING_URL: st.url, ELEFANT_RELAY_SYNCTHING_KEY: st.key });
const run = (home: string, st: St, ...args: string[]): { code: number; out: string } => {
  const r = spawnSync(process.execPath, [cli, ...args], { env: env(home, st), encoding: "utf8", timeout: 60_000 });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};
const json = <T,>(home: string, f: string): T => JSON.parse(readFileSync(join(home, f), "utf8")) as T;
const sha = (f: string): string => createHash("sha256").update(readFileSync(f)).digest("hex");
const until = async (fn: () => boolean | Promise<boolean>, ms = 60_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!(await fn())) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 500)); }
};
interface PeerRec { name: string; kind?: string; device?: string; folder?: { id: string; path: string } }

function setupPair(stA: St, stB: St, flagA: string, flagB: string): { A: string; B: string; SA: string; SB: string } {
  const A = mkdtempSync(join(tmpdir(), "elefant-relay-fa-"));
  const B = mkdtempSync(join(tmpdir(), "elefant-relay-fb-"));
  const SA = mkdtempSync(join(tmpdir(), "elefant-relay-share-a-"));
  const SB = mkdtempSync(join(tmpdir(), "elefant-relay-share-b-"));
  for (const [home, st, name, flag, share] of [[A, stA, "alice", flagA, SA], [B, stB, "bob", flagB, SB]] as const) {
    const r = run(home, st, "setup", "--relay", relay.url, "--name", name, flag, "--files", "--share-dir", share,
      "--agent", "command", "--command", "cat", "--no-register");
    assert.equal(r.code, 0, r.out);
  }
  return { A, B, SA, SB };
}

function pair(A: string, B: string, stA: St, stB: St): void {
  const inv = run(A, stA, "invite", "--no-wait");
  const code = inv.out.match(/([2-9A-Z]{3}-[2-9A-Z]{3}@\S+)/)?.[1];
  assert.ok(code, inv.out);
  assert.match(inv.out, /Connection code|Code for your other computer/);
  const j = run(B, stB, "join", code);
  assert.equal(j.code, 0, j.out);
  assert.match(j.out, /files: .* is shared with alice/);
}

before(async () => {
  if (!hasSyncthing) return;
  const p = port();
  const rp = spawn(process.execPath, [cli, "relay", "local", "--port", String(p)], { stdio: ["ignore", "pipe", "ignore"] });
  procs.push(rp);
  await new Promise<void>((res) => rp.stdout!.on("data", (d: Buffer) => { if (d.toString().includes("listening")) res(); }));
  relay.url = `http://127.0.0.1:${p}`;
  sts.push(await startSyncthing(), await startSyncthing());
});

after(() => { for (const c of procs) c.kill(); });

test("files: pairing with someone shares one folder, and a file goes both ways byte for byte", { skip: !hasSyncthing && "syncthing not installed" }, async () => {
  const [stA, stB] = sts as [St, St];
  const { A, B, SA, SB } = setupPair(stA, stB, "--people", "--people");
  pair(A, B, stA, stB);
  // the inviter finishes pairing when its receiver notices the answer
  const d = spawn(process.execPath, [cli, "start"], { env: env(A, stA), stdio: "ignore" });
  procs.push(d);
  await until(() => existsSync(join(A, "peers.json")) && json<PeerRec[]>(A, "peers.json")[0]?.folder !== undefined, 20_000);
  const pa = json<PeerRec[]>(A, "peers.json")[0]!;
  const pb = json<PeerRec[]>(B, "peers.json")[0]!;
  assert.equal(pa.kind, "people");
  assert.equal(pa.device, stB.id);
  assert.equal(pb.device, stA.id);
  assert.equal(pa.folder!.id, pb.folder!.id, "both sides use the same folder id");
  assert.equal(pa.folder!.path, join(SA, "bob"));
  assert.equal(pb.folder!.path, join(SB, "alice"));
  // test only: no discovery here, so tell each Syncthing where the other listens
  await http(stA, "PATCH", `/rest/config/devices/${stB.id}`, { addresses: [`tcp://127.0.0.1:${stB.listen}`] });
  await http(stB, "PATCH", `/rest/config/devices/${stA.id}`, { addresses: [`tcp://127.0.0.1:${stA.listen}`] });

  const src = join(mkdtempSync(join(tmpdir(), "elefant-relay-src-")), "report.bin");
  writeFileSync(src, randomBytes(300_000));
  const s = run(A, stA, "send", "bob", src);
  assert.equal(s.code, 0, s.out);
  await until(() => existsSync(join(SB, "alice", "report.bin")) && sha(join(SB, "alice", "report.bin")) === sha(src));

  const back = join(mkdtempSync(join(tmpdir(), "elefant-relay-src-")), "answer.txt");
  writeFileSync(back, "from bob\n");
  assert.equal(run(B, stB, "send", "alice", back).code, 0);
  await until(() => existsSync(join(SA, "bob", "answer.txt")) && readFileSync(join(SA, "bob", "answer.txt"), "utf8") === "from bob\n");
  await until(() => run(A, stA, "files", "bob").out.includes("in sync"), 30_000);
  const list = run(A, stA, "files", "bob").out;
  assert.match(list, /report\.bin/);
  assert.match(list, /answer\.txt/);

  // keys and settings can never be sent
  const bad = run(A, stA, "send", "bob", join(A, "identity.json"));
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /cannot be sent/);
});

// answers prompts in a real pseudo-terminal (what a person at the keyboard would see)
const PTY = `
import os, pty, select, sys, time, json
args, answers = json.loads(sys.argv[1]), json.loads(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    os.execvp(args[0], args)
out = b""; i = 0; end = time.time() + 60
while time.time() < end:
    r, _, _ = select.select([fd], [], [], 0.2)
    if not r: continue
    try: d = os.read(fd, 4096)
    except OSError: break
    if not d: break
    out += d
    if i < len(answers) and answers[i][0].encode() in out.split(b"\\n")[-1] + out[-200:]:
        os.write(fd, (answers[i][1] + "\\n").encode()); i += 1
_, st = os.waitpid(pid, 0)
sys.stdout.write(out.decode(errors="replace"))
sys.exit(os.WEXITSTATUS(st))
`;
const runTty = (home: string, st: St, answers: [string, string][], ...args: string[]): { code: number; out: string } => {
  const r = spawnSync("python3", ["-c", PTY, JSON.stringify([process.execPath, cli, ...args]), JSON.stringify(answers)], { env: env(home, st), encoding: "utf8", timeout: 90_000 });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
};

test("files: own computers — 'My computers' is shared only after the check number is confirmed", { skip: !hasSyncthing && "syncthing not installed" }, async () => {
  const [stA, stB] = sts as [St, St];
  const { A, B, SA, SB } = setupPair(stA, stB, "--own", "--own");
  // A has a receiver running AND waits in `invite`: either may finish the pairing; invite must still report it
  procs.push(spawn(process.execPath, [cli, "start"], { env: env(A, stA), stdio: "ignore" }));
  const inv = spawn(process.execPath, [cli, "invite"], { env: env(A, stA), stdio: ["ignore", "pipe", "pipe"] });
  procs.push(inv);
  let invOut = "";
  inv.stdout!.on("data", (d: Buffer) => { invOut += d.toString(); });
  const invDone = new Promise<number>((res) => inv.on("exit", (c) => res(c ?? -1)));
  await until(() => /[2-9A-Z]{3}-[2-9A-Z]{3}@\S+/.test(invOut), 15_000);
  const code = invOut.match(/([2-9A-Z]{3}-[2-9A-Z]{3}@\S+)/)![1]!;
  assert.match(invOut, /Code for your other computer/);

  // B answers "y" at the keyboard after comparing the check number
  const j = runTty(B, stB, [["[y/N]", "y"]], "join", code, "--no-listen");
  assert.equal(j.code, 0, j.out);
  assert.match(j.out, /Does the other screen show \d{6}/);
  assert.match(j.out, /can run requests here without asking/);
  const own = json<{ ownFolder?: string }>(A, "config.json").ownFolder!;
  assert.match(own, /^relay-own-/);
  const rb = json<{ rules: { peer: string; mode: string; action: string }[] }>(B, "rules.json").rules;
  assert.deepEqual(rb.map((r) => [r.peer, r.mode, r.action]), [["alice", "*", "allow"]]);
  assert.equal(json<PeerRec[]>(B, "peers.json")[0]!.folder!.id, own);
  assert.equal(json<PeerRec[]>(B, "peers.json")[0]!.folder!.path, join(SB, "My computers"));

  // A's `invite` saw the pairing (not a 10-minute wait) and, without a terminal, did NOT trust or share yet
  assert.equal(await invDone, 0, invOut);
  assert.match(invOut, /paired with bob \(your computer\)/);
  assert.match(invOut, /elefant-relay confirm bob/);
  const pa = json<(PeerRec & { ownOffer?: string })[]>(A, "peers.json")[0]!;
  assert.equal(pa.folder, undefined, "no 'My computers' before confirmation");
  assert.equal(pa.ownOffer, own);
  assert.equal(existsSync(join(A, "rules.json")) ? json<{ rules: unknown[] }>(A, "rules.json").rules.length : 0, 0);

  // A confirms → rule + shared folder, and a file reaches B's "My computers"
  const c = run(A, stA, "confirm", "bob");
  assert.equal(c.code, 0, c.out);
  assert.equal(json<PeerRec[]>(A, "peers.json")[0]!.folder!.id, own);
  const src = join(mkdtempSync(join(tmpdir(), "elefant-relay-src-")), "notes.txt");
  writeFileSync(src, "same on every computer\n");
  assert.equal(run(A, stA, "send", "bob", src).code, 0);
  await until(() => existsSync(join(SB, "My computers", "notes.txt")) && sha(join(SB, "My computers", "notes.txt")) === sha(src));
  assert.ok(existsSync(join(SA, "My computers", "notes.txt")));
});

test("files: the inviter's 'own' choice cannot make the joiner treat it as their own computer", { skip: !hasSyncthing && "syncthing not installed" }, async () => {
  const [stA, stB] = sts as [St, St];
  const { A, B } = setupPair(stA, stB, "--own", "--people");
  pair(A, B, stA, stB);
  const pb = json<PeerRec[]>(B, "peers.json")[0]!;
  assert.equal(pb.kind, "people");
  assert.doesNotMatch(pb.folder!.id, /^relay-own-/, "a person gets a two-person folder, not the inviter's 'My computers'");
  const d = spawn(process.execPath, [cli, "start"], { env: env(A, stA), stdio: "ignore" });
  procs.push(d);
  await until(() => existsSync(join(A, "peers.json")) && json<PeerRec[]>(A, "peers.json")[0]?.folder !== undefined, 20_000);
  assert.equal(json<PeerRec[]>(A, "peers.json")[0]!.folder!.id, pb.folder!.id, "both sides fall back to the same two-person folder");
});
