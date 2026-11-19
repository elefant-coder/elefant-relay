import { randomBytes } from "node:crypto";
import { readdirSync, existsSync, unlinkSync } from "node:fs";
import { p, readJson, writeJson, readText, writeText, ensureDir } from "./home.js";
import type { Identity } from "./crypto.js";

export type Mode = "read" | "write";
export type AgentKind = "claude" | "codex" | "command";
/** "own" = linking your own computers, "people" = linking with someone else */
export type Use = "own" | "people";

export interface Config {
  relay: string;
  agent: AgentKind;
  /** for agent "command": shell command; the request text is given on stdin */
  command?: string;
  /** base folder for write jobs (default ~/elefant-relay-work) */
  workdir?: string;
  /** extra tools the owner allows even for read jobs (Claude tool names, e.g. "mcp__notion__search") */
  extraTools?: string[];
  timeoutSec?: number;
  /** extra arguments for the agent CLI, e.g. ["--model", "sonnet"] */
  agentArgs?: string[];
  /** chosen at setup; each pairing can override it */
  use?: Use;
  /** share files with Syncthing (opt-in at setup) */
  files?: boolean;
  /** where shared folders live (default ~/Relay) */
  shareDir?: string;
  /** folder id shared by all of your own computers */
  ownFolder?: string;
  /** which elefant-relay the AI apps start ("off" = not registered by us) */
  mcp?: { version: string; path: string } | "off";
}

export interface Peer {
  name: string;
  box: string;
  signPub: string;
  encPub: string;
  relay: string;
  safety: string;
  added: string;
  kind?: Use;
  /** Syncthing device id and the folder shared with this peer */
  device?: string;
  folder?: { id: string; path: string };
  /** own-device pairing: the "My computers" folder, shared only after the owner confirms the check number */
  ownOffer?: string;
}

export interface Rule {
  id: string;
  /** peer name or "*" */
  peer: string;
  mode: Mode | "*";
  action: "allow" | "deny";
  /** ISO date-time; rule is ignored after this */
  until?: string;
  note?: string;
  created: string;
}

export interface TaskPayload {
  type: "task";
  task: { id: string; mode: Mode; message: { role: "user"; parts: { kind: "text"; text: string }[] } };
}
export type ResultStatus = "completed" | "failed" | "rejected";
export interface ResultPayload { type: "result"; taskId: string; status: ResultStatus; text: string }
export interface StatusPayload { type: "status"; taskId: string; state: "waiting-approval" | "working" }
export type Payload = TaskPayload | ResultPayload | StatusPayload;

export interface Pending {
  /** local id (what the owner approves) */
  id: string;
  /** the requester's task id (what we reply to) */
  taskId: string;
  peer: string;
  mode: Mode;
  text: string;
  received: string;
  replyTo: string; // peer name
  decision?: "once" | "always" | "deny" | "deny-always";
}

export interface ResultRecord {
  taskId: string;
  peer: string;
  status: ResultStatus | "waiting-approval" | "working" | "sent";
  text?: string;
  updated: string;
}

export const newId = (): string => randomBytes(8).toString("hex");

export const loadIdentity = (): Identity | null => readJson<Identity | null>(p("identity.json"), null);
export const saveIdentity = (id: Identity): void => writeJson(p("identity.json"), id);
export function mustIdentity(): Identity {
  const id = loadIdentity();
  if (!id) throw new Error("elefant-relay is not set up yet. Run: npx elefant-relay setup --relay <URL>");
  return id;
}

export const loadConfig = (): Config | null => readJson<Config | null>(p("config.json"), null);
export const saveConfig = (c: Config): void => writeJson(p("config.json"), c);
export function mustConfig(): Config {
  const c = loadConfig();
  if (!c) throw new Error("elefant-relay is not set up yet. Run: npx elefant-relay setup --relay <URL>");
  return c;
}

export const loadPeers = (): Peer[] => readJson<Peer[]>(p("peers.json"), []);
export function savePeer(peer: Peer): void {
  const peers = loadPeers().filter((x) => x.box !== peer.box && x.name !== peer.name);
  peers.push(peer);
  writeJson(p("peers.json"), peers);
}
export function findPeer(nameOrBox: string): Peer | undefined {
  const all = loadPeers();
  return all.find((x) => x.name === nameOrBox) ?? all.find((x) => x.box === nameOrBox)
    ?? all.find((x) => x.name.toLowerCase() === nameOrBox.toLowerCase());
}

export const loadRules = (): Rule[] => readJson<{ rules: Rule[] }>(p("rules.json"), { rules: [] }).rules;
export const saveRules = (rules: Rule[]): void => writeJson(p("rules.json"), { rules });

export const loadInstructions = (): string => readText(p("instructions.md"));
export const saveInstructions = (t: string): void => writeText(p("instructions.md"), t);

// replay protection: remember message ids until they expire
export function seenBefore(id: string, exp: number): boolean {
  const file = p("seen.json");
  const now = Math.floor(Date.now() / 1000);
  const seen = readJson<Record<string, number>>(file, {});
  for (const [k, v] of Object.entries(seen)) if (v < now) delete seen[k];
  if (seen[id] !== undefined) return true;
  seen[id] = exp;
  writeJson(file, seen);
  return false;
}

export const pendingFile = (id: string): string => p("pending", `${id}.json`);
export function listPending(): Pending[] {
  const dir = p("pending");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Pending | null>(p("pending", f), null))
    .filter((x): x is Pending => x !== null && x.decision === undefined);
}
export const savePending = (x: Pending): void => writeJson(pendingFile(x.id), x);
export const loadPending = (id: string): Pending | null => readJson<Pending | null>(pendingFile(id), null);
export function removePending(id: string): void {
  if (existsSync(pendingFile(id))) unlinkSync(pendingFile(id));
}

export const resultFile = (id: string): string => p("results", `${id}.json`);
export function saveResult(r: ResultRecord): void {
  ensureDir(p("results"));
  writeJson(resultFile(r.taskId), r);
}
export const loadResult = (id: string): ResultRecord | null => readJson<ResultRecord | null>(resultFile(id), null);
