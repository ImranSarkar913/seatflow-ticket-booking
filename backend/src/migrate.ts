import { Database } from "./db";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
export async function migrate(db: Database) {
  await db.tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(202610021)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())",
    );
    for (const name of (await readdir(resolve(process.cwd(), "migrations")))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = await readFile(resolve("migrations", name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const old = (
        await c.query("SELECT checksum FROM schema_migrations WHERE name=$1", [
          name,
        ])
      ).rows[0];
      if (old) {
        if (old.checksum !== checksum)
          throw new Error(`Migration checksum changed: ${name}`);
        continue;
      }
      await c.query(sql);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      console.log(`Applied ${name}`);
    }
  });
}
if (require.main === module) {
  const db = new Database();
  migrate(db)
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => db.onModuleDestroy());
}
