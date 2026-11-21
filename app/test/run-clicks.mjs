// One app + a friend on the CLI + a local relay behind a slow proxy; the app is clicked with a real mouse.
// usage: node run-clicks.mjs --out DIR [--exe PATH_TO_APP_BINARY]   (no --exe = run from source with electron)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startProxy } from "./proxy.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repo = resolve(appDir, "..");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT = resolve(arg("--out") ?? join(appDir, "e2e-clicks"));
const exe = arg("--exe");
const cli = join(repo, "dist", "src", "cli.js");
const agent = `"${process.execPath}" "${join(repo, "test", "fixtures", "echo-agent.mjs")}"`;
mkdirSync(OUT, { recursive: true });

const port = 29000 + Math.floor(Math.random() * 1000);
const relay = spawn(process.execPath, [cli, "relay", "local", "--port", String(port)], { stdio: ["ignore", "pipe", "ignore"] });
await new Promise((r) => relay.stdout.on("data", (d) => { if (String(d).includes("listening")) r(); }));
const proxy = await startProxy(`http://127.0.0.1:${port}`, port + 1000);
const PROXY = `http://127.0.0.1:${port + 1000}`;

const friendHome = join(OUT, "home-friend");
mkdirSync(friendHome, { recursive: true });
const fs = spawnSync(process.execPath, [cli, "setup", "--relay", PROXY, "--name", "friend", "--agent", "command", "--command", agent, "--no-register", "--people", "--no-files"],
  { env: { ...process.env, ELEFANT_RELAY_HOME: friendHome, ELEFANT_RELAY_URL: "" }, encoding: "utf8" });
if (fs.status !== 0) { console.error(fs.stdout, fs.stderr); relay.kill(); proxy.close(); process.exit(1); }

const home = join(OUT, "home-taka");
mkdirSync(home, { recursive: true });
writeFileSync(join(home, "config.json"), JSON.stringify({ agent: "command", command: agent }));
const env = {
  ...process.env, E2E_OUT: OUT, E2E_PROXY: PROXY, E2E_NODE: process.execPath, E2E_CLI: cli, E2E_FRIEND_HOME: friendHome,
  ELEFANT_RELAY_HOME: home, ELEFANT_RELAY_APP_DATA: join(OUT, "appdata"), ELEFANT_RELAY_TEST_DRIVER: join(here, "driver-clicks.mjs"),
};
const [cmd, args] = exe ? [exe, []] : [join(appDir, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron"), ["."]];
const child = spawn(cmd, args, { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], shell: !exe && process.platform === "win32" });
let log = "";
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });
const limit = setTimeout(() => { log += "\nTIMEOUT: killed after 12 minutes\n"; child.kill("SIGKILL"); }, 12 * 60_000);
const code = await new Promise((r) => child.on("close", (c) => r(c)));
clearTimeout(limit);
writeFileSync(join(OUT, "app.out"), log);
relay.kill();
proxy.close();

const lines = existsSync(join(OUT, "checks.jsonl")) ? readFileSync(join(OUT, "checks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
for (const c of lines) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.id}${c.detail ? `  — ${c.detail}` : ""}`);
const failed = lines.filter((c) => !c.ok).length;
const ok = code === 0 && failed === 0 && lines.length === 8;
if (!ok && code !== 0) console.log(`FAIL app exit ${code}${/DRIVER FAILED[^\n]*/.exec(log)?.[0] ? ` (${/DRIVER FAILED[^\n]*/.exec(log)[0]})` : ""}`);
console.log(`${lines.length} checks, ${failed} failed`);
writeFileSync(join(OUT, "result.txt"), ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
