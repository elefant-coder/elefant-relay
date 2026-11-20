// Two copies of the app on this computer, a local relay, real clicks: invite → join → chat both ways → AI-to-AI.
// usage: node run-pair.mjs --out DIR [--exe PATH_TO_APP_BINARY] [--echo]   (no --exe = run from source with electron)
// --echo: answer with the echo fixture instead of claude (for machines with a real, logged-in claude)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repo = resolve(appDir, "..");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const OUT = resolve(arg("--out") ?? join(appDir, "e2e-out"));
const exe = arg("--exe");
const echo = process.argv.includes("--echo");
const port = 28000 + Math.floor(Math.random() * 1000);
mkdirSync(OUT, { recursive: true });

const relay = spawn(process.execPath, [join(repo, "dist", "src", "cli.js"), "relay", "local", "--port", String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2000));

function launch(role, extraEnv) {
  const home = join(OUT, `home-${role}`);
  mkdirSync(home, { recursive: true });
  if (echo) writeFileSync(join(home, "config.json"), JSON.stringify({ agent: "command", command: `"${process.execPath}" "${join(repo, "test", "fixtures", "echo-agent.mjs")}"` }));
  const env = {
    ...process.env, ...extraEnv,
    E2E_OUT: OUT, E2E_STEP_MS: "300000",
    ELEFANT_RELAY_HOME: home, ELEFANT_RELAY_APP_DATA: join(OUT, `appdata-${role}`),
    ELEFANT_RELAY_TEST_DRIVER: join(here, `driver-${role}.mjs`),
  };
  const [cmd, args] = exe ? [exe, []] : [join(appDir, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron"), ["."]];
  const child = spawn(cmd, args, { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"], shell: !exe && process.platform === "win32" });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  return new Promise((r) => child.on("close", (code) => { writeFileSync(join(OUT, `${role}.out`), log); r(code); }));
}

const a = launch("inviter", { E2E_RELAY: `http://127.0.0.1:${port}`, E2E_NAME: "taka", E2E_DUO: "1", E2E_EXPECT_CARD: "1", E2E_WAIT_FILE: join(OUT, "joiner-done") });
await new Promise((r) => setTimeout(r, 3000));
const c = launch("joiner", { E2E_NAME: "friend", E2E_SEND: "1", E2E_WAIT_FILE: join(OUT, "inviter-done") });
const [ca, cc] = await Promise.all([a, c]);
relay.kill();

const read = (f) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), "utf8") : "");
const fails = [];
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) fails.push(what); };
check(ca === 0, `inviter app finished (exit ${ca})`);
check(cc === 0, `joiner app finished (exit ${cc})`);
check(read("inviter-safety.txt") !== "" && read("inviter-safety.txt") === read("joiner-safety.txt"), "both sides show the same check number");
check(/ping from taka/.test(read("inviter-answer.txt")), "inviter got the friend's AI answer");
check(/ping from friend/.test(read("joiner-answer.txt")), "joiner got the inviter's AI answer");
check(/\S/.test(read("inviter-messages.txt")) && existsSync(join(OUT, "inviter-5-summary.png")), "AI-to-AI ran to a summary");
if (process.env.FAKE_LOG) {
  const calls = existsSync(process.env.FAKE_LOG) ? readFileSync(process.env.FAKE_LOG, "utf8") : "";
  const list = calls.split("\n").filter(Boolean).map((l) => JSON.parse(l).argv);
  const duo = list.find((v) => v.includes("--system-prompt"));
  const job = list.find((v) => v.includes("--permission-mode"));
  check(Boolean(duo) && duo[duo.indexOf("--tools") + 1] === "" && duo[duo.indexOf("--setting-sources") + 1] === "", "AI-to-AI: claude got the empty --tools and --setting-sources values");
  check(Boolean(duo) && duo[duo.indexOf("--system-prompt") + 1].startsWith("You write short messages on behalf of a user"), "AI-to-AI: the system prompt arrived in one piece");
  check(Boolean(job) && job[job.indexOf("--tools") + 1] === "Read,Grep,Glob,WebSearch,WebFetch", "friend's request: claude ran with read-only tools");
  check(Boolean(job) && job.some((x) => /^Read\(\/\/.+\*\*\)$/.test(x)), "friend's request: the rule blocking the key folder was passed");
  writeFileSync(join(OUT, "fake-claude-calls.json"), JSON.stringify(list, null, 1));
}
writeFileSync(join(OUT, "result.txt"), fails.length ? `FAIL\n${fails.join("\n")}` : "PASS");
process.exit(fails.length ? 1 : 0);
