// Real-mouse checks: a click must never be lost because the screen redrew between press and release.
// Each check comes from a bug that shipped (see harness/CASES.md). Runs inside the app (ELEFANT_RELAY_TEST_DRIVER).
// env: E2E_OUT E2E_PROXY E2E_NODE E2E_CLI E2E_FRIEND_HOME
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { out, env, sleep, until, click, type, exists, log, press, mouseDown, mouseUp, watchRedraws, redrawsSince } from "./ui.mjs";

const PROXY = env("E2E_PROXY");
const friendEnv = { ...process.env, ELEFANT_RELAY_HOME: env("E2E_FRIEND_HOME"), ELEFANT_RELAY_URL: "", ELECTRON_RUN_AS_NODE: "" };
const friend = (...args) => spawnSync(env("E2E_NODE"), [env("E2E_CLI"), ...args], { env: friendEnv, encoding: "utf8", timeout: 60000 });
const friendBg = (...args) => {
  const c = spawn(env("E2E_NODE"), [env("E2E_CLI"), ...args], { env: friendEnv, stdio: ["ignore", "pipe", "pipe"] });
  const f = out(`friend-${args[0]}.out`);
  c.stdout.on("data", (d) => writeFileSync(f, d, { flag: "a" }));
  c.stderr.on("data", (d) => writeFileSync(f, d, { flag: "a" }));
  return c;
};
const delay = (ms) => fetch(`${PROXY}/__delay`, { method: "POST", body: JSON.stringify({ ms }) });

const results = [];
function check(id, ok, detail = "") {
  results.push({ id, ok, detail });
  writeFileSync(out("checks.jsonl"), `${JSON.stringify({ id, ok, detail })}\n`, { flag: "a" });
  log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`);
}

export default async function ({ js, input }) {
  const now = () => js("Date.now()");
  // --- set up (not under test: plain clicks) ---
  await until(js, exists(".modal #in-name"), 20000, "welcome");
  await until(js, click(".choice button:nth-of-type(2)"), 5000, "choose invite");
  await sleep(300);
  await until(js, type("#in-name", "taka"), 5000, "name");
  await until(js, type("#in-relay", PROXY), 5000, "relay");
  await until(js, click(".modal .row button.primary"), 5000, "start");
  await until(js, exists(".modal .code.long"), 30000, "first code");
  await js(watchRedraws);

  // C1 idle: nothing changes → no redraw
  await press(js, input, ".modal .row button.ghost");
  await sleep(2000);
  let t = await now();
  await sleep(5000);
  check("C1 idle: no redraw in 5 s when nothing changes", (await js(redrawsSince(t))) === 0, `redraws=${await js(redrawsSince(t))}`);

  // C2 closing the dialog must not cause a later redraw (0.2.1: the dialog kind was part of the "changed?" test)
  let extra = 0;
  for (let i = 0; i < 4; i++) {
    await press(js, input, ".add");
    await until(js, exists(".modal .code.long"), 15000, "code");
    await sleep(2000);
    await press(js, input, ".modal .row button.ghost");
    t = (await now()) + 300;
    await sleep(3300);
    extra += await js(redrawsSince(t));
  }
  check("C2 closing the dialog: no extra redraw afterwards", extra === 0, `extra redraws=${extra} in 4 closes`);

  // C3 "Enter a code" clicked 0–1500 ms after opening, the code arriving ~300 ms late: the first click always works
  await delay(300);
  const lost3 = [];
  for (let d = 0; d <= 1500; d += 100) {
    await press(js, input, ".add");
    await sleep(d);
    await until(js, exists(".modal .tabs button:nth-of-type(2)"), 5000, "tabs");
    await press(js, input, ".modal .tabs button:nth-of-type(2)", 80);
    await sleep(250);
    if (!(await js(exists("#in-join")))) lost3.push(d);
    await press(js, input, ".modal .row button.ghost");
    await sleep(1700);
  }
  check("C3 'Enter a code' right after opening: first click works (16 tries)", lost3.length === 0, `lost at ${JSON.stringify(lost3)} ms`);

  // C4 a press held while the code arrives (700 ms late) still lands, and the code shows when going back
  await delay(700);
  const lost4 = [];
  for (let i = 0; i < 3; i++) {
    await press(js, input, ".add");
    await sleep(50);
    const p = await mouseDown(js, input, ".modal .tabs button:nth-of-type(2)");
    await sleep(900);
    mouseUp(input, p);
    await sleep(250);
    const ok = await js(exists("#in-join"));
    await press(js, input, ".modal .tabs button:nth-of-type(1)");
    const code = await until(js, `document.querySelector(".modal .code.long")?.textContent || ""`, 10000, "code after going back").catch(() => "");
    if (!ok || !code) lost4.push({ i, tab: ok, code: Boolean(code) });
    await press(js, input, ".modal .row button.ghost");
    await sleep(1700);
  }
  check("C4 press held across the code's arrival still lands", lost4.length === 0, JSON.stringify(lost4));
  await delay(0);

  // C5 Cancel held while the friend joins: on release the "paired / check number" dialog must show (0.2.2 lost it)
  await press(js, input, ".add");
  const code = await until(js, `document.querySelector(".modal .code.long")?.textContent || ""`, 15000, "code to share");
  const p5 = await mouseDown(js, input, ".modal .row button.ghost");
  const j = friend("join", code, "--no-listen", "--no-register");
  if (j.status !== 0) throw new Error(`friend join failed: ${j.stdout}${j.stderr}`);
  await until(js, "S && S.peers.length > 0", 20000, "friend saved");
  await sleep(1700);
  mouseUp(input, p5);
  await sleep(1000);
  check("C5 Cancel held while the friend joins → the check-number dialog still shows", await js(exists(".modal .check")), "");
  if (await js(exists(".modal .check"))) await press(js, input, ".modal .row button.primary");
  await sleep(800);

  // C6 rounds 2/3/4/6: each picked by one real click at different hold times (0.2.0: a menu that closed by itself)
  await press(js, input, ".main .tabs button:nth-of-type(2)");
  await until(js, exists(".rounds button[data-k='6']"), 5000, "duo tab");
  const miss6 = [];
  for (const hold of [15, 40, 80, 160]) for (const k of ["2", "3", "4", "6"]) {
    await press(js, input, `.rounds button[data-k='${k}']`, hold);
    await sleep(120);
    if ((await js(`document.querySelector(".rounds button.on")?.dataset.k`)) !== k) miss6.push(`${k}@${hold}`);
  }
  await sleep(3500);
  const stuck = (await js(`document.querySelector(".rounds button.on")?.dataset.k`)) === "6";
  check("C6 rounds 2/3/4/6 each picked by one click, and the choice stays", miss6.length === 0 && stuck, `missed ${JSON.stringify(miss6)} stays=${stuck}`);

  // C7 a request arriving while the mouse is held: the held click lands, the request card shows after release
  await press(js, input, ".rounds button[data-k='2']");
  const p7 = await mouseDown(js, input, ".rounds button[data-k='6']");
  const asker = friendBg("ask", "taka", "hello from the click test", "--wait", "3");
  await sleep(5000);
  mouseUp(input, p7);
  const t7 = Date.now();
  const card = await until(js, exists(".banner button.danger"), 8000, "request card").then(() => Date.now() - t7).catch(() => -1);
  const k7 = await js(`document.querySelector(".rounds button.on")?.dataset.k`);
  check("C7 request arriving mid-press: the press lands and the card shows after release", card >= 0 && k7 === "6", `card after ${card} ms, picked ${k7}`);
  asker.kill();
  if (card >= 0) { await press(js, input, ".banner button.danger"); await sleep(1000); }

  // C8 a tab clicked 0–1000 ms after Send, the relay answering ~500 ms late: the first click always opens it
  await press(js, input, ".main .tabs button:nth-of-type(1)");
  await until(js, exists("#ta-chat"), 5000, "chat tab");
  await delay(500);
  const lost8 = [];
  for (let d = 0; d <= 1040; d += 80) {
    await until(js, type("#ta-chat", `note ${d}`), 5000, "type");
    await press(js, input, ".compose button.primary", 40);
    await sleep(d);
    await press(js, input, ".main .tabs button:nth-of-type(2)", 100);
    await sleep(200);
    if (!(await js(exists("#ta-duo")))) lost8.push(d);
    await sleep(900);
    if (!(await js(exists("#ta-chat")))) await press(js, input, ".main .tabs button:nth-of-type(1)");
    await sleep(400);
  }
  await delay(0);
  check("C8 a tab clicked right after Send opens on the first click (14 tries)", lost8.length === 0, `lost at ${JSON.stringify(lost8)} ms`);

  writeFileSync(out("clicks-result.json"), JSON.stringify(results, null, 1));
  if (results.some((r) => !r.ok)) throw new Error(`${results.filter((r) => !r.ok).length} click checks failed`);
}
