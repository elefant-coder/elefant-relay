// Real-mouse checks around Allow and Join (V1–V5), which driver-clicks.mjs (C1–C8) does not cover. Written by the independent verifier for 0.2.3.
// env: E2E_OUT E2E_PROXY E2E_NODE E2E_CLI E2E_FRIEND_HOME E2E_UI (absolute path of app/test/ui.mjs)
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { out, env, sleep, until, click, type, exists, log, press, mouseDown, mouseUp } = await import(pathToFileURL(process.env.E2E_UI).href);

const PROXY = env("E2E_PROXY");
const friendEnv = { ...process.env, ELEFANT_RELAY_HOME: env("E2E_FRIEND_HOME"), ELEFANT_RELAY_URL: "", ELECTRON_RUN_AS_NODE: "" };
const friend = (...args) => spawnSync(env("E2E_NODE"), [env("E2E_CLI"), ...args], { env: friendEnv, encoding: "utf8", timeout: 60000 });
const bg = [];
const friendBg = (...args) => { const c = spawn(env("E2E_NODE"), [env("E2E_CLI"), ...args], { env: friendEnv, stdio: "ignore" }); bg.push(c); return c; };
const delay = (ms) => fetch(`${PROXY}/__delay`, { method: "POST", body: JSON.stringify({ ms }) });
const results = [];
function check(id, ok, detail = "") {
  results.push({ id, ok, detail });
  writeFileSync(out("checks.jsonl"), `${JSON.stringify({ id, ok, detail })}\n`, { flag: "a" });
  log(`${ok ? "PASS" : "FAIL"} ${id} ${detail}`);
}
const CARD = ".banner button.danger";
const ALLOW = ".banner .row button.primary";
const nCards = `document.querySelectorAll(${JSON.stringify(CARD)}).length`;

export default async function ({ js, input }) {
  const fast = async (cond, ms, what) => { const end = Date.now() + ms; for (;;) { const v = await js(cond); if (v) return v; if (Date.now() > end) throw new Error(`timeout: ${what}`); await sleep(20); } };
  const pending = () => js(`S.pending.map((x) => ({ id: x.id, text: x.text }))`);
  const section = (process.env.E2E_ONLY ?? "V1,V2,V3,V4,V5").split(",");

  // --- set up and pair (plain clicks, not under test) ---
  await until(js, exists(".modal #in-name"), 20000, "welcome");
  await until(js, click(".choice button:nth-of-type(2)"), 5000, "choose invite");
  await sleep(300);
  await until(js, type("#in-name", "taka"), 5000, "name");
  await until(js, type("#in-relay", PROXY), 5000, "relay");
  await until(js, click(".modal .row button.primary"), 5000, "start");
  const code0 = await until(js, `document.querySelector(".modal .code.long")?.textContent || ""`, 30000, "first code");
  const j = friend("join", code0, "--no-listen", "--no-register");
  if (j.status !== 0) throw new Error(`friend join failed: ${j.stdout}${j.stderr}`);
  await until(js, exists(".modal .check"), 20000, "paired dialog");
  await press(js, input, ".modal .row button.primary");
  await sleep(800);
  if (await js(exists(".modal"))) throw new Error("setup: paired dialog did not close");
  await until(js, exists("#ta-chat"), 5000, "chat tab");

  // V1 Allow once, then a tab clicked 0–1200 ms later, relay answering 500 ms late. The Allow is pressed 0–400 ms after its card shows.
  if (section.includes("V1")) {
    await delay(500);
    const lostTab = [], lostAllow = [];
    for (let i = 0; i <= 20; i++) {
      const d = i * 60, a = (i * 37) % 400;
      friendBg("ask", "taka", `v1 request ${i}`, "--wait", "2");
      await fast(exists(CARD), 20000, `v1 card ${i}`);
      await sleep(a);
      await press(js, input, ALLOW, 60);
      await sleep(d);
      await press(js, input, ".main .tabs button:nth-of-type(2)", 100);
      await sleep(200);
      if (!(await js(exists("#ta-duo")))) lostTab.push(d);
      const gone = await fast(`S.pending.length === 0 && ${nCards} === 0`, 4000, "card gone").catch(() => false);
      if (!gone) { lostAllow.push({ d, a }); if (await js(exists(CARD))) { await press(js, input, CARD); await sleep(800); } }
      if (!(await js(exists("#ta-chat")))) await press(js, input, ".main .tabs button:nth-of-type(1)");
      await sleep(500);
    }
    await delay(0);
    check("V1a Allow once pressed 0–400 ms after its card shows: the request is allowed (21 tries)", lostAllow.length === 0, `lost ${JSON.stringify(lostAllow)}`);
    check("V1b a tab clicked 0–1200 ms after Allow opens on the first click (21 tries)", lostTab.length === 0, `lost at ${JSON.stringify(lostTab)} ms`);
    await sleep(2500);
  }

  // V2 Allow held while a second request arrives: on release only the pressed request is decided, the other card shows
  if (section.includes("V2")) {
    friendBg("ask", "taka", "v2 first", "--wait", "2");
    await fast(`S.pending.length === 1 && ${nCards} === 1`, 20000, "v2 first card");
    await sleep(700);
    const first = (await pending())[0];
    const p = await mouseDown(js, input, ALLOW);
    friendBg("ask", "taka", "v2 second", "--wait", "2");
    const arrived = await fast(`S.pending.length === 2`, 20000, "v2 second arrives while held").then(() => true).catch(() => false);
    const cardsWhileHeld = await js(nCards);
    await sleep(600);
    mouseUp(input, p);
    await sleep(2000);
    const left = await pending();
    const ok = arrived && left.length === 1 && left[0].id !== first.id && /v2 second/.test(left[0].text) && (await js(nCards)) === 1;
    check("V2 Allow held while a second request arrives: only the pressed one is allowed, the new card shows after release", ok,
      `arrived=${arrived} cardsWhileHeld=${cardsWhileHeld} pressed=${JSON.stringify(first?.text)} left=${JSON.stringify(left.map((x) => x.text))}`);
    for (let k = 0; k < 3 && (await js(exists(CARD))); k++) { await press(js, input, CARD); await sleep(900); }
  }

  // V3 two cards, a double-click on the top card's Allow: the second click must not allow the other request
  if (section.includes("V3")) {
    const runs = [];
    for (const gap of [90, 250]) {
      friendBg("ask", "taka", `v3 A gap${gap}`, "--wait", "2");
      await sleep(400);
      friendBg("ask", "taka", `v3 B gap${gap}`, "--wait", "2");
      await fast(`S.pending.length === 2 && ${nCards} === 2`, 25000, "v3 two cards");
      await sleep(1200);
      const before = await pending();
      // a person double-clicks one spot: the second click goes to the same coordinates, whatever is there by then
      const p = await mouseDown(js, input, ALLOW);
      await sleep(40);
      mouseUp(input, p);
      await sleep(gap);
      input({ type: "mouseDown", x: p.x, y: p.y, button: "left", clickCount: 2 });
      await sleep(40);
      input({ type: "mouseUp", x: p.x, y: p.y, button: "left", clickCount: 2 });
      await sleep(1800);
      const after = await pending();
      runs.push({ gap, before: before.map((x) => x.text), after: after.map((x) => x.text) });
      for (let k = 0; k < 3 && (await js(exists(CARD))); k++) { await press(js, input, CARD); await sleep(900); }
    }
    check("V3 double-click on Allow with two cards: the second request is not allowed by the second click", runs.every((r) => r.after.length === 1), JSON.stringify(runs));
  }

  const invite = () => {
    const r = friend("invite", "--no-wait");
    const m = /elefant-relay join (\S+)/.exec(r.stdout ?? "");
    if (!m) throw new Error(`friend invite failed: ${r.stdout}${r.stderr}`);
    return m[1];
  };
  const openEnter = async (code) => {
    await press(js, input, ".add");
    await until(js, exists(".modal .tabs button:nth-of-type(2)"), 5000, "connect dialog");
    await sleep(900);
    await press(js, input, ".modal .tabs button:nth-of-type(2)");
    await until(js, exists("#in-join"), 3000, "enter tab");
    await until(js, type("#in-join", code), 3000, "type code");
  };

  // V4 Close held while Join comes back (relay 600 ms late): the check-number dialog must show (the joiner-side twin of C5)
  if (section.includes("V4")) {
    await delay(600);
    await openEnter(invite());
    await press(js, input, ".modal .row button.primary", 60);
    const p = await mouseDown(js, input, ".modal .row button.ghost");
    const joined = await fast(`modal && modal.kind === "paired"`, 30000, "join returns while Close is held").then(() => true).catch(() => false);
    await sleep(700);
    mouseUp(input, p);
    await sleep(1000);
    const shown = await js(exists(".modal .check"));
    check("V4 Close held while Join returns → the check-number dialog still shows", joined && shown, `joined=${joined} dialog=${shown} err=${await js(`document.querySelector(".modal .err")?.textContent || ""`)}`);
    if (shown) await press(js, input, ".modal .row button.primary");
    await sleep(800);
    if (await js(exists(".modal"))) { await js(`(modal = null, render(), true)`); await sleep(300); }
    await delay(0);
  }

  // V5 Join (relay 500 ms late), then OK pressed 0–1000 ms after the dialog shows: one click closes it
  if (section.includes("V5")) {
    await delay(500);
    const lostJoin = [], lostOk = [];
    for (const d of [0, 60, 150, 300, 500, 750, 1000]) {
      await openEnter(invite());
      await press(js, input, ".modal .row button.primary", 60);
      const got = await fast(exists(".modal .check"), 30000, "paired dialog after Join").then(() => true).catch(() => false);
      if (!got) { lostJoin.push({ d, err: await js(`document.querySelector(".modal .err")?.textContent || ""`) }); await js(`(modal = null, render(), true)`); await sleep(500); continue; }
      await sleep(d);
      await press(js, input, ".modal .row button.primary", 80);
      await sleep(250);
      if (await js(exists(".modal"))) { lostOk.push(d); await js(`(modal = null, render(), true)`); }
      await sleep(1200);
    }
    await delay(0);
    check("V5a Join pressed once: the check-number dialog shows (7 tries)", lostJoin.length === 0, JSON.stringify(lostJoin));
    check("V5b OK pressed 0–1000 ms after the dialog shows closes it on the first click (7 tries)", lostOk.length === 0, `lost at ${JSON.stringify(lostOk)} ms`);
  }

  for (const c of bg) c.kill();
  writeFileSync(out("verify-result.json"), JSON.stringify(results, null, 1));
}
