import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export function home(): string {
  return process.env.ELEFANT_RELAY_HOME ?? join(homedir(), ".elefant-relay");
}

export function p(...parts: string[]): string {
  return join(home(), ...parts);
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

/** Atomic write (write to temp, then rename). */
export function writeJson(file: string, data: unknown, mode = 0o600): void {
  ensureDir(dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode });
  renameSync(tmp, file);
}

export function readText(file: string, fallback = ""): string {
  return existsSync(file) ? readFileSync(file, "utf8") : fallback;
}

export function writeText(file: string, text: string): void {
  ensureDir(dirname(file));
  writeFileSync(file, text, { mode: 0o600 });
}

export function appendLog(entry: Record<string, unknown>): void {
  ensureDir(home());
  appendFileSync(p("log.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", { mode: 0o600 });
}
