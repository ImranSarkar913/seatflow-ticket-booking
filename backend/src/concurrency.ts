import { Database } from "./db";
import { BookingService } from "./booking";
import { randomUUID } from "node:crypto";
import { config } from "./config";
// This benchmark creates and cancels holds. Run ONLY against a disposable seeded demo/test database.
async function main() {
  if (process.env.ALLOW_BENCHMARK !== "true")
    throw new Error("Set ALLOW_BENCHMARK=true on a disposable seeded database");
  const db = new Database();
  try {
    const user = (
      await db.query(
        "SELECT id,email,name,role FROM users WHERE role='CUSTOMER' LIMIT 1",
      )
    ).rows[0];
    const seat = (
      await db.query(
        "SELECT s.id,s.event_id FROM seats s JOIN events e ON e.id=s.event_id WHERE s.booking_id IS NULL AND e.starts_at>now() ORDER BY e.starts_at LIMIT 1",
      )
    ).rows[0];
    if (!user || !seat)
      throw new Error("Seed the demo and ensure at least one available seat");
    const service = new BookingService(db),
      start = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        service.hold(user, randomUUID(), {
          eventId: seat.event_id,
          seatIds: [seat.id],
        }),
      ),
    );
    const successes = results.filter(
      (r): r is PromiseFulfilledResult<any> => r.status === "fulfilled",
    );
    const conflicts = results.filter(
      (r) => r.status === "rejected" && r.reason?.getStatus?.() === 409,
    ).length;
    const unexpected = 100 - successes.length - conflicts;
    console.log(
      JSON.stringify(
        {
          requests: 100,
          successfulHolds: successes.length,
          conflicts,
          unexpected,
          durationMs: Date.now() - start,
          poolSize: config.db.max,
        },
        null,
        2,
      ),
    );
    for (const s of successes) await service.cancel(s.value.id, user);
    if (successes.length !== 1 || unexpected !== 0) process.exitCode = 1;
  } finally {
    await db.onModuleDestroy();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
