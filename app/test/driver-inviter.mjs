// Inviter: set up with a relay URL, make a code, wait for the friend, chat, (AI-to-AI), answer the friend.
// env: E2E_OUT E2E_RELAY E2E_NAME E2E_PAIR_MS E2E_DUO=1 E2E_EXPECT_CARD=1 E2E_WAIT_FILE
import { writeFileSync } from "node:fs";
import { checkLayout, OUT, out, env, sleep, until, waitFile, click, type, exists, log, closeModal, chatRoundTrip, allowIncoming } from "./ui.mjs";

export default async function ({ js, shot }) {
  const ms = Number(env("E2E_STEP_MS", "300000"));
  await until(js, exists(".modal #in-name"), 20000, "welcome");
  await shot(out("inviter-1-welcome.png"));
  await until(js, click(".choice button:nth-of-type(2)"), 5000, "choose invite");
  await sleep(300);
  await until(js, type("#in-name", env("E2E_NAME", "inviter")), 5000, "name");
  await until(js, type("#in-relay", env("E2E_RELAY", "")), 5000, "relay");
  await until(js, click(".modal .row button.primary"), 5000, "start");
  const code = await until(js, `document.querySelector(".code.long")?.textContent || ""`, 30000, "code");
  writeFileSync(out("code.txt"), code);
  log("code ready");
  await until(js, exists(".modal .check"), Number(env("E2E_PAIR_MS", "120000")), "paired");
  writeFileSync(out("inviter-safety.txt"), await js(`document.querySelector(".modal .check").textContent`));
  await shot(out("inviter-2-paired.png"));
  await closeModal(js);
  const ans = await chatRoundTrip(js, `ping from ${env("E2E_NAME", "inviter")} on ${process.platform}`, ms);
  writeFileSync(out("inviter-answer.txt"), ans);
  log(`answer: ${ans.slice(0, 200)}`);
  await shot(out("inviter-3-chat.png"));
  if (env("E2E_DUO")) {
    await until(js, click(".tabs button:nth-of-type(2)"), 5000, "duo tab");
    await sleep(300);
    await until(js, type("#ta-duo", "Pick one time for a meeting next week. We are free on Wednesday afternoon."), 5000, "goal");
    // the rounds menu must survive the 1.5 s refresh while it is open (focused); then pick the last choice (6)
    await js(`(() => { const s = document.querySelector(".duo select"); s.dataset.mark = "1"; s.focus(); return true; })()`);
    await sleep(4000);
    if (!(await js(`(() => { const s = document.querySelector(".duo select"); return !!s && s.dataset.mark === "1" && document.activeElement === s; })()`))) throw new Error("rounds menu was redrawn while open");
    await js(`(() => { const s = document.querySelector(".duo select"); s.value = "6"; s.dispatchEvent(new Event("change")); return true; })()`);
    await sleep(2000);
    if (!(await js(`document.querySelector(".duo select")?.value === "6"`))) throw new Error("rounds choice did not stick");
    await until(js, click(".duo button.primary"), 5000, "duo start");
    for (let i = 0; i < 14; i++) {
      const r = await until(js, `document.querySelector(".summary") ? "summary" : (document.querySelector(".msgs ~ .banner button.primary") ? "confirm" : "")`, ms, `duo step ${i}`);
      if (r === "summary") break;
      if (i === 0) await shot(out("inviter-4-confirm.png"));
      await js(click(".msgs ~ .banner button.primary"));
      await sleep(2000);
    }
    await until(js, exists(".summary"), ms, "summary");
    if (!(await js(`/6往復|up to 6 turns/.test(document.querySelector(".msgs")?.innerText || "")`))) throw new Error("AI-to-AI did not start with 6 rounds");
    await shot(out("inviter-5-summary.png"));
    await until(js, click(".tabs button:nth-of-type(1)"), 5000, "chat tab");
  }
  if (env("E2E_EXPECT_CARD")) { await allowIncoming(js, Number(env("E2E_CARD_MS", String(ms)))); await shot(out("inviter-6-answered.png")); }
  await checkLayout(js, "inviter");
  writeFileSync(out("inviter-messages.txt"), await js(`document.querySelector(".msgs")?.innerText || ""`));
  writeFileSync(out("inviter-done"), "1");
  log("inviter done");
  if (env("E2E_WAIT_FILE")) await waitFile(env("E2E_WAIT_FILE"), ms * 2, "the other side");
  void OUT;
}
