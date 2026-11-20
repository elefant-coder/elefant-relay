// An older Elefant Relay holds the mailbox: the app names it (command line found) and its Stop button takes over.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { out, until, click, exists } from "./ui.mjs";

export default async function ({ js, shot }) {
  const cmd = await until(js, `document.querySelector(".banner.warn pre")?.textContent || ""`, 30000, "old listener card with its command line");
  writeFileSync(out("old-command.txt"), cmd);
  await shot(out("old-1-card.png"));
  await until(js, click(".banner.warn button.primary"), 5000, "stop");
  await until(js, `!document.querySelector(".banner.warn")`, 40000, "card gone");
  await until(js, exists(".side"), 5000, "side");
  await new Promise((r) => setTimeout(r, 7000)); // the app takes the mailbox within 5 s
  await shot(out("old-2-mine.png"));
  let via = "none";
  try { via = JSON.parse(readFileSync(join(process.env.ELEFANT_RELAY_HOME, "listener.json"), "utf8")).via; } catch { /* none */ }
  writeFileSync(out("old-via.txt"), String(via));
  writeFileSync(out("old-done"), "1");
}
