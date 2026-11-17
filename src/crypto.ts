import {
  generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify, diffieHellman,
  hkdfSync, randomBytes, createCipheriv, createDecipheriv, createHash, scryptSync, KeyObject,
} from "node:crypto";

export const b64u = (b: Uint8Array): string => Buffer.from(b).toString("base64url");
export const unb64u = (s: string): Buffer => Buffer.from(s, "base64url");

export interface Identity {
  name: string;
  signPub: string; // raw 32 bytes, base64url
  signPriv: string; // pkcs8 der, base64url
  encPub: string; // raw 32 bytes, base64url
  encPriv: string; // pkcs8 der, base64url
}

const ED_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const X_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

function rawPub(k: KeyObject): Buffer {
  const der = k.export({ format: "der", type: "spki" });
  return der.subarray(der.length - 32);
}

export function edPubKey(raw: string): KeyObject {
  return createPublicKey({ key: Buffer.concat([ED_SPKI_PREFIX, unb64u(raw)]), format: "der", type: "spki" });
}

export function xPubKey(raw: string): KeyObject {
  return createPublicKey({ key: Buffer.concat([X_SPKI_PREFIX, unb64u(raw)]), format: "der", type: "spki" });
}

const priv = (der: string): KeyObject => createPrivateKey({ key: unb64u(der), format: "der", type: "pkcs8" });

export function newIdentity(name: string): Identity {
  const s = generateKeyPairSync("ed25519");
  const x = generateKeyPairSync("x25519");
  return {
    name,
    signPub: b64u(rawPub(s.publicKey)),
    signPriv: b64u(s.privateKey.export({ format: "der", type: "pkcs8" })),
    encPub: b64u(rawPub(x.publicKey)),
    encPriv: b64u(x.privateKey.export({ format: "der", type: "pkcs8" })),
  };
}

/** Mailbox id = hash of the signing public key. */
export function boxId(signPub: string): string {
  return b64u(createHash("sha256").update(unb64u(signPub)).digest()).slice(0, 32);
}

export function signBytes(id: Identity, data: Buffer): string {
  return b64u(sign(null, data, priv(id.signPriv)));
}

export function verifyBytes(signPub: string, data: Buffer, sig: string): boolean {
  try {
    return verify(null, data, edPubKey(signPub), unb64u(sig));
  } catch {
    return false;
  }
}

export interface Header {
  v: 1;
  id: string; // message id (nonce for replay protection)
  from: string; // sender box id
  to: string; // recipient box id
  ts: number;
  exp: number;
}

export interface Envelope {
  h: Header;
  epk: string; // ephemeral x25519 public key
  n: string; // 12-byte nonce
  ct: string; // ciphertext + 16-byte tag
  sig: string; // ed25519 over canonical(h) | epk | n | ct
}

const canon = (h: Header): Buffer => Buffer.from(JSON.stringify([h.v, h.id, h.from, h.to, h.ts, h.exp]));
const sigInput = (e: Omit<Envelope, "sig">): Buffer =>
  Buffer.concat([canon(e.h), Buffer.from("|"), unb64u(e.epk), unb64u(e.n), unb64u(e.ct)]);

function aeadKey(shared: Buffer, epk: Buffer, rpk: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([epk, rpk]), "elefant-relay-v1-msg", 32));
}

export function seal(sender: Identity, toEncPub: string, toBox: string, payload: unknown, ttlSec = 86400): Envelope {
  const eph = generateKeyPairSync("x25519");
  const epk = rawPub(eph.publicKey);
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: xPubKey(toEncPub) });
  const key = aeadKey(shared, epk, unb64u(toEncPub));
  const now = Math.floor(Date.now() / 1000);
  const h: Header = { v: 1, id: b64u(randomBytes(16)), from: boxId(sender.signPub), to: toBox, ts: now, exp: now + ttlSec };
  const n = randomBytes(12);
  const c = createCipheriv("chacha20-poly1305", key, n, { authTagLength: 16 });
  c.setAAD(canon(h));
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(payload))), c.final(), c.getAuthTag()]);
  const body = { h, epk: b64u(epk), n: b64u(n), ct: b64u(ct) };
  return { ...body, sig: signBytes(sender, sigInput(body)) };
}

export class OpenError extends Error {}

/** Verify signature with the known sender key, check addressing and expiry, then decrypt. */
export function open(me: Identity, senderSignPub: string, e: Envelope): unknown {
  if (e.h?.v !== 1) throw new OpenError("bad version");
  if (e.h.to !== boxId(me.signPub)) throw new OpenError("not addressed to me");
  if (e.h.from !== boxId(senderSignPub)) throw new OpenError("sender mismatch");
  const { sig, ...body } = e;
  if (!verifyBytes(senderSignPub, sigInput(body), sig)) throw new OpenError("bad signature");
  const now = Math.floor(Date.now() / 1000);
  if (e.h.exp < now) throw new OpenError("expired");
  if (e.h.ts > now + 300) throw new OpenError("from the future");
  const shared = diffieHellman({ privateKey: priv(me.encPriv), publicKey: xPubKey(e.epk) });
  const key = aeadKey(shared, unb64u(e.epk), unb64u(me.encPub));
  const raw = unb64u(e.ct);
  const d = createDecipheriv("chacha20-poly1305", key, unb64u(e.n), { authTagLength: 16 });
  d.setAAD(canon(e.h));
  d.setAuthTag(raw.subarray(raw.length - 16));
  try {
    const pt = Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]);
    return JSON.parse(pt.toString("utf8"));
  } catch {
    throw new OpenError("decrypt failed");
  }
}

// ---- pairing (code-derived symmetric encryption) ----
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0/O/1/I/L

export function newCode(): string {
  const b = randomBytes(6);
  let s = "";
  for (const x of b) s += CODE_ALPHABET[x % CODE_ALPHABET.length];
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export function normCode(code: string): string {
  return code.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

export function pairSlot(code: string): string {
  return b64u(createHash("sha256").update("elefant-relay-pair-slot|" + normCode(code)).digest()).slice(0, 32);
}

function pairKey(code: string): Buffer {
  return scryptSync(normCode(code), "elefant-relay-pair-v1", 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function pairSeal(code: string, obj: unknown): string {
  const n = randomBytes(12);
  const c = createCipheriv("chacha20-poly1305", pairKey(code), n, { authTagLength: 16 });
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj))), c.final(), c.getAuthTag()]);
  return b64u(Buffer.concat([n, ct]));
}

export function pairOpen(code: string, blob: string): unknown {
  const raw = unb64u(blob);
  const n = raw.subarray(0, 12);
  const ct = raw.subarray(12, raw.length - 16);
  const d = createDecipheriv("chacha20-poly1305", pairKey(code), n, { authTagLength: 16 });
  d.setAuthTag(raw.subarray(raw.length - 16));
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
}

/** 6-digit safety number both sides can compare. */
export function safetyNumber(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  const h = createHash("sha256").update(`${x}|${y}`).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** Proof of mailbox ownership for the relay: sign("elefant-relay-box|<box>|<ts>"). */
export function boxAuth(id: Identity): { box: string; pub: string; ts: string; sig: string } {
  const box = boxId(id.signPub);
  const ts = String(Math.floor(Date.now() / 1000));
  return { box, pub: id.signPub, ts, sig: signBytes(id, Buffer.from(`elefant-relay-box|${box}|${ts}`)) };
}
