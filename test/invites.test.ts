import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { newIdentity, pairSlot } from "../src/crypto.js";

// What went wrong (0.1.0 → fixed in 0.2.2): finishInvites wrote back the invite list it read before waiting
// on the relay, so a code made in the meantime vanished. The friend saw "paired"; this side waited forever.

const root = resolve(import.meta.dirname, "..", "..");
const cli = join(root, "dist", "src", "cli.js");

/** a proxy that makes GET (the answer check) slow and everything else fast */
function slowGets(target: string, port: number, ms: number): Promise<Server> {
  const srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d: Buffer) => chunks.push(d));
    req.on("end", () => setTimeout(() => {
      const u = new URL(target);
      const up = request({ host: u.hostname, port: u.port, path: req.url, method: req.method, headers: { ...req.headers, host: u.host } }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => { res.writeHead(502); res.end(); });
      up.end(Buffer.concat(chunks));
    }, req.method === "GET" ? ms : 0));
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}

test("invites: a code made while the answer check waits on the relay is kept; answered, expired and broken ones are dropped", async () => {
  const port = 30000 + Math.floor(Math.random() * 10000);
  const rp = spawn(process.execPath, [cli, "relay", "local", "--port", String(port)], { stdio: ["ignore", "pipe", "ignore"] });
  await new Promise<void>((r) => rp.stdout!.on("data", (d: Buffer) => { if (d.toString().includes("listening")) r(); }));
  const proxy = await slowGets(`http://127.0.0.1:${port}`, port + 1, 600);
  const url = `http://127.0.0.1:${port + 1}`;
  try {
    const home = mkdtempSync(join(tmpdir(), "elefant-relay-inv-"));
    process.env.ELEFANT_RELAY_HOME = home;
    const { createInvite, finishInvites, joinInvite } = await import("../src/pair.js");
    const codes = (): string[] => (JSON.parse(readFileSync(join(home, "invites.json"), "utf8")) as { code: string }[]).map((i) => i.code);
    const alice = newIdentity("alice");
    const cfg = { relay: url, agent: "command" as const };

    // 1. the race
    const a = await createInvite(alice, cfg);
    const checking = finishInvites(alice, cfg);
    await new Promise((r) => setTimeout(r, 150));
    const b = await createInvite(alice, cfg);
    await checking;
    assert.deepEqual(codes().sort(), [a.code, b.code].sort(), "the code made during the check must be kept");

    // 2. answered → saved as a friend and dropped; garbage answer → dropped; expired → dropped; unanswered → kept
    const bob = newIdentity("bob");
    await joinInvite(bob, cfg, a.full);
    await fetch(`${url}/pair/${pairSlot(b.code)}/b`, { method: "PUT", body: "garbage" });
    const c = await createInvite(alice, cfg);
    const d = await createInvite(alice, cfg);
    const list = JSON.parse(readFileSync(join(home, "invites.json"), "utf8")) as { code: string; created: number }[];
    writeFileSync(join(home, "invites.json"), JSON.stringify(list.map((i) => (i.code === d.code ? { ...i, created: 0 } : i))));
    const added = await finishInvites(alice, cfg);
    assert.deepEqual(added.map((x) => x.peer.name), ["bob"]);
    assert.deepEqual(codes(), [c.code], "only the unanswered, fresh code stays");
  } finally {
    proxy.close();
    rp.kill();
  }
});
