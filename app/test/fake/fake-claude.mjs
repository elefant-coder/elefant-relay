// Stand-in for `claude` in the Windows test: records how it was called, echoes requests, writes duo messages.
import { appendFileSync } from "node:fs";
let s = "";
process.stdin.on("data", (d) => (s += d));
process.stdin.on("end", () => {
  if (process.env.FAKE_LOG) appendFileSync(process.env.FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\n");
  const req = (s.match(/<request from="[^"]*">\n([\s\S]*)\n<\/request>/) ?? [])[1];
  if (req !== undefined) process.stdout.write(`FAKE-CLAUDE on ${process.platform} got: ${req}`);
  else if (/summary|まとめ/i.test(s.slice(-600))) process.stdout.write("Summary: Wednesday 15:00 works for both.");
  else process.stdout.write("Wednesday 15:00 works for us. Does it work for you?");
});
