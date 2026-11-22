// usage: node app/test/run-verify.mjs [--repo CLONE] [--out DIR] [--exe PATH_TO_APP_BINARY] [--only V1,V2]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startLocalRelay, freePort } from "./relay.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const repo = resolve(arg("--repo") ?? join(here, "..", ".."));
const appDir = join(repo, "app");
const OUT = resolve(arg("--out") ?? join(repo, "harness", "out", `verify-${Date.now()}`));
const exe = arg("--exe");
const { startProxy } = await import(pathToFileURL(join(appDir, "test", "proxy.mjs")).href);
const cli = join(repo, "dist", "src", "cli.js");
const agent = `"${process.execPath}" "${join(repo, "test", "fixtures", "echo-agent.mjs")}"`;
mkdirSync(OUT, { recursive: true });

const { proc: relay, url: relayUrl } = await startLocalRelay(cli);
const pport = await freePort();
const proxy = await startProxy(relayUrl, pport);
const PROXY = `http://127.0.0.1:${pport}`;
const friendHome = join(OUT, "home-friend");
mkdirSync(friendHome, { recursive: true });
const fs = spawnSync(process.execPath, [cli, "setup", "--relay", PROXY, "--name", "friend", "--agent", "command", "--command", agent, "--no-register", "--people", "--no-files"],
  { env: { ...process.env, ELEFANT_RELAY_HOME: friendHome, ELEFANT_RELAY_URL: "" }, encoding: "utf8" });
if (fs.status !== 0) { console.error(fs.stdout, fs.stderr); relay.kill(); proxy.close(); process.exit(1); }
const home = join(OUT, "home-taka");
mkdirSync(home, { recursive: true });
writeFileSync(join(home, "config.json"), JSON.stringify({ agent: "command", command: agent }));
const env = {
  ...process.env, PATH: [join(appDir, "test", "fake"), process.env.PATH].join(":"),
  E2E_OUT: OUT, E2E_PROXY: PROXY, E2E_NODE: process.execPath, E2E_CLI: cli, E2E_FRIEND_HOME: friendHome, E2E_UI: join(appDir, "test", "ui.mjs"),
  ...(arg("--only") ? { E2E_ONLY: arg("--only") } : {}),
  ELEFANT_RELAY_HOME: home, ELEFANT_RELAY_APP_DATA: join(OUT, "appdata"), ELEFANT_RELAY_TEST_DRIVER: join(here, "driver-verify.mjs"),
};
const [cmd, args] = exe ? [exe, []] : [join(appDir, "node_modules", ".bin", "electron"), ["."]];
const child = spawn(cmd, args, { cwd: exe ? OUT : appDir, env, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => { log += d; });
child.stderr.on("data", (d) => { log += d; });
const limit = setTimeout(() => { log += "\nTIMEOUT: killed after 9 minutes\n"; child.kill("SIGKILL"); }, 9 * 60_000);
const code = await new Promise((r) => child.on("close", (c) => r(c)));
clearTimeout(limit);
writeFileSync(join(OUT, "app.out"), log);
relay.kill();
proxy.close();
const lines = existsSync(join(OUT, "checks.jsonl")) ? readFileSync(join(OUT, "checks.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
for (const c of lines) console.log(`${c.ok ? "PASS" : "FAIL"} ${c.id}${c.detail ? `  — ${c.detail}` : ""}`);
if (code !== 0) console.log(`app exit ${code} ${/DRIVER FAILED[^\n]*/.exec(log)?.[0] ?? ""} ${/TIMEOUT[^\n]*/.exec(log)?.[0] ?? ""}`);
console.log(`${lines.length} checks, ${lines.filter((c) => !c.ok).length} failed`);
process.exit(code === 0 && lines.every((c) => c.ok) ? 0 : 1);
