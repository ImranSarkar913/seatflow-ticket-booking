import "reflect-metadata";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { Database } from "../dist/db";
import { migrate } from "../dist/migrate";
import { seed } from "../dist/seed";
import { BookingService } from "../dist/booking";
import { createApp } from "../dist/main";
import { config } from "../dist/config";
import { signature } from "../dist/crypto";
import { processOutbox, startWorker } from "../dist/worker";
const db = new Database(),
  service = new BookingService(db);
let app: any,
  server: any,
  user: any,
  admin: any,
  staff: any,
  event: any,
  seats: any[],
  cookie: string,
  csrf: string;
const password = "Test-only-password-123!";
before(async () => {
  if (!config.db.database.endsWith("_test"))
    throw new Error("Integration tests require PGDATABASE ending in _test");
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(db);
  await seed(db, password);
  user = (
    await db.query("SELECT id,email,name,role FROM users WHERE role='CUSTOMER'")
  ).rows[0];
  admin = (
    await db.query("SELECT id,email,name,role FROM users WHERE role='ADMIN'")
  ).rows[0];
  staff = (
    await db.query("SELECT id,email,name,role FROM users WHERE role='STAFF'")
  ).rows[0];
  event = (await db.query("SELECT * FROM events ORDER BY title LIMIT 1"))
    .rows[0];
  seats = (
    await db.query(
      "SELECT * FROM seats WHERE event_id=$1 ORDER BY row_label,number",
      [event.id],
    )
  ).rows;
  app = await createApp();
  await app.init();
  server = app.getHttpServer();
  const login = await request(server)
    .post("/api/auth/login")
    .set("Origin", config.origin)
    .send({ email: user.email, password });
  assert.equal(login.status, 201, JSON.stringify(login.body));
  cookie = login.headers["set-cookie"][0].split(";")[0];
  csrf = login.body.csrf;
});
after(async () => {
  await app?.close();
  await db.onModuleDestroy();
});
async function hold(indices: number[], key = randomUUID()) {
  return service.hold(user, key, {
    eventId: event.id,
    seatIds: indices.map((i) => seats[i].id),
  });
}
function signed(body: any, t = String(Math.floor(Date.now() / 1000))) {
  const raw = Buffer.from(JSON.stringify(body));
  return request(server)
    .post("/api/payments/webhook")
    .set("Content-Type", "application/json")
    .set("x-webhook-timestamp", t)
    .set("x-webhook-signature", signature(config.webhookSecret, t, raw))
    .send(raw.toString());
}
test("HTTP rejects unauthenticated and forged-role requests", async () => {
  assert.equal(
    (await request(server).get("/api/bookings").set("x-role", "ADMIN")).status,
    401,
  );
  assert.equal(
    (await request(server).get("/api/admin/summary").set("Cookie", cookie))
      .status,
    403,
  );
});
test("CSRF, origin and DTO validation protect hold endpoint", async () => {
  const body = { eventId: event.id, seatIds: [seats[0].id] };
  assert.equal(
    (
      await request(server)
        .post("/api/bookings/holds")
        .set("Cookie", cookie)
        .send(body)
    ).status,
    403,
  );
  assert.equal(
    (
      await request(server)
        .post("/api/bookings/holds")
        .set("Cookie", cookie)
        .set("Origin", config.origin)
        .set("X-CSRF-Token", csrf)
        .set("Idempotency-Key", randomUUID())
        .send({ ...body, role: "ADMIN" })
    ).status,
    400,
  );
});
test(
  "100 concurrent same-seat reservations produce exactly one winner",
  { skip: process.env.PGLITE_FUNCTIONAL_TESTS === "true" },
  async () => {
    const started = Date.now();
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, () => hold([0])),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      results.filter(
        (r) => r.status === "rejected" && (r.reason as any).getStatus() === 409,
      ).length,
      99,
    );
    const n = (
      await db.query(
        "SELECT count(*)::int n FROM booking_items WHERE seat_id=$1",
        [seats[0].id],
      )
    ).rows[0].n;
    assert.equal(n, 1);
    console.log(
      JSON.stringify({
        scenario: "100-concurrent-one-seat",
        confirmedHolds: 1,
        conflicts: 99,
        durationMs: Date.now() - started,
        poolSize: config.db.max,
      }),
    );
    const winner = (
      results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<any>
    ).value;
    await service.cancel(winner.id, user);
  },
);
test("concurrent idempotent retries reuse a single hold and changed payload conflicts", async () => {
  const key = randomUUID();
  const result = await Promise.all(
    Array.from({ length: 12 }, () => hold([1, 2], key)),
  );
  assert.equal(new Set(result.map((r) => r.id)).size, 1);
  await assert.rejects(
    () => hold([3], key),
    (e: any) => e.getStatus() === 409,
  );
  await service.cancel(result[0].id, user);
});
test(
  "overlapping multi-seat requests are all-or-nothing",
  { skip: process.env.PGLITE_FUNCTIONAL_TESTS === "true" },
  async () => {
    const results = await Promise.allSettled([hold([3, 4]), hold([4, 5])]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const b = (
      results.find(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<any>
    ).value;
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM seats WHERE booking_id=$1",
          [b.id],
        )
      ).rows[0].n,
      2,
    );
    await service.cancel(b.id, user);
  },
);
test("cross-event seats cannot create partial reservations", async () => {
  const other = (
    await db.query("SELECT id FROM seats WHERE event_id<>$1 LIMIT 1", [
      event.id,
    ])
  ).rows[0];
  await assert.rejects(
    () =>
      service.hold(user, randomUUID(), {
        eventId: event.id,
        seatIds: [seats[6].id, other.id],
      }),
    (e: any) => e.getStatus() === 400,
  );
  assert.equal(
    (await db.query("SELECT booking_id FROM seats WHERE id=$1", [seats[6].id]))
      .rows[0].booking_id,
    null,
  );
});
test("ownership boundaries hide another customer booking", async () => {
  const b = await hold([7]);
  await assert.rejects(
    () => service.detail(b.id, admin),
    (e: any) => e.getStatus() === 404,
  );
  await service.cancel(b.id, user);
});
test("expired seats are reclaimable even without a worker; late payment refunds", async () => {
  const b = await hold([8]),
    p = await service.paymentIntent(b.id, user);
  await db.query(
    "UPDATE bookings SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [b.id],
  );
  const newHold = await hold([8]);
  assert.notEqual(newHold.id, b.id);
  await service.applyWebhook({
    eventId: randomUUID(),
    paymentId: p.id,
    outcome: "SUCCEEDED",
    amount: p.amount,
    currency: "BDT",
  });
  const old = await service.detail(b.id, user);
  assert.equal(old.state, "EXPIRED");
  assert.equal(old.refund.state, "PENDING");
  assert.equal(
    (await db.query("SELECT booking_id FROM seats WHERE id=$1", [seats[8].id]))
      .rows[0].booking_id,
    newHold.id,
  );
  const task = (
    await db.query(
      "SELECT id FROM outbox WHERE type='REFUND' AND payload->>'bookingId'=$1",
      [b.id],
    )
  ).rows[0];
  await processOutbox(db, task.id);
  assert.equal((await service.detail(b.id, user)).payment.state, "REFUNDED");
  await service.cancel(newHold.id, user);
});
test("signed payment webhook validates signature, amount and duplicate payload", async () => {
  const b = await hold([9]),
    p = await service.paymentIntent(b.id, user);
  const body = {
    eventId: randomUUID(),
    paymentId: p.id,
    outcome: "SUCCEEDED",
    amount: p.amount,
    currency: "BDT",
  };
  assert.equal(
    (await request(server).post("/api/payments/webhook").send(body)).status,
    401,
  );
  assert.equal((await signed({ ...body, amount: p.amount + 1 })).status, 400);
  assert.equal((await signed(body)).status, 201);
  assert.equal((await signed(body)).body.duplicate, true);
  assert.equal((await signed({ ...body, outcome: "FAILED" })).status, 409);
  const current = await service.detail(b.id, user);
  assert.equal(current.state, "CONFIRMED");
  assert.ok(current.ticket_token);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit WHERE booking_id=$1 AND action='BOOKING_CONFIRMED'",
        [b.id],
      )
    ).rows[0].n,
    1,
  );
  await service.applyWebhook({
    ...body,
    eventId: randomUUID(),
    outcome: "FAILED",
  });
  assert.equal((await service.detail(b.id, user)).payment.state, "SUCCEEDED");
});
test("cancellation before pending payment success releases inventory and requests refund", async () => {
  const b = await hold([10]),
    p = await service.paymentIntent(b.id, user);
  await service.cancel(b.id, user);
  await service.applyWebhook({
    eventId: randomUUID(),
    paymentId: p.id,
    outcome: "SUCCEEDED",
    amount: p.amount,
    currency: "BDT",
  });
  const detail = await service.detail(b.id, user);
  assert.equal(detail.state, "CANCELLED");
  assert.equal(detail.refund.state, "PENDING");
});
test("confirmed cancellation is idempotent; refund processing is exactly-once in database", async () => {
  const b = await hold([11]),
    p = await service.paymentIntent(b.id, user);
  await service.sandboxSettle(p.id, user, "SUCCEEDED");
  await service.cancel(b.id, user);
  await service.cancel(b.id, user);
  const task = (
    await db.query(
      "SELECT id FROM outbox WHERE type='REFUND' AND payload->>'bookingId'=$1",
      [b.id],
    )
  ).rows[0];
  await Promise.all(
    Array.from({ length: 5 }, () => processOutbox(db, task.id)),
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM audit WHERE booking_id=$1 AND action='SANDBOX_REFUND_COMPLETED'",
        [b.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await service.detail(b.id, user)).refund.state, "COMPLETED");
});
test("staff event assignment and check-in replay rules are enforced", async () => {
  const b = await hold([12]),
    p = await service.paymentIntent(b.id, user);
  await service.sandboxSettle(p.id, user, "SUCCEEDED");
  const token = (await service.detail(b.id, user)).ticket_token;
  await db.query("DELETE FROM event_staff WHERE event_id=$1 AND user_id=$2", [
    event.id,
    staff.id,
  ]);
  await assert.rejects(
    () => service.checkin(token, staff),
    (e: any) => e.getStatus() === 403,
  );
  await db.query("INSERT INTO event_staff(event_id,user_id) VALUES($1,$2)", [
    event.id,
    staff.id,
  ]);
  assert.equal((await service.checkin(token, staff)).alreadyCheckedIn, false);
  assert.equal((await service.checkin(token, staff)).alreadyCheckedIn, true);
  await assert.rejects(
    () => service.cancel(b.id, user),
    (e: any) => e.getStatus() === 409,
  );
});
test("cancellation cutoff prevents refunding imminent events", async () => {
  const b = await hold([13]),
    p = await service.paymentIntent(b.id, user);
  await service.sandboxSettle(p.id, user, "SUCCEEDED");
  await db.query(
    "UPDATE events SET starts_at=clock_timestamp()+interval '30 minutes' WHERE id=$1",
    [event.id],
  );
  await assert.rejects(
    () => service.cancel(b.id, user),
    (e: any) => e.getStatus() === 409,
  );
  await db.query(
    "UPDATE events SET starts_at=clock_timestamp()+interval '7 days' WHERE id=$1",
    [event.id],
  );
});
test("Redis/BullMQ worker drains durable outbox and deduplicates delivery", async () => {
  const runtime = await startWorker(db);
  try {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await runtime.tick();
      if (
        !(
          await db.query(
            "SELECT 1 FROM outbox WHERE processed_at IS NULL LIMIT 1",
          )
        ).rowCount
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM outbox WHERE processed_at IS NULL",
        )
      ).rows[0].n,
      0,
    );
    const notifications = (await db.query("SELECT id FROM notifications")).rows;
    assert.ok(notifications.length > 0);
    assert.equal(
      new Set(notifications.map((n) => n.id)).size,
      notifications.length,
    );
  } finally {
    await runtime.stop();
  }
});
test("logout revokes session immediately", async () => {
  const result = await request(server)
    .post("/api/auth/logout")
    .set("Cookie", cookie)
    .set("Origin", config.origin)
    .set("X-CSRF-Token", csrf);
  assert.equal(result.status, 201);
  assert.equal(
    (await request(server).get("/api/bookings").set("Cookie", cookie)).status,
    401,
  );
});
