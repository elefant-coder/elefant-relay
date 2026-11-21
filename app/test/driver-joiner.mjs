// Joiner (the friend): paste the code, answer the inviter's request, then ask the inviter's AI something.
// env: E2E_OUT E2E_NAME E2E_CODE (or E2E_CODE_FILE) E2E_SEND=1 E2E_WAIT_FILE
import { writeFileSync } from "node:fs";
import { checkLayout, out, env, sleep, until, waitFile, type, click, exists, log, closeModal, chatRoundTrip, allowIncoming } from "./ui.mjs";

export default async function ({ js, shot }) {
  const ms = Number(env("E2E_STEP_MS", "300000"));
  await until(js, exists(".modal #in-name"), 20000, "welcome");
  const code = env("E2E_CODE") || await waitFile(env("E2E_CODE_FILE", out("code.txt")), 120000, "code");
  if (env("E2E_VIA_CONNECT")) {
    // set up with the relay URL first, then use "Connect a friend" → "Enter a code" (the tab must stay after a code is made)
    await until(js, click(".choice button:nth-of-type(2)"), 5000, "choose invite");
    await sleep(300);
    await until(js, type("#in-name", env("E2E_NAME", "joiner")), 5000, "name");
    await until(js, type("#in-relay", env("E2E_RELAY", "")), 5000, "relay");
    await until(js, click(".modal .row button.primary"), 5000, "start");
    await until(js, exists(".modal .code.long"), 30000, "own code made");
    await sleep(3500);
    await until(js, click(".modal .tabs button:nth-of-type(2)"), 5000, "enter-a-code tab");
    await until(js, type("#in-join", code), 5000, "paste code");
    await sleep(3500);
    if (!(await js(`document.querySelector("#in-join")?.value === ${JSON.stringify(code)}`))) throw new Error("pasted code was lost");
    await until(js, click(".modal .row button.primary"), 5000, "join");
  } else {
    await until(js, type("#in-name", env("E2E_NAME", "joiner")), 5000, "name");
    await until(js, type("#in-code", code), 5000, "code");
    await until(js, click(".modal .row button.primary"), 5000, "start");
  }
  await until(js, exists(".modal .check"), 60000, "paired");
  writeFileSync(out("joiner-safety.txt"), await js(`document.querySelector(".modal .check").textContent`));
  await shot(out("joiner-1-paired.png"));
  await closeModal(js);
  log("paired");
  await allowIncoming(js, ms);
  await shot(out("joiner-2-answered.png"));
  log("answered the inviter");
  if (env("E2E_SEND")) {
    await sleep(1000);
    const ans = await chatRoundTrip(js, `ping from ${env("E2E_NAME", "joiner")} on ${process.platform}`, ms);
    writeFileSync(out("joiner-answer.txt"), ans);
    log(`answer: ${ans.slice(0, 200)}`);
    await shot(out("joiner-3-chat.png"));
  }
  await checkLayout(js, "joiner");
  writeFileSync(out("joiner-messages.txt"), await js(`document.querySelector(".msgs")?.innerText || ""`));
  writeFileSync(out("joiner-done"), "1");
  log("joiner done");
  if (env("E2E_WAIT_FILE")) await waitFile(env("E2E_WAIT_FILE"), ms * 2, "the other side");
}
