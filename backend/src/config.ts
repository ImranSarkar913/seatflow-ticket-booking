import "dotenv/config";
function integer(key: string, fallback: number, min = 1, max = 100000) {
  const v = Number(process.env[key] ?? fallback);
  if (!Number.isSafeInteger(v) || v < min || v > max)
    throw new Error(`Invalid ${key}`);
  return v;
}
function required(key: string) {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}
export const config = {
  port: integer("PORT", 5000),
  db: {
    host: process.env.PGHOST ?? "localhost",
    port: integer("PGPORT", 5432),
    database: process.env.PGDATABASE ?? "seatflow",
    user: process.env.PGUSER ?? "seatflow",
    password: required("PGPASSWORD"),
    max: integer("DB_POOL_MAX", 20, 1, 100),
  },
  redis: process.env.REDIS_URL ?? "redis://localhost:6379",
  origin: process.env.APP_ORIGIN ?? "http://localhost:3000",
  secure: process.env.COOKIE_SECURE === "true",
  holdSeconds: integer("HOLD_SECONDS", 300, 10, 1800),
  webhookSecret: required("WEBHOOK_SECRET"),
  sandbox: process.env.ENABLE_SANDBOX === "true",
};
if (config.webhookSecret.length < 32)
  throw new Error("Signing secrets must be at least 32 characters");
if (process.env.NODE_ENV === "production" && !config.secure)
  throw new Error("Production requires COOKIE_SECURE=true");
