import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { aeadOpen, aeadSeal } from "../src/aead.js";

// The Mac app (Electron) uses the pure-JS cipher; it must read and write the same bytes as the CLI.
test("pure-JS ChaCha20-Poly1305 matches Node's, both ways", () => {
  for (let i = 0; i < 20; i++) {
    const key = randomBytes(32), n = randomBytes(12), aad = randomBytes(i), pt = randomBytes(i * 37);
    const a = aeadSeal(key, n, pt, aad);
    const b = Buffer.from(chacha20poly1305(key, n, aad).encrypt(pt));
    assert.deepEqual(a, b);
    assert.deepEqual(Buffer.from(chacha20poly1305(key, n, aad).decrypt(a)), pt);
    assert.deepEqual(aeadOpen(key, n, b, aad), pt);
  }
  const key = randomBytes(32), n = randomBytes(12);
  const s = aeadSeal(key, n, Buffer.from("hi"));
  s[0] = (s[0] ?? 0) ^ 1;
  assert.throws(() => aeadOpen(key, n, s));
});
