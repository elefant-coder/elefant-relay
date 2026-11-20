// Helpers for driving the app window like a person (see ELEFANT_RELAY_TEST_DRIVER in main.mjs).
// Selectors only, no labels, so the drivers work whatever language the app shows.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OUT = process.env.E2E_OUT ?? ".";
export const out = (f) => join(OUT, f);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const env = (k, d) => process.env[k] ?? d;

export async function until(js, cond, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await js(cond);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await sleep(500);
  }
}
export async function waitFile(f, ms, what) {
  const end = Date.now() + ms;
  while (!existsSync(f)) { if (Date.now() > end) throw new Error(`timeout: ${what}`); await sleep(500); }
  return readFileSync(f, "utf8").trim();
}
export const click = (sel) => `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`;
export const type = (sel, text) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.value = ${JSON.stringify(text)}; e.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`;
export const exists = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
export const count = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;
/** a request card from a friend (has a decline button) — press "always allow" */
export const clickAlways = `(() => { const c = [...document.querySelectorAll(".banner")].find((b) => b.querySelector("button.danger")); if (!c) return false; c.querySelectorAll(".row button")[1].click(); return true; })()`;
export const answeredNotes = `[...document.querySelectorAll(".note")].filter((n) => /答えを返しました|sent its answer/.test(n.textContent)).length`;
export const log = (s) => { writeFileSync(out("driver.log"), `${new Date().toISOString()} ${s}\n`, { flag: "a" }); };

export async function closeModal(js) { await until(js, click(".modal .row button.primary"), 5000, "close modal"); await sleep(800); }

/** send a chat message and wait for the friend's AI to answer */
export async function chatRoundTrip(js, text, ms) {
  const before = await js(count(".msg.peer-ai"));
  await until(js, type("#ta-chat", text), 5000, "type chat");
  await until(js, click(".compose button.primary"), 5000, "send");
  await until(js, `${count(".msg.peer-ai")} > ${before}`, ms, "friend's answer");
  return js(`[...document.querySelectorAll(".msg.peer-ai .body")].pop().textContent`);
}

/** wait for a request card, allow it always, and wait until our AI has answered */
export async function allowIncoming(js, ms) {
  const before = await js(answeredNotes);
  await until(js, clickAlways, ms, "request card");
  await until(js, `${answeredNotes} > ${before}`, ms, "our AI answered");
}

/** the input box must stay on screen however long the conversation gets ("" = fine) */
export const layoutProblem = `(() => { const c = document.querySelector(".compose, .duo"); if (!c) return "no input box"; const r = c.getBoundingClientRect(); const page = document.scrollingElement.scrollHeight; return r.bottom <= innerHeight + 1 && page <= innerHeight + 1 ? "" : "input box bottom " + Math.round(r.bottom) + "px, page " + page + "px, window " + innerHeight + "px"; })()`;
export async function checkLayout(js, who) {
  const p = await js(layoutProblem);
  writeFileSync(out(`${who}-layout.txt`), p || "ok");
  if (p) throw new Error(`layout: ${p}`);
}
