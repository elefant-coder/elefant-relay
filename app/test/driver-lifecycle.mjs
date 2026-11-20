// Windows window life: close → hidden (still running), tray icon present, a second launch shows the window, tray Quit exits.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { out, sleep, until, exists } from "./ui.mjs";

export default async function ({ js, shot, main }) {
  const res = [];
  const check = (ok, what) => { res.push(`${ok ? "PASS" : "FAIL"} ${what}`); };
  await until(js, exists("#app .layout"), 20000, "window up");
  const t = main.tray();
  check(t.exists && !t.empty, "tray icon is there and has an image");
  main.close();
  await sleep(1500);
  check(!main.visible(), "closing the window hides it (the app keeps running)");
  const second = spawn(main.execPath, [], { env: process.env, stdio: "ignore" });
  const code = await new Promise((r) => { second.on("close", r); setTimeout(() => r("still running"), 20000); });
  check(code === 0, `a second launch exits at once (${code})`);
  const end = Date.now() + 10000;
  while (!main.visible() && Date.now() < end) await sleep(300);
  check(main.visible(), "a second launch brings the window back");
  await shot(out("lifecycle-back.png"));
  writeFileSync(out("lifecycle.txt"), res.join("\n"));
  main.trayQuit(); // the exit code tells whether tray Quit ends the app
  await sleep(10000);
  writeFileSync(out("lifecycle.txt"), res.join("\n") + "\nFAIL tray Quit did not end the app");
}
