// Stand-in for claude/codex in tests: echoes the request and shows what it was given.
import { writeFileSync } from "node:fs";
let s = "";
process.stdin.on("data", (d) => (s += d));
process.stdin.on("end", () => {
  const req = (s.match(/<request from="[^"]*">\n([\s\S]*)\n<\/request>/) ?? [])[1] ?? "";
  if (req.includes("MAKE_FILE")) writeFileSync("made.txt", "x");
  if (req.includes("LEAK")) process.stdout.write("key sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 ");
  if (req.includes("FAIL")) { process.stderr.write("boom"); process.exit(3); }
  const rulesSeen = s.includes("Never talk about bananas") ? " [instructions-present]" : "";
  process.stdout.write(`ECHO(${process.env.ELEFANT_RELAY_MODE},task=${process.env.ELEFANT_RELAY_TASK}):${req}${rulesSeen}`);
});
