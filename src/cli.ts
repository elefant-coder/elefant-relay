#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { userInfo } from "node:os";
import { newIdentity } from "./crypto.js";
import { home } from "./home.js";
import { createInterface } from "node:readline/promises";
import { confirmOwnFiles, createInvite, finishInvites, joinInvite, pairedFor, type Paired } from "./pair.js";
import { describeFiles, listFiles, sendFile } from "./files.js";
import { findSyncthing } from "./syncthing.js";
import { startReceiver, receiverPid } from "./receiver.js";
import { removeRule, setRule } from "./rules.js";
import { ask, describe, waitResult, FINAL } from "./client.js";
import { startRelay } from "./localRelay.js";
import { startUi } from "./ui.js";
import { winQuote } from "./agent.js";
import {
  listPending, loadConfig, loadIdentity, loadPeers, loadPending, loadRules, mustConfig, mustIdentity,
  saveConfig, saveIdentity, savePending, type AgentKind, type Config, type Use,
} from "./state.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..", "..");
const cliPath = fileURLToPath(import.meta.url);

function parse(argv: string[]): { pos: string[]; flags: Record<string, string | true> } {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--") && !BOOL.has(k)) flags[k] = argv[++i]!;
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}
const BOOL = new Set(["force", "no-register", "write", "always", "never", "no-wait", "help", "own", "people", "files", "no-files", "no-open"]);
const str = (v: string | true | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const tty = (): boolean => process.stdin.isTTY === true && process.stdout.isTTY === true;
async function question(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(q)).trim(); } finally { rl.close(); }
}
function useFlag(flags: Record<string, string | true>, cfg: Config | null): Use {
  if (flags.own) return "own";
  if (flags.people) return "people";
  return cfg?.use ?? "people";
}
/** The connection code, big enough to read out or copy. */
function codeBox(code: string, full: string, use: Use): string {
  const title = use === "own" ? "Code for your other computer" : "Connection code — give it to the other person";
  const inner = `   ${code}   `;
  const w = Math.max(inner.length, title.length + 2);
  const line = "─".repeat(w);
  return [`┌${line}┐`, `│ ${title.padEnd(w - 1)}│`, `│${" ".repeat(w)}│`, `│${inner.padEnd(w)}│`, `│${" ".repeat(w)}│`, `└${line}┘`,
    `Works once, for 10 minutes. On the other ${use === "own" ? "computer" : "side"}: npx elefant-relay join ${full}`,
    `(same relay? \`elefant-relay join ${code}\` is enough)`].join("\n");
}
/** Own computers skip the approval prompt — but only after the owner has compared the check numbers. */
async function afterPair(x: Paired, use: Use, out: (s: string) => void): Promise<void> {
  out(`🤝 paired with ${x.peer.name}${use === "own" ? " (your computer)" : ""}. Check number: ${x.peer.safety} (should match the other screen)`);
  if (x.note) out(x.note);
  if (use !== "own") return;
  if (!tty()) {
    out(`When the other screen shows the same check number, run: elefant-relay confirm ${x.peer.name}`);
    return;
  }
  const a = await question(`Does the other screen show ${x.peer.safety}? Then requests between your computers run without asking${x.peer.ownOffer ? " and \"My computers\" is shared" : ""}. [y/N] `);
  if (/^y(es)?$/i.test(a)) await confirmOwn(x.peer.name, out);
  else out(`OK — every request from it will still be asked. Later: elefant-relay confirm ${x.peer.name}`);
}

/** Run by the owner after comparing check numbers: trust this computer as their own. */
async function confirmOwn(name: string, out: (s: string) => void): Promise<void> {
  const peer = loadPeers().find((x) => x.name === name);
  if (!peer) throw new Error(`no peer named "${name}"`);
  if (peer.kind !== "own") throw new Error(`${name} was paired as someone else's computer; pair again with --own to treat it as yours`);
  const r = setRule({ peer: peer.name, mode: "*", action: "allow", note: "my own computer (check number confirmed)" });
  out(`✓ rule ${r.id}: ${peer.name} can run requests here without asking`);
  const note = await confirmOwnFiles(mustIdentity(), mustConfig(), peer);
  if (note) out(note);
}

const has = (cmd: string): boolean => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;

const HELP = `elefant-relay — let your AI ask a friend's AI to do a job, and get just the result back.

Set up
  elefant-relay relay deploy               put your own relay on your Cloudflare account (free plan)
  elefant-relay relay local [--port 8787]  or run a relay on your own server
  elefant-relay setup --relay <URL> [--own | --people] [--files] [--name you] [--agent claude|codex|command] [--command "..."] [--no-register]
                                           --own = link your own computers · --people = link with someone else
                                           --files = also send and receive files (needs Syncthing)

Pair
  elefant-relay invite [--own | --people]  show a one-time connection code (10 min) and wait for the other side
  elefant-relay join <CODE[@relay]>        pair using a connection code
  elefant-relay confirm <peer>             your own computer: after both screens show the same check number,
                                           run its requests without asking and share "My computers"

Files (with Syncthing)
  elefant-relay send <peer> <file>         put a file in the folder you share with them
  elefant-relay files [peer]               what is in the shared folders, and whether it has synced

Run
  elefant-relay start                      listen for requests and ask you in this terminal
  elefant-relay ask <peer> "<task>" [--write] [--wait 300]
  elefant-relay result <task-id> [--wait 60]

Approvals and rules (you can also just tell your AI)
  elefant-relay pending
  elefant-relay approve <id> [--always]    --always = never ask again for this person and mode
  elefant-relay deny <id> [--never]
  elefant-relay rules
  elefant-relay allow <peer|*> [--mode read|write|*] [--until 2026-12-31]
  elefant-relay block <peer|*> [--mode ...]
  elefant-relay unrule <rule-id|peer>
  elefant-relay peers | status

See who can do what
  elefant-relay ui [--port N] [--no-open]  read-only page (this computer only): who is connected, what each may do, rules, activity
`;

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const r = spawnSync(cmd as string, args as string[], { stdio: "ignore" });
  if (r.error || r.status !== 0) process.stdout.write("Could not open a browser; open the link above.\n");
}

function registerMcp(): string[] {
  const done: string[] = [];
  const win = process.platform === "win32";
  const q = (args: string[]): string[] => (win ? args.map(winQuote) : args);
  const envArgs = process.env.ELEFANT_RELAY_HOME ? ["-e", `ELEFANT_RELAY_HOME=${process.env.ELEFANT_RELAY_HOME}`] : [];
  if (has("claude")) {
    spawnSync("claude", ["mcp", "remove", "--scope", "user", "elefant-relay"], { stdio: "ignore", shell: process.platform === "win32" });
    const r = spawnSync("claude", q(["mcp", "add", "--scope", "user", ...envArgs, "elefant-relay", "--", process.execPath, cliPath, "mcp"]),
      { stdio: "ignore", shell: process.platform === "win32" });
    if (r.status === 0) done.push("Claude Code");
  }
  if (has("codex")) {
    spawnSync("codex", ["mcp", "remove", "elefant-relay"], { stdio: "ignore", shell: process.platform === "win32" });
    const cenv = process.env.ELEFANT_RELAY_HOME ? ["--env", `ELEFANT_RELAY_HOME=${process.env.ELEFANT_RELAY_HOME}`] : [];
    const r = spawnSync("codex", q(["mcp", "add", ...cenv, "elefant-relay", "--", process.execPath, cliPath, "mcp"]),
      { stdio: "ignore", shell: process.platform === "win32" });
    if (r.status === 0) done.push("Codex");
  }
  return done;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);
  const out = (s: string): void => { process.stdout.write(`${s}\n`); };

  switch (cmd) {
    case "mcp": {
      const { runMcp } = await import("./mcp.js");
      await runMcp();
      return;
    }
    case "setup": {
      const relay = str(flags.relay) ?? loadConfig()?.relay;
      if (!relay) throw new Error("tell me your relay: elefant-relay setup --relay https://elefant-relay.<you>.workers.dev");
      const agent = (str(flags.agent) ?? loadConfig()?.agent ?? (has("claude") ? "claude" : has("codex") ? "codex" : "command")) as AgentKind;
      if (!["claude", "codex", "command"].includes(agent)) throw new Error("--agent must be claude, codex, or command");
      const command = str(flags.command) ?? loadConfig()?.command;
      if (agent === "command" && !command) throw new Error('agent "command" needs --command "<shell command that reads the request on stdin>"');
      const prev = loadConfig();
      let use: Use | undefined = flags.own ? "own" : flags.people ? "people" : prev?.use;
      if (!use && tty()) {
        out("What will you connect?\n  1) my own computers (e.g. my Mac mini and my laptop)\n  2) someone else's computer (a friend, a client)");
        use = (await question("1 or 2 [2]: ")) === "1" ? "own" : "people";
      }
      use ??= "people";
      let files = flags.files ? true : flags["no-files"] ? false : prev?.files;
      if (files === undefined && tty()) files = /^y(es)?$/i.test(await question("Also send and receive files with Syncthing? [y/N] "));
      files ??= false;
      let me = loadIdentity();
      if (!me || flags.force) { me = newIdentity(str(flags.name) ?? userInfo().username); saveIdentity(me); }
      const cfg: Config = { ...(prev ?? {}), relay: relay.replace(/\/+$/, ""), agent, ...(command ? { command } : {}), use, files,
        ...(str(flags["share-dir"]) ? { shareDir: resolve(str(flags["share-dir"])!) } : {}) };
      saveConfig(cfg);
      out(`✓ ready as "${me.name}" (keys in ${home()}) · relay ${cfg.relay} · jobs run with ${agent}`);
      out(use === "own" ? "✓ mode: your own computers (change any time: elefant-relay setup --people)" : "✓ mode: someone else's computer (change any time: elefant-relay setup --own)");
      if (files) out(findSyncthing() ? "✓ files: Syncthing found — a shared folder is made when you pair" : "! files: Syncthing not found — install it (https://syncthing.net · macOS: brew install syncthing && brew services start syncthing)");
      if (!flags["no-register"]) {
        const reg = registerMcp();
        out(reg.length ? `✓ added elefant-relay to ${reg.join(" and ")} — restart your AI session to see it` : "! no Claude Code or Codex found; add the MCP server yourself: elefant-relay mcp");
      }
      out("Next: `elefant-relay invite` (or ask your AI to make an invite), then `elefant-relay start`.");
      return;
    }
    case "invite": {
      const me = mustIdentity();
      const cfg = mustConfig();
      const use = useFlag(flags, cfg);
      const inv = await createInvite(me, cfg, use);
      out(codeBox(inv.code, inv.full, use));
      if (flags["no-wait"]) return;
      out("\nWaiting for the other side…");
      const end = Date.now() + 600_000;
      while (Date.now() < end) {
        const added = await finishInvites(me, mustConfig());
        if (added[0]) { await afterPair(added[0], use, out); return; }
        const done = pairedFor(inv.code); // a running receiver may have finished it
        const peer = done && loadPeers().find((x) => x.box === done.box);
        if (peer) { await afterPair({ peer, note: done.note }, use, out); return; }
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("nobody joined within 10 minutes; make a new invite");
    }
    case "join": {
      if (!pos[0]) throw new Error("usage: elefant-relay join <CODE[@relay]>");
      const cfg = mustConfig();
      const use = useFlag(flags, cfg);
      await afterPair(await joinInvite(mustIdentity(), cfg, pos[0], use), use, out);
      return;
    }
    case "confirm": {
      if (!pos[0]) throw new Error("usage: elefant-relay confirm <peer>   (after checking both screens show the same check number)");
      await confirmOwn(pos[0], out);
      return;
    }
    case "send": {
      if (!pos[0] || !pos[1]) throw new Error("usage: elefant-relay send <peer> <file-or-folder>");
      const r = sendFile(pos[0], pos[1]);
      out(`📁 copied to ${r.dest} — Syncthing sends it to ${r.peer} (check with: elefant-relay files ${r.peer})`);
      return;
    }
    case "files": {
      out(describeFiles(await listFiles(pos[0])));
      return;
    }
    case "start": {
      const me = mustIdentity();
      const cfg = mustConfig();
      const r = startReceiver({ me, cfg, interactive: true, log: (s) => out(s) });
      if (!r) throw new Error(`already listening (pid ${receiverPid()}). Stop that one first.`);
      out(`👂 ${me.name} is listening via ${cfg.relay} — jobs run with ${cfg.agent}. Ctrl+C to stop.`);
      const stop = (): void => { r.close(); process.exit(0); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "ask": {
      const [peer, ...words] = pos;
      if (!peer || words.length === 0) throw new Error('usage: elefant-relay ask <peer> "<task>" [--write] [--wait 300]');
      const wait = Number(str(flags.wait) ?? 300);
      if (receiverPid() === null) {
        const r = startReceiver({ me: mustIdentity(), cfg: mustConfig(), interactive: false, runJobs: false, log: () => {} });
        const sent = await ask(peer, words.join(" "), flags.write ? "write" : "read");
        const res = await waitResult(sent.taskId, wait);
        r?.close();
        out(describe(res));
        process.exit(res && FINAL.includes(res.status) && res.status !== "completed" ? 1 : 0);
      }
      const sent = await ask(peer, words.join(" "), flags.write ? "write" : "read");
      const res = await waitResult(sent.taskId, wait);
      out(describe(res));
      process.exit(res && FINAL.includes(res.status) && res.status !== "completed" ? 1 : 0);
      return;
    }
    case "result": {
      if (!pos[0]) throw new Error("usage: elefant-relay result <task-id> [--wait 0]");
      out(describe(await waitResult(pos[0], Number(str(flags.wait) ?? 0))));
      return;
    }
    case "peers": {
      const peers = loadPeers();
      out(peers.length ? peers.map((x) => `${x.name}\t${x.kind === "own" ? "my computer" : "person"}\tcheck ${x.safety}\tsince ${x.added.slice(0, 10)}${x.folder ? `\tfiles ${x.folder.path}` : ""}`).join("\n") : "no peers yet");
      return;
    }
    case "pending": {
      const list = listPending();
      out(list.length ? list.map((x) => `${x.id}  ${x.peer} (${x.mode})  ${x.text.slice(0, 120).replace(/\n/g, " ")}`).join("\n") : "nothing waiting");
      return;
    }
    case "approve":
    case "deny": {
      const x = pos[0] ? loadPending(pos[0]) : null;
      if (!x || x.decision !== undefined) throw new Error(`no waiting request ${pos[0] ?? ""}`);
      const decision = cmd === "approve" ? (flags.always ? "always" : "once") : (flags.never ? "deny-always" : "deny");
      savePending({ ...x, decision });
      out(receiverPid() ? `✓ ${decision}` : `✓ ${decision} — it is applied when \`elefant-relay start\` runs`);
      return;
    }
    case "rules": {
      const rules = loadRules();
      out(rules.length ? rules.map((r) => `${r.id}  ${r.action}  ${r.peer}/${r.mode}${r.until ? `  until ${r.until}` : ""}${r.note ? `  # ${r.note}` : ""}`).join("\n") : "no rules — every request is asked");
      return;
    }
    case "allow":
    case "block": {
      if (!pos[0]) throw new Error(`usage: elefant-relay ${cmd} <peer|*> [--mode read|write|*] [--until DATE]`);
      const mode = (str(flags.mode) ?? "read") as "read" | "write" | "*";
      const r = setRule({ peer: pos[0], mode, action: cmd === "allow" ? "allow" : "deny", until: str(flags.until), note: "set from the command line" });
      out(`✓ rule ${r.id}: ${r.action} ${r.peer}/${r.mode}${r.until ? ` until ${r.until}` : ""}`);
      return;
    }
    case "unrule": {
      if (!pos[0]) throw new Error("usage: elefant-relay unrule <rule-id|peer>");
      out(`✓ removed ${removeRule(pos[0])} rule(s)`);
      return;
    }
    case "status": {
      const me = loadIdentity();
      const cfg = loadConfig();
      out(me && cfg ? `${me.name} · ${cfg.use === "own" ? "own computers" : "with people"}${cfg.files ? " + files" : ""} · relay ${cfg.relay} · agent ${cfg.agent} · ${receiverPid() ? "listening" : "not listening"} · ${loadPeers().length} peer(s) · ${listPending().length} waiting` : "not set up");
      return;
    }
    case "ui": {
      const port = str(flags.port) === undefined ? undefined : Number(str(flags.port));
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error("--port must be a number from 0 to 65535");
      const ui = await startUi({ port });
      out(`Elefant Relay UI (read-only, this computer only): ${ui.url}\nCtrl+C to stop.`);
      if (!flags["no-open"]) openBrowser(ui.url);
      const stop = (): void => { void ui.close().then(() => process.exit(0)); };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      return;
    }
    case "relay": {
      if (pos[0] === "local") {
        const r = await startRelay(Number(str(flags.port) ?? 8787), str(flags.host) ?? "127.0.0.1");
        out(`relay listening on ${r.url} (put it behind HTTPS before sharing it)`);
        return;
      }
      if (pos[0] === "deploy") {
        const conf = join(pkgRoot, "relay", "wrangler.toml");
        if (!existsSync(conf)) throw new Error(`relay files not found at ${conf}`);
        out("Deploying your own relay to your Cloudflare account (free plan is enough)…");
        const r = spawnSync("npx", ["-y", "wrangler@4", "deploy", "--config", conf], { stdio: "inherit", shell: process.platform === "win32" });
        if (r.status !== 0) throw new Error("wrangler deploy failed (run `npx wrangler login` first)");
        out("\nNext: elefant-relay setup --relay https://elefant-relay.<your-subdomain>.workers.dev  (the URL printed above)");
        return;
      }
      throw new Error("usage: elefant-relay relay deploy | elefant-relay relay local [--port 8787]");
    }
    case undefined:
    case "help":
    case "--help":
      out(HELP);
      return;
    default:
      throw new Error(`unknown command "${cmd}". Run: elefant-relay help`);
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`elefant-relay: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
