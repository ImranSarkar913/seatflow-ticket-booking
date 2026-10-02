import { config } from "./config";
function origin(value: string) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    u.pathname !== "/" ||
    !["http:", "https:"].includes(u.protocol)
  )
    throw new Error(
      "Payment URLs must be http(s) origins without paths or credentials",
    );
  return u.origin;
}
export const paymentConfig = {
  environment: process.env.PAYMENT_ENVIRONMENT ?? "sandbox",
  callbackOrigin: origin(process.env.PAYMENT_CALLBACK_ORIGIN ?? config.origin),
  ssl: {
    enabled: process.env.SSLCOMMERZ_ENABLED === "true",
    id: process.env.SSLCOMMERZ_STORE_ID ?? "",
    secret: process.env.SSLCOMMERZ_STORE_PASSWORD ?? "",
  },
  bkash: {
    enabled: process.env.BKASH_ENABLED === "true",
    username: process.env.BKASH_USERNAME ?? "",
    password: process.env.BKASH_PASSWORD ?? "",
    key: process.env.BKASH_APP_KEY ?? "",
    secret: process.env.BKASH_APP_SECRET ?? "",
  },
};
if (!["sandbox", "live"].includes(paymentConfig.environment))
  throw new Error("Invalid PAYMENT_ENVIRONMENT");
if (
  paymentConfig.ssl.enabled &&
  (!paymentConfig.ssl.id || !paymentConfig.ssl.secret)
)
  throw new Error("SSLCOMMERZ credentials required");
if (
  paymentConfig.bkash.enabled &&
  Object.entries(paymentConfig.bkash).some(([k, v]) => k !== "enabled" && !v)
)
  throw new Error("bKash credentials required");
if (
  paymentConfig.environment === "live" &&
  (!config.secure ||
    !config.origin.startsWith("https://") ||
    !paymentConfig.callbackOrigin.startsWith("https://") ||
    config.sandbox)
)
  throw new Error(
    "Live payment requires HTTPS, secure cookies and ENABLE_SANDBOX=false",
  );
export const sslOrigin =
  paymentConfig.environment === "live"
    ? "https://securepay.sslcommerz.com"
    : "https://sandbox.sslcommerz.com";
export const bkashOrigin =
  paymentConfig.environment === "live"
    ? "https://tokenized.pay.bka.sh"
    : "https://tokenized.sandbox.bka.sh";
