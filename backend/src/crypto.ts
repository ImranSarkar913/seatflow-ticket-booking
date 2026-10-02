import {
  randomBytes,
  scrypt as nativeScrypt,
  timingSafeEqual,
  createHash,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(nativeScrypt);
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = () => randomBytes(32).toString("hex");
export async function passwordHash(value: string) {
  const salt = randomBytes(16).toString("hex");
  const result = (await scrypt(value, salt, 64)) as Buffer;
  return `${salt}:${result.toString("hex")}`;
}
export async function verifyPassword(value: string, stored: string) {
  const [salt, h] = stored.split(":");
  if (!salt || !h) return false;
  const actual = (await scrypt(value, salt, 64)) as Buffer;
  const expected = Buffer.from(h, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function signature(secret: string, timestamp: string, raw: Buffer) {
  return createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(raw)
    .digest("hex");
}
export function verifySignature(
  secret: string,
  timestamp: string,
  raw: Buffer,
  sig: string,
  now = Date.now(),
) {
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    !/^[a-f0-9]{64}$/.test(sig)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(sig, "hex"),
    Buffer.from(signature(secret, timestamp, raw), "hex"),
  );
}
