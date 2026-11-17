import { boxId, newCode, normCode, pairSeal, pairOpen, pairSlot, safetyNumber, signBytes, verifyBytes, type Identity } from "./crypto.js";
import { pairGet, pairPut } from "./relayClient.js";
import { loadPeers, savePeer, type Config, type Peer, type Use } from "./state.js";
import { p, readJson, writeJson } from "./home.js";
import { linkFiles, myFilesDevice, ensureOwnFolder } from "./files.js";

/** st = my Syncthing device id (when files are on); own = the folder id of "my computers" (own-device pairing only) */
interface Card { name: string; signPub: string; encPub: string; relay: string; st?: string; own?: string; sig: string }
interface OpenInvite { code: string; relay: string; created: number; use: Use }
export interface Paired { peer: Peer; note: string; code?: string }

const INVITE_TTL = 600_000;
const cardBytes = (c: Omit<Card, "sig">): Buffer =>
  Buffer.from(JSON.stringify(["elefant-relay-card-v2", c.name, c.signPub, c.encPub, c.relay, c.st ?? "", c.own ?? ""]));
function card(me: Identity, relay: string, st?: string, own?: string): Card {
  const c = { name: me.name, signPub: me.signPub, encPub: me.encPub, relay, ...(st ? { st } : {}), ...(own ? { own } : {}) };
  return { ...c, sig: signBytes(me, cardBytes(c)) };
}

/** A card must be self-signed, so nobody can swap only the encryption key. */
function isCard(x: unknown): x is Card {
  const c = x as Partial<Card>;
  if (typeof c?.name !== "string" || typeof c.signPub !== "string" || typeof c.encPub !== "string"
    || typeof c.relay !== "string" || typeof c.sig !== "string" || !/^https?:\/\//.test(c.relay)
    || (c.st !== undefined && typeof c.st !== "string") || (c.own !== undefined && (typeof c.own !== "string" || !/^relay-own-[0-9a-f]{10,32}$/.test(c.own)))) return false;
  return verifyBytes(c.signPub, cardBytes(c as Card), c.sig);
}

/** The check number covers both people's signing and encryption keys. */
const keysOf = (x: { signPub: string; encPub: string }): string => `${x.signPub}.${x.encPub}`;

function uniqueName(name: string, box: string): string {
  const clean = name.replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 32) || "peer";
  const taken = loadPeers().filter((x) => x.box !== box).map((x) => x.name);
  if (!taken.includes(clean)) return clean;
  for (let i = 2; ; i++) if (!taken.includes(`${clean}${i}`)) return `${clean}${i}`;
}

/**
 * "own" vs "people" is always this side's own choice, never what the other side's card says.
 * The shared folder is the "my computers" folder only when both sides chose own-device pairing.
 */
async function addPeer(me: Identity, cfg: Config, c: Card, kind: Use, ownFolder: string | undefined): Promise<Paired> {
  const box = boxId(c.signPub);
  const peer: Peer = {
    name: uniqueName(c.name, box), box, signPub: c.signPub, encPub: c.encPub, relay: c.relay,
    safety: safetyNumber(keysOf(me), keysOf(c)), added: new Date().toISOString(), kind,
    ...(c.st ? { device: c.st } : {}),
  };
  // The two-person folder starts empty, so it is shared right away. "My computers" already holds your files:
  // it is shared only after the owner confirms the check number (confirmOwn).
  if (kind === "own" && ownFolder) {
    savePeer({ ...peer, ownOffer: ownFolder });
    const note = cfg.files && c.st ? `📁 files: "My computers" is shared with ${peer.name} once you confirm the check number` : await linkFiles(me, cfg, peer, undefined);
    return { peer: loadPeers().find((x) => x.box === box) ?? peer, note };
  }
  savePeer(peer);
  const note = await linkFiles(me, cfg, peer, undefined);
  return { peer: loadPeers().find((x) => x.box === box) ?? peer, note };
}

/** Pairing finished for this invite code (by this process or a background receiver)? */
export function pairedFor(code: string): { box: string; note: string } | undefined {
  return readJson<Record<string, { box: string; note: string }>>(p("paired.json"), {})[code];
}

/** The owner confirmed the check number of their own computer: share "My computers" with it. */
export async function confirmOwnFiles(me: Identity, cfg: Config, peer: Peer): Promise<string> {
  if (!peer.ownOffer) return "";
  const note = await linkFiles(me, cfg, peer, peer.ownOffer);
  const fresh = loadPeers().find((x) => x.box === peer.box) ?? peer;
  if (fresh.folder) { const { ownOffer: _done, ...rest } = fresh; savePeer(rest); }
  return note;
}

/** The invite string carries the relay so the other side knows where to look. */
export function inviteString(code: string, relay: string): string {
  return `${code}@${relay.replace(/^https:\/\//, "").replace(/\/+$/, "")}`;
}

/** "ABC-DEF@relay.example.dev", or just "ABC-DEF" when both sides use the same relay. */
export function parseInvite(s: string, myRelay?: string): { code: string; relay: string } {
  const at = s.indexOf("@");
  if (at < 0 && !myRelay) throw new Error("the connection code should look like ABC-DEF@your-relay.workers.dev");
  const code = (at < 0 ? s : s.slice(0, at)).trim();
  let relay = (at < 0 ? myRelay! : s.slice(at + 1)).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(relay)) relay = `https://${relay}`;
  if (normCode(code).length !== 6) throw new Error("the code part should be 6 letters, like K7Q-M2X");
  return { code, relay };
}

export async function createInvite(me: Identity, cfg: Config, use: Use = cfg.use ?? "people"): Promise<{ code: string; full: string }> {
  const code = newCode();
  const relay = cfg.relay;
  const st = await myFilesDevice(cfg);
  const own = use === "own" ? ensureOwnFolder(cfg) : undefined;
  await pairPut(relay, pairSlot(code), "a", pairSeal(code, card(me, relay, st, own)));
  const list = readJson<OpenInvite[]>(p("invites.json"), []).filter((i) => Date.now() - i.created < INVITE_TTL);
  list.push({ code, relay, created: Date.now(), use });
  writeJson(p("invites.json"), list);
  return { code, full: inviteString(code, relay) };
}

/** Check open invites; save peers whose answer has arrived. Returns new peers. */
export async function finishInvites(me: Identity, cfg: Config): Promise<Paired[]> {
  const list = readJson<OpenInvite[]>(p("invites.json"), []);
  if (list.length === 0) return [];
  const keep: OpenInvite[] = [];
  const answered: { c: Card; use: Use; code: string }[] = [];
  for (const inv of list) {
    if (Date.now() - inv.created > INVITE_TTL) continue;
    let blob: string | null = null;
    try { blob = await pairGet(inv.relay, pairSlot(inv.code), "b"); } catch { keep.push(inv); continue; }
    if (!blob) { keep.push(inv); continue; }
    try {
      const c = pairOpen(inv.code, blob);
      if (isCard(c)) answered.push({ c, use: inv.use ?? "people", code: inv.code });
    } catch { /* wrong code or garbage: drop the invite */ }
  }
  writeJson(p("invites.json"), keep);
  const added: Paired[] = [];
  for (const { c, use, code } of answered) {
    // my "my computers" folder is shared only if the joiner also chose own-device pairing (and so echoed my folder id)
    const own = use === "own" && cfg.ownFolder && c.own === cfg.ownFolder ? cfg.ownFolder : undefined;
    added.push({ ...(await addPeer(me, cfg, c, use, own)), code });
  }
  // let a waiting `elefant-relay invite` know, even when a background receiver finished the pairing
  if (added.length) {
    const done = readJson<Record<string, { box: string; note: string }>>(p("paired.json"), {});
    for (const x of added) done[x.code!] = { box: x.peer.box, note: x.note };
    writeJson(p("paired.json"), done);
  }
  return added;
}

export async function joinInvite(me: Identity, cfg: Config, invite: string, use: Use = cfg.use ?? "people"): Promise<Paired> {
  const myRelay = cfg.relay;
  const { code, relay } = parseInvite(invite, myRelay);
  const slot = pairSlot(code);
  const blob = await pairGet(relay, slot, "a");
  if (!blob) throw new Error("no invite found for this code (it may have expired after 10 minutes)");
  let c: unknown;
  try { c = pairOpen(code, blob); } catch { throw new Error("the code does not match"); }
  if (!isCard(c)) throw new Error("the invite is malformed or its signature does not match");
  // own-device pairing joins the inviter's "my computers" folder
  const own = use === "own" && c.own ? c.own : undefined;
  await pairPut(relay, slot, "b", pairSeal(code, card(me, myRelay, await myFilesDevice(cfg), own)));
  return addPeer(me, cfg, c, use, own);
}
