import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolClient, QueryResultRow } from "pg";
import { config } from "./config";
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    ...config.db,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  constructor() {
    this.pool.on("error", (e) =>
      console.error(
        JSON.stringify({ event: "database_error", message: e.message }),
      ),
    );
  }
  async query<T extends QueryResultRow = any>(
    sql: string,
    values: unknown[] = [],
  ) {
    return this.pool.query<T>(sql, values);
  }
  async tx<T>(
    fn: (c: PoolClient) => Promise<T>,
    client?: PoolClient,
  ): Promise<T> {
    const c = client ?? (await this.pool.connect());
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL lock_timeout='5s'");
      await c.query("SET LOCAL statement_timeout='10s'");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      if (!client) c.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
export async function eventLock(c: PoolClient, id: string) {
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [id]);
}
