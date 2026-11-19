// ChaCha20-Poly1305 with the tag appended (ciphertext | 16-byte tag).
// Node's OpenSSL has it; Electron's BoringSSL does not offer it through createCipheriv,
// so there (the Mac app) a pure-JS implementation is loaded instead. Same bytes either way.
import { createCipheriv, createDecipheriv } from "node:crypto";

const native = (() => {
  try {
    createCipheriv("chacha20-poly1305", Buffer.alloc(32), Buffer.alloc(12), { authTagLength: 16 });
    return true;
  } catch {
    return false;
  }
})();

const js: typeof import("@noble/ciphers/chacha.js") | null = native ? null : await import("@noble/ciphers/chacha.js");

export function aeadSeal(key: Buffer, nonce: Buffer, pt: Buffer, aad?: Buffer): Buffer {
  if (js) return Buffer.from(js.chacha20poly1305(key, nonce, aad).encrypt(pt));
  const c = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  if (aad) c.setAAD(aad);
  return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
}

/** Throws when the message was altered or the key is wrong. */
export function aeadOpen(key: Buffer, nonce: Buffer, sealed: Buffer, aad?: Buffer): Buffer {
  if (sealed.length < 16) throw new Error("too short");
  if (js) return Buffer.from(js.chacha20poly1305(key, nonce, aad).decrypt(sealed));
  const d = createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  if (aad) d.setAAD(aad);
  d.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
}
