import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, relative, isAbsolute, resolve } from "node:path";
import { home } from "./home.js";
import { completion, findSyncthing, myDeviceId, shareFolder } from "./syncthing.js";
import { findPeer, loadPeers, saveConfig, savePeer, type Config, type Peer } from "./state.js";
import type { Identity } from "./crypto.js";

const INSTALL_HINT = "install Syncthing (https://syncthing.net · macOS: brew install syncthing && brew services start syncthing), then pair again";
const HIDDEN = new Set([".stfolder", ".stignore", ".stversions", ".DS_Store"]);

export const shareDir = (cfg: Config): string => cfg.shareDir ?? join(homedir(), "Relay");

/** My Syncthing device id, if file sharing is on and Syncthing answers. */
export async function myFilesDevice(cfg: Config): Promise<string | undefined> {
  if (!cfg.files) return undefined;
  const st = findSyncthing();
  if (!st) return undefined;
  try { return await myDeviceId(st); } catch { return undefined; }
}

/** The folder id that all of my own computers share (made on first use). */
export function ensureOwnFolder(cfg: Config): string {
  if (!cfg.ownFolder) {
    cfg.ownFolder = `relay-own-${randomBytes(5).toString("hex")}`;
    saveConfig(cfg);
  }
  return cfg.ownFolder;
}

const pairFolderId = (a: string, b: string): string =>
  `relay-${createHash("sha256").update([a, b].sort().join(".")).digest("hex").slice(0, 20)}`;

/**
 * After pairing: add the peer to the local Syncthing and share one folder.
 * - own computers: the "My computers" folder (same id on every computer of yours)
 * - someone else: a folder just for the two of you (~/Relay/<name>)
 * Returns a line to show the user. Never throws: pairing itself already succeeded.
 */
export async function linkFiles(me: Identity, cfg: Config, peer: Peer, ownFolder: string | undefined): Promise<string> {
  if (!cfg.files) return "";
  if (!peer.device) return `📁 files: ${peer.name} has not turned on file sharing, so only requests work for now`;
  const st = findSyncthing();
  if (!st) return `📁 files: Syncthing was not found — ${INSTALL_HINT}`;
  let id: string;
  let path: string;
  let label: string;
  if (ownFolder) {
    if (!cfg.ownFolder) { cfg.ownFolder = ownFolder; saveConfig(cfg); }
    id = ownFolder;
    path = join(shareDir(cfg), ownFolder === cfg.ownFolder ? "My computers" : `My computers (${peer.name})`);
    label = "Relay · My computers";
  } else {
    id = pairFolderId(me.signPub, peer.signPub);
    path = join(shareDir(cfg), peer.name);
    label = `Relay · ${peer.name}`;
  }
  try {
    mkdirSync(path, { recursive: true });
    await shareFolder(st, { peerDevice: peer.device, peerName: peer.name, folderId: id, label, path });
    savePeer({ ...peer, folder: { id, path } });
    return `📁 files: ${path} is shared with ${peer.name} (Syncthing). Put files there, or use \`elefant-relay send ${peer.name} <file>\``;
  } catch (e) {
    return `📁 files: could not set up Syncthing (${e instanceof Error ? e.message : String(e)})`;
  }
}

function folderOf(peerName: string): { peer: Peer; path: string; id: string } {
  const peer = findPeer(peerName);
  if (!peer) throw new Error(`no peer named "${peerName}"`);
  if (!peer.folder) throw new Error(`no shared folder with ${peer.name} — file sharing needs Syncthing on both sides (elefant-relay setup --files, then pair again)`);
  return { peer, path: peer.folder.path, id: peer.folder.id };
}

const inside = (dir: string, f: string): boolean => {
  const r = relative(dir, f);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};

/** Copy a file or folder into the folder shared with this peer. Syncthing does the rest. */
export function sendFile(peerName: string, src: string): { dest: string; peer: string } {
  const { peer, path } = folderOf(peerName);
  if (!existsSync(src)) throw new Error(`not found: ${src}`);
  const real = realpathSync(resolve(src));
  if (inside(realpathSync(home()), real)) throw new Error("files in the elefant-relay folder (keys and settings) cannot be sent");
  if (inside(realpathSync(path), real)) throw new Error("that file is already in the shared folder");
  const base = basename(real);
  let dest = join(path, base);
  for (let i = 2; existsSync(dest); i++) {
    const ext = statSync(real).isDirectory() ? "" : extname(base);
    dest = join(path, `${base.slice(0, base.length - ext.length)} (${i})${ext}`);
  }
  cpSync(real, dest, { recursive: true, dereference: false, errorOnExist: true, preserveTimestamps: true });
  return { dest, peer: peer.name };
}

export interface FileList { peer: string; path: string; sync: string; files: { name: string; size: number; modified: string }[] }

/** What is in the shared folder(s) right now, and how far the other side has synced. */
export async function listFiles(peerName?: string): Promise<FileList[]> {
  const peers = peerName ? [folderOf(peerName).peer] : loadPeers().filter((x) => x.folder);
  const st = findSyncthing();
  const out: FileList[] = [];
  for (const peer of peers) {
    const f = peer.folder!;
    const files = existsSync(f.path) ? readdirSync(f.path).filter((n) => !HIDDEN.has(n) && !n.startsWith(".syncthing.")).map((n) => {
      const s = statSync(join(f.path, n));
      return { name: s.isDirectory() ? `${n}/` : n, size: s.size, modified: s.mtime.toISOString() };
    }) : [];
    const c = st && peer.device ? await completion(st, f.id, peer.device) : null;
    const sync = !st ? "Syncthing not running" : !c ? "unknown" : !c.connected ? `${peer.name} is offline` : c.pct >= 100 ? "in sync" : `${c.pct}% synced to ${peer.name}`;
    out.push({ peer: peer.name, path: f.path, sync, files });
  }
  return out;
}

export function describeFiles(lists: FileList[]): string {
  if (lists.length === 0) return "No shared folders yet. File sharing needs Syncthing on both sides (elefant-relay setup --files, then pair).";
  return lists.map((l) => `${l.peer} — ${l.path} (${l.sync})\n${l.files.length ? l.files.map((x) => `  ${x.name}  ${x.size} bytes  ${x.modified.slice(0, 16).replace("T", " ")}`).join("\n") : "  (empty)"}`).join("\n\n");
}
