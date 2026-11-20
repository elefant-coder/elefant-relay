// Window life (tray, second launch, quit) and taking over from an old 0.1.0 listener.
// usage: node run-extra.mjs --out DIR [--exe PATH] [--skip-lifecycle]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repo = resolve(appDir, "..");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT = resolve(arg("--out") ?? join(appDir, "e2e-extra"));
const exe = arg("--exe");
const WIN = process.platform === "win32";
mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) fails.push(what); };

function app(role, home, extra = {}) {
  const env = { ...process.env, ...extra, E2E_OUT: OUT, ELEFANT_RELAY_HOME: home, ELEFANT_RELAY_APP_DATA: join(OUT, `appdata-${role}`), ELEFANT_RELAY_TEST_DRIVER: join(here, `driver-${role}.mjs`) };
  const [cmd, args] = exe ? [exe, []] : [join(appDir, "node_modules", ".bin", WIN ? "electron.cmd" : "electron"), ["."]];
  const child = spawn(cmd, args, { cwd: appDir, env, stdio: "ignore", shell: !exe && WIN });
  return new Promise((r) => { child.on("close", r); setTimeout(() => { child.kill(); r("timeout"); }, 180000); });
}

if (WIN && !process.argv.includes("--skip-lifecycle")) {
  const code = await app("lifecycle", join(OUT, "home-lifecycle"));
  const lines = existsSync(join(OUT, "lifecycle.txt")) ? readFileSync(join(OUT, "lifecycle.txt"), "utf8").split("\n").filter(Boolean) : ["FAIL no result"];
  for (const l of lines) check(l.startsWith("PASS"), l.replace(/^(PASS|FAIL) /, ""));
  check(code === 0, `tray Quit ends the app (exit ${code})`);
}

// old listener: set up a home with this version, then let elefant-relay 0.1.0 hold the mailbox
const port = 29000 + Math.floor(Math.random() * 500);
const relay = spawn(process.execPath, [join(repo, "dist", "src", "cli.js"), "relay", "local", "--port", String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2000));
const home = join(OUT, "home-old");
const henv = { ...process.env, ELEFANT_RELAY_HOME: home };
spawnSync(process.execPath, [join(repo, "dist", "src", "cli.js"), "setup", "--relay", `http://127.0.0.1:${port}`, "--name", "olduser", "--no-register"], { env: henv, stdio: "ignore" });
const oldDir = join(OUT, "old010");
spawnSync("npm", ["i", "--prefix", oldDir, "elefant-relay@0.1.0", "--silent", "--no-audit", "--no-fund"], { stdio: "ignore", shell: WIN });
const oldCli = join(oldDir, "node_modules", "elefant-relay", "dist", "src", "cli.js");
check(existsSync(oldCli), "installed elefant-relay 0.1.0");
const old = spawn(process.execPath, [oldCli, "start"], { env: henv, stdio: "ignore" });
let oldExit = null;
old.on("exit", (c, s) => { oldExit = s ?? c; });
await new Promise((r) => setTimeout(r, 4000));
check(oldExit === null, "0.1.0 is listening");
const code = await app("old", home);
check(code === 0, `app found and stopped the old listener (exit ${code})`);
const cmdline = existsSync(join(OUT, "old-command.txt")) ? readFileSync(join(OUT, "old-command.txt"), "utf8") : "";
check(/old010|elefant-relay/.test(cmdline), `the card shows the old command line (${cmdline.slice(0, 120)})`);
check(oldExit !== null, "the old listener is gone");
const via = existsSync(join(OUT, "old-via.txt")) ? readFileSync(join(OUT, "old-via.txt"), "utf8") : "none";
check(via === "app", `the app took the mailbox (listener: ${via})`);
if (oldExit === null) old.kill();
relay.kill();
process.exit(fails.length ? 1 : 0);
