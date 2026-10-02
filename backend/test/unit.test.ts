import { test } from "node:test";
import assert from "node:assert/strict";
import {
  passwordHash,
  verifyPassword,
  signature,
  verifySignature,
  hash,
} from "../src/crypto";
test("passwords use independent salts and verify correctly", async () => {
  const a = await passwordHash("Long-password-123"),
    b = await passwordHash("Long-password-123");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("Long-password-123", a), true);
  assert.equal(await verifyPassword("wrong-password", a), false);
});
test("webhook signature rejects altered body and stale timestamp", () => {
  const body = Buffer.from('{"amount":75000}'),
    t = String(Math.floor(Date.now() / 1000)),
    secret = "s".repeat(32),
    sig = signature(secret, t, body);
  assert.equal(verifySignature(secret, t, body, sig), true);
  assert.equal(verifySignature(secret, t, Buffer.from("{}"), sig), false);
  assert.equal(
    verifySignature(secret, t, body, sig, Date.now() + 601000),
    false,
  );
  assert.equal(verifySignature(secret, t, body, "bad"), false);
});
test("fingerprints are deterministic and differ for changed payloads", () => {
  assert.equal(hash("a"), hash("a"));
  assert.notEqual(hash("a"), hash("b"));
});
