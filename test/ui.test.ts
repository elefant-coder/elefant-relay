import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "elefant-relay-ui-"));
process.env.ELEFANT_RELAY_HOME = dir;

const { writeJson, writeText } = await import("../src/home.js");
const { startUi } = await import("../src/ui.js");
type UiServer = Awaited<ReturnType<typeof startUi>>;
type UiState = import("../src/ui.js").UiState;

const day = 86_400_000;
const future = new Date(Date.now() + 30 * day).toISOString();
const past = new Date(Date.now() - day).toISOString();
const peer = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ name, box: `box-${name}`, signPub: "s", encPub: "e", relay: "http://r", safety: "123456", added: "2026-11-01T00:00:00.000Z", ...extra });
const rule = (id: string, p: string, mode: string, action: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id, peer: p, mode, action, created: "2026-11-01T00:00:00.000Z", ...extra });

let ui: UiServer;

before(async () => {
  writeJson(join(dir, "identity.json"), { name: "me", box: "b", signPub: "s", signPriv: "x", encPub: "e", encPriv: "y" });
  writeJson(join(dir, "config.json"), { relay: "http://relay.example", agent: "claude", use: "people", files: true });
  writeJson(join(dir, "peers.json"), [
    peer("alice"),
    peer("bob"),
    peer("carol"),
    peer("dave"),
    peer("laptop", { kind: "own", folder: { id: "f", path: "/home/me/Relay/My computers" } }),
  ]);
  writeJson(join(dir, "rules.json"), {
    rules: [
      rule("r-alice", "alice", "read", "allow", { until: future, note: "for the week" }),
      rule("r-bob", "bob", "write", "deny"),
      rule("r-star", "*", "read", "allow"),
      rule("r-dave", "dave", "write", "allow", { until: past }),
      rule("r-laptop", "laptop", "*", "allow", { note: "my own computer (check number confirmed)" }),
    ],
  });
  writeJson(join(dir, "pending", "p1.json"), { id: "p1", taskId: "t1", peer: "carol", mode: "write", text: "<img src=x onerror=alert(1)>", received: "2026-11-17T00:00:00.000Z", replyTo: "carol" });
  writeText(join(dir, "log.jsonl"), `${JSON.stringify({ at: "2026-11-17T01:00:00.000Z", event: "task", peer: "alice", mode: "read", decision: "allow" })}\nnot json\n`);
  ui = await startUi();
});

after(async () => {
  await ui.close();
  rmSync(dir, { recursive: true, force: true });
});

function get(path: string, host = `127.0.0.1:${ui.port}`, method = "GET"): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: ui.port, path, method, headers: { Host: host } }, (res) => {
      let body = "";
      res.on("data", (c: Buffer) => { body += c.toString(); });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("ui: a request without the token, or with a wrong one, gets 403", async () => {
  assert.equal((await get("/")).status, 403);
  assert.equal((await get("/api/state")).status, 403);
  assert.equal((await get("/api/state?t=nope")).status, 403);
  assert.equal((await get(`/api/state?t=${ui.token}x`)).status, 403);
});

test("ui: a wrong Host header is rejected even with the token", async () => {
  assert.equal((await get(`/api/state?t=${ui.token}`, "evil.example")).status, 403);
  assert.equal((await get(`/api/state?t=${ui.token}`, `evil.example:${ui.port}`)).status, 403);
  assert.equal((await get(`/api/state?t=${ui.token}`, `localhost:${ui.port}`)).status, 200);
});

test("ui: read-only, and the page is served with a strict policy", async () => {
  assert.equal((await get(`/api/state?t=${ui.token}`, undefined, "POST")).status, 405);
  const page = await get(`/?t=${ui.token}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /<html/);
  assert.match(String(page.headers["content-security-policy"]), /default-src 'none'/);
  assert.ok(!/innerHTML/.test(page.body));
});

test("ui: /api/state shows the effective permission of every peer", async () => {
  const r = await get(`/api/state?t=${ui.token}`);
  assert.equal(r.status, 200);
  const s = JSON.parse(r.body) as UiState;
  const by = (n: string) => s.peers.find((x) => x.name === n)!;

  const alice = by("alice");
  assert.equal(alice.perms.read.action, "allow");
  assert.equal(alice.perms.read.ruleId, "r-alice");
  assert.equal(alice.perms.read.until, future);
  assert.equal(alice.perms.write.action, "ask");
  assert.equal(alice.runsEverythingWithoutAsking, false);

  const bob = by("bob");
  assert.equal(bob.perms.write.action, "deny");
  assert.equal(bob.perms.write.ruleId, "r-bob");
  assert.equal(bob.perms.read.action, "allow");
  assert.equal(bob.perms.read.ruleId, "r-star");

  const carol = by("carol");
  assert.equal(carol.perms.read.action, "allow");
  assert.equal(carol.perms.read.ruleLabel, "*/read");
  assert.equal(carol.perms.write.action, "ask");

  const dave = by("dave");
  assert.equal(dave.perms.write.action, "ask");
  assert.equal(dave.perms.write.ruleId, undefined);
  assert.equal(dave.perms.write.expiredRuleId, "r-dave");

  const laptop = by("laptop");
  assert.equal(laptop.kind, "own");
  assert.equal(laptop.perms.read.action, "allow");
  assert.equal(laptop.perms.write.action, "allow");
  assert.equal(laptop.perms.write.ruleId, "r-laptop");
  assert.equal(laptop.runsEverythingWithoutAsking, true);
  assert.equal(laptop.folderPath, "/home/me/Relay/My computers");
});

test("ui: /api/state lists rules, pending requests, the log, and who I am", async () => {
  const s = JSON.parse((await get(`/api/state?t=${ui.token}`)).body) as UiState;
  assert.equal(s.me?.name, "me");
  assert.equal(s.me?.files, true);
  assert.equal(s.me?.listening, false);
  const expired = s.rules.find((x) => x.id === "r-dave")!;
  assert.equal(expired.expired, true);
  assert.equal(expired.command, "elefant-relay unrule r-dave");
  assert.equal(s.rules.find((x) => x.id === "r-alice")!.expired, false);
  assert.equal(s.pending.length, 1);
  assert.equal(s.pending[0]!.peer, "carol");
  assert.equal(s.log.length, 1);
  assert.equal(s.log[0]!.status, "allow");
});
