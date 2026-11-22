// Start `elefant-relay relay local` on a port the OS picks; fail (instead of waiting forever) if it exits first.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

export const startLocalRelay = (cli) => new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, [cli, "relay", "local", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  const onExit = (code) => reject(new Error(`local relay exited (${code}) before listening: ${out}`));
  proc.stdout.on("data", (d) => {
    out += d;
    const url = out.match(/relay listening on (http:\/\/\S+)/)?.[1];
    if (url) { proc.off("exit", onExit); resolve({ proc, url }); }
  });
  proc.stderr.on("data", (d) => { out += d; });
  proc.on("exit", onExit);
});

export const freePort = () => new Promise((r) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
