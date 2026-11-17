import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { newIdentity, pairSeal, pairOpen, pairSlot } from "../src/crypto.js";

const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "src", "cli.js");

test("review fix: a relay owner who learns the code cannot swap only the encryption key", async () => {
  const port = 40000 + Math.floor(Math.random() * 10000);
  const rp = spawn(process.execPath, [cli, "relay", "local", "--port", String(port)], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise<void>((r) => rp.stdout!.on("data", (d: Buffer) => { if (d.toString().includes("listening")) r(); }));
  const url = `http://127.0.0.1:${port}`;
  try {
    process.env.ELEFANT_RELAY_HOME = mkdtempSync(join(tmpdir(), "elefant-relay-pt-"));
    const { createInvite, joinInvite } = await import("../src/pair.js");
    const alice = newIdentity("alice");
    const cfg = { relay: url, agent: "command" as const };
    const { full: invite, code } = await createInvite(alice, cfg);
    // attacker (who knows the code) replaces alice's card with one where only encPub is theirs
    const slot = pairSlot(code);
    const blob = await (await fetch(`${url}/pair/${slot}/a`)).text();
    const cardA = pairOpen(code, blob) as Record<string, string>;
    const eve = newIdentity("eve");
    const forged = pairSeal("ZZZ-ZZZ", { ...cardA, encPub: eve.encPub });
    const slot2 = pairSlot("ZZZ-ZZZ");
    await fetch(`${url}/pair/${slot2}/a`, { method: "PUT", body: forged });
    const bob = newIdentity("bob");
    await assert.rejects(() => joinInvite(bob, cfg, `ZZZ-ZZZ@${url}`), /signature/);
    // the genuine card is accepted
    const { peer } = await joinInvite(bob, cfg, invite);
    assert.equal(peer.name, "alice");
    assert.equal(peer.encPub, alice.encPub);
  } finally {
    rp.kill();
  }
});
