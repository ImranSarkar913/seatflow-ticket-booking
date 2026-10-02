import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { paymentConfig, sslOrigin, bkashOrigin } from "./payment-config";
export type Provider = "sslcommerz" | "bkash";
export function paisa(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value))
    throw new BadRequestException("Invalid provider amount");
  const [a, b = ""] = value.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new BadRequestException("Invalid provider amount");
  return n;
}
export function taka(value: number) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Invalid local amount");
  return (value / 100).toFixed(2);
}
export function safeCheckout(value: unknown, provider: Provider): string {
  if (typeof value !== "string" || value.length > 8192)
    throw new BadGatewayException("Invalid checkout URL");
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new BadGatewayException("Invalid checkout URL");
  }
  const allowed =
    provider === "sslcommerz"
      ? [new URL(sslOrigin).hostname]
      : paymentConfig.environment === "live"
        ? ["payment.bkash.com", "tokenized.pay.bka.sh"]
        : ["sandbox.payment.bkash.com", "tokenized.sandbox.bka.sh"];
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    !allowed.includes(u.hostname)
  )
    throw new BadGatewayException("Untrusted checkout URL");
  return u.href;
}
export async function providerRequest(
  url: string,
  body?: Record<string, string>,
  headers: Record<string, string> = {},
  json = false,
): Promise<any> {
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/json",
        ...(body
          ? {
              "Content-Type": json
                ? "application/json"
                : "application/x-www-form-urlencoded",
            }
          : {}),
        ...headers,
      },
      body: body
        ? json
          ? JSON.stringify(body)
          : new URLSearchParams(body)
        : undefined,
    });
    if (!res.ok) throw new Error();
    const raw = await res.text();
    if (raw.length > 131072) throw new Error();
    const result = JSON.parse(raw);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result;
  } catch {
    throw new BadGatewayException(
      "Payment provider unavailable; verification may be pending. Do not pay again.",
    );
  }
}
let cached: { token: string; expires: number } | undefined;
let granting: Promise<string> | undefined;
async function token() {
  if (cached && cached.expires > Date.now()) return cached.token;
  if (granting) return granting;
  granting = (async () => {
    const b = paymentConfig.bkash;
    const r = await providerRequest(
      bkashOrigin + "/v1.2.0-beta/tokenized/checkout/token/grant",
      { app_key: b.key, app_secret: b.secret },
      { username: b.username, password: b.password },
      true,
    );
    if (r.statusCode !== "0000" || typeof r.id_token !== "string")
      throw new BadGatewayException("bKash authentication failed");
    const seconds = Number(r.expires_in);
    cached = {
      token: r.id_token,
      expires:
        Date.now() +
        Math.max(
          30,
          Math.min(Number.isFinite(seconds) ? seconds : 300, 3600) - 60,
        ) *
          1000,
    };
    return r.id_token;
  })();
  try {
    return await granting;
  } finally {
    granting = undefined;
  }
}
export async function bkashRequest(path: string, body: Record<string, string>) {
  return providerRequest(
    bkashOrigin + "/v1.2.0-beta/tokenized/checkout/" + path,
    body,
    { authorization: await token(), "x-app-key": paymentConfig.bkash.key },
    true,
  );
}
export function sslCredentials() {
  return {
    store_id: paymentConfig.ssl.id,
    store_passwd: paymentConfig.ssl.secret,
  };
}
export async function sslQuery(
  fields: Record<string, string>,
  validation = false,
) {
  const u = new URL(
    sslOrigin +
      "/validator/api/" +
      (validation
        ? "validationserverAPI.php"
        : "merchantTransIDvalidationAPI.php"),
  );
  u.search = new URLSearchParams({
    ...sslCredentials(),
    ...fields,
    format: "json",
  }).toString();
  return providerRequest(u.href);
}
export function verifySettlement(
  provider: Provider,
  r: any,
  p: any,
  remoteId?: string,
) {
  const invoice =
    provider === "sslcommerz"
      ? r.tran_id
      : (r.merchantInvoiceNumber ?? r.merchantInvoice);
  if (
    invoice !== p.invoice ||
    paisa(r.amount) !== p.amount ||
    r.currency !== "BDT" ||
    (provider === "bkash" &&
      (r.paymentID !== remoteId || r.intent !== "sale")) ||
    (provider === "sslcommerz" && String(r.risk_level) !== "0")
  )
    throw new BadRequestException(
      "Provider payment identity, amount, currency or risk mismatch",
    );
  const reference = provider === "sslcommerz" ? r.bank_tran_id : r.trxID;
  if (typeof reference !== "string" || !reference || reference.length > 120)
    throw new BadRequestException("Missing provider settlement reference");
  return reference;
}
