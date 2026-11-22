import { spawn, type ChildProcess } from "node:child_process";

// Start `elefant-relay relay local` on a port the OS picks (no random-port clashes) and return its URL.
// If the relay exits before it listens, fail with its output instead of leaving the test waiting forever.
export const startLocalRelay = (cli: string): Promise<{ proc: ChildProcess; url: string }> =>
  new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cli, "relay", "local", "--port", "0"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const onData = (d: Buffer): void => {
      out += d.toString();
      const url = out.match(/relay listening on (http:\/\/\S+)/)?.[1];
      if (url) { proc.off("exit", onExit); resolve({ proc, url }); }
    };
    const onExit = (code: number | null): void => reject(new Error(`local relay exited (${code}) before listening: ${out}`));
    proc.stdout!.on("data", onData);
    proc.stderr!.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("exit", onExit);
  });
