import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newIdentity, seal, open, boxId, newCode, pairSeal, pairOpen, pairSlot, safetyNumber, normCode, type Envelope } from "../src/crypto.js";
import { decide } from "../src/rules.js";
import { redact } from "../src/agent.js";
import type { Rule } from "../src/state.js";

process.env.ELEFANT_RELAY_HOME = mkdtempSync(join(tmpdir(), "elefant-relay-unit-"));

test("seal/open round trip, and only the right person can open it", () => {
  const a = newIdentity("alice"), b = newIdentity("bob"), c = newIdentity("carol");
  const env = seal(a, b.encPub, boxId(b.signPub), { hello: "world" });
  assert.deepEqual(open(b, a.signPub, env), { hello: "world" });
  assert.throws(() => open(c, a.signPub, env), /not addressed/);
  assert.throws(() => open(b, c.signPub, env), /sender mismatch/);
});

test("tampering is detected", () => {
  const a = newIdentity("alice"), b = newIdentity("bob");
  const env = seal(a, b.encPub, boxId(b.signPub), { x: 1 });
  const ct = Buffer.from(env.ct, "base64url"); ct[0] = ct[0]! ^ 1;
  assert.throws(() => open(b, a.signPub, { ...env, ct: ct.toString("base64url") }), /bad signature/);
  assert.throws(() => open(b, a.signPub, { ...env, h: { ...env.h, exp: env.h.exp + 999 } }), /bad signature/);
  // a forger without alice's key cannot produce a valid signature
  const mallory = newIdentity("alice");
  const forged: Envelope = { ...seal(mallory, b.encPub, boxId(b.signPub), { x: 2 }) };
  forged.h = { ...forged.h, from: boxId(a.signPub) };
  assert.throws(() => open(b, a.signPub, forged), /bad signature/);
});

test("expired envelopes are refused", () => {
  const a = newIdentity("alice"), b = newIdentity("bob");
  const env = seal(a, b.encPub, boxId(b.signPub), { x: 1 }, -10);
  assert.throws(() => open(b, a.signPub, env), /expired/);
});

test("pairing blob opens only with the same code", () => {
  const code = newCode();
  assert.match(code, /^[2-9A-Z]{3}-[2-9A-Z]{3}$/);
  const blob = pairSeal(code, { name: "alice" });
  assert.deepEqual(pairOpen(code.toLowerCase().replace("-", " "), blob), { name: "alice" });
  assert.equal(pairSlot(code), pairSlot(normCode(code.toLowerCase())));
  assert.throws(() => pairOpen(newCode(), blob));
});

test("safety number is the same on both sides", () => {
  const a = newIdentity("a"), b = newIdentity("b");
  assert.equal(safetyNumber(a.signPub, b.signPub), safetyNumber(b.signPub, a.signPub));
  assert.match(safetyNumber(a.signPub, b.signPub), /^\d{6}$/);
});

test("rules: most specific wins, deny wins ties, expired rules are ignored", () => {
  const r = (x: Partial<Rule>): Rule => ({ id: Math.random().toString(36), peer: "*", mode: "*", action: "allow", created: "", ...x });
  assert.equal(decide("bob", "read", []).action, "ask");
  assert.equal(decide("bob", "read", [r({ peer: "bob", mode: "read" })]).action, "allow");
  assert.equal(decide("bob", "write", [r({ peer: "bob", mode: "read" })]).action, "ask");
  assert.equal(decide("bob", "read", [r({ action: "deny" }), r({ peer: "bob" })]).action, "allow");
  assert.equal(decide("bob", "read", [r({ peer: "bob", action: "deny" }), r({ peer: "bob" })]).action, "deny");
  assert.equal(decide("bob", "read", [r({ peer: "bob", until: "2000-01-01T00:00:00Z" })]).action, "ask");
  assert.equal(decide("bob", "read", [r({ peer: "bob", until: "2999-01-01T00:00:00Z" })]).action, "allow");
});

test("obvious secrets are masked", () => {
  const t = "a sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX and ghp_abcdefghijklmnopqrstuvwxyz0123456789 and AKIAABCDEFGHIJKLMNOP";
  const r = redact(t);
  assert.equal(r.count, 3);
  assert.doesNotMatch(r.text, /sk-ant|ghp_|AKIA/);
});

test("review fix: work folder never leaves the base, even for a peer named '..'", async () => {
  const { workFolder } = await import("../src/agent.js");
  const base = mkdtempSync(join(tmpdir(), "elefant-relay-wf-"));
  const cfg = { relay: "x", agent: "command" as const, workdir: base };
  for (const name of ["..", "../..", "a/../../b", ".", "", "C:\\x"]) {
    const d = workFolder(cfg, name);
    assert.ok(d.startsWith(base + (process.platform === "win32" ? "\\" : "/")), `${name} -> ${d}`);
  }
});

test("review fix: our own private keys are masked if they ever appear in a result", () => {
  const me = newIdentity("me");
  const r = redact(`here: ${me.signPriv} and ${me.encPriv}`, [me.signPriv, me.encPriv]);
  assert.doesNotMatch(r.text, new RegExp(me.signPriv.slice(0, 20).replace(/[-]/g, "\\-")));
  assert.equal(r.count >= 2, true);
});

test("review fix: Codex jobs switch elefant-relay off only when it is registered", async () => {
  const { codexHasRelay } = await import("../src/agent.js");
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "elefant-relay-codex-"));
  process.env.CODEX_HOME = dir;
  assert.equal(codexHasRelay(), false);
  writeFileSync(join(dir, "config.toml"), '[mcp_servers.other]\ncommand = "x"\n');
  assert.equal(codexHasRelay(), false);
  writeFileSync(join(dir, "config.toml"), '[mcp_servers.elefant-relay]\ncommand = "node"\n');
  assert.equal(codexHasRelay(), true);
  delete process.env.CODEX_HOME;
});
