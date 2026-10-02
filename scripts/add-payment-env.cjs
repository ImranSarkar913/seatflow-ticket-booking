// Append only missing settings; never display or overwrite existing secrets.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const target = path.join(root, ".env");
if (!fs.existsSync(target))
  throw new Error("Root .env is missing. Run setup-env.cjs first.");
let current = fs.readFileSync(target, "utf8");
const template = fs.readFileSync(
  path.join(root, "payment.env.example"),
  "utf8",
);
const existing = new Set(
  current
    .split(/\r?\n/)
    .map((x) => x.match(/^\s*([A-Z_0-9]+)\s*=/)?.[1])
    .filter(Boolean),
);
const missing = template.split(/\r?\n/).filter((x) => {
  const m = x.match(/^([A-Z_0-9]+)=/);
  return m && !existing.has(m[1]);
});
if (!missing.length) {
  console.log("Payment settings already exist; nothing changed.");
  process.exit(0);
}
fs.copyFileSync(target, path.join(root, ".env.before-payment-update"));
fs.writeFileSync(
  target,
  current.trimEnd() +
    "\n\n# Payment provider settings\n" +
    missing.join("\n") +
    "\n",
  { mode: 0o600 },
);
console.log(
  "Missing settings added. Providers remain disabled by default. Existing values were preserved.",
);
