import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { Database, eventLock } from "./db";
import { config } from "./config";
import { hash, token } from "./crypto";
import { User } from "./auth";
import { HoldDto, WebhookDto, EventDto } from "./dto";
export async function audit(
  c: PoolClient,
  id: string,
  action: string,
  actor: string | null = null,
  detail: object = {},
) {
  await c.query(
    "INSERT INTO audit(booking_id,actor_id,action,detail) VALUES($1,$2,$3,$4)",
    [id, actor, action, JSON.stringify(detail)],
  );
}
export async function outbox(c: PoolClient, type: string, payload: object) {
  await c.query("INSERT INTO outbox(id,type,payload) VALUES($1,$2,$3)", [
    randomUUID(),
    type,
    JSON.stringify(payload),
  ]);
}
@Injectable()
export class BookingService {
  constructor(private readonly db: Database) {}
  async expireForEvent(c: PoolClient, eventId: string) {
    const expired = (
      await c.query(
        "UPDATE bookings SET state='EXPIRED' WHERE event_id=$1 AND state='HELD' AND expires_at<=clock_timestamp() RETURNING id",
        [eventId],
      )
    ).rows;
    for (const b of expired) {
      await c.query("UPDATE seats SET booking_id=NULL WHERE booking_id=$1", [
        b.id,
      ]);
      await audit(c, b.id, "HOLD_EXPIRED");
    }
    return expired.length;
  }
  async expireAll() {
    const ids = (
      await this.db.query(
        "SELECT DISTINCT event_id FROM bookings WHERE state='HELD' AND expires_at<=clock_timestamp() LIMIT 100",
      )
    ).rows;
    let count = 0;
    for (const e of ids)
      count += await this.db.tx(async (c) => {
        await eventLock(c, e.event_id);
        return this.expireForEvent(c, e.event_id);
      });
    return count;
  }
  async hold(user: User, key: string, dto: HoldDto) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key ?? ""))
      throw new BadRequestException(
        "Idempotency-Key must contain 8–100 letters, digits, underscores or hyphens",
      );
    const ids = [...dto.seatIds].sort();
    const fp = hash(JSON.stringify({ eventId: dto.eventId, seatIds: ids }));
    return this.db.tx(async (c) => {
      // Serialize retries of the same key before event inventory locks. Every mutating booking path locks event first after this key lock.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))", [
        user.id + ":" + key,
      ]);
      const existing = (
        await c.query("SELECT * FROM idempotency WHERE user_id=$1 AND key=$2", [
          user.id,
          key,
        ])
      ).rows[0];
      if (existing) {
        if (existing.fingerprint !== fp)
          throw new ConflictException(
            "Idempotency key was used for a different request",
          );
        return this.detailTx(c, existing.booking_id, user);
      }
      await eventLock(c, dto.eventId);
      const event = (
        await c.query(
          "SELECT * FROM events WHERE id=$1 AND published=true AND starts_at>clock_timestamp()",
          [dto.eventId],
        )
      ).rows[0];
      if (!event) throw new NotFoundException("Event is unavailable");
      await this.expireForEvent(c, dto.eventId);
      const active = (
        await c.query(
          "SELECT count(*)::int n FROM bookings WHERE user_id=$1 AND event_id=$2 AND state='HELD'",
          [user.id, dto.eventId],
        )
      ).rows[0].n;
      if (active >= 3)
        throw new ConflictException(
          "You already have three active holds for this event",
        );
      const seats = (
        await c.query(
          "SELECT * FROM seats WHERE event_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
          [dto.eventId, ids],
        )
      ).rows;
      if (seats.length !== ids.length)
        throw new BadRequestException(
          "One or more seats do not belong to this event",
        );
      if (seats.some((s) => s.booking_id))
        throw new ConflictException("A selected seat is no longer available");
      const total = seats.reduce((n, s) => n + s.price, 0),
        id = randomUUID();
      await c.query(
        "INSERT INTO bookings(id,user_id,event_id,state,total,expires_at) VALUES($1,$2,$3,'HELD',$4,clock_timestamp()+($5::int*interval '1 second'))",
        [id, user.id, dto.eventId, total, config.holdSeconds],
      );
      for (const s of seats) {
        await c.query(
          "INSERT INTO booking_items(booking_id,seat_id,label,price) VALUES($1,$2,$3,$4)",
          [id, s.id, s.row_label + s.number, s.price],
        );
      }
      await c.query("UPDATE seats SET booking_id=$1 WHERE id=ANY($2::uuid[])", [
        id,
        ids,
      ]);
      await c.query(
        "INSERT INTO idempotency(user_id,key,fingerprint,booking_id) VALUES($1,$2,$3,$4)",
        [user.id, key, fp, id],
      );
      await audit(c, id, "HOLD_CREATED", user.id, { seatIds: ids, total });
      return this.detailTx(c, id, user);
    });
  }
  async detailTx(c: PoolClient, id: string, user: User) {
    const b = (
      await c.query(
        "SELECT b.*,e.title,e.venue,e.starts_at FROM bookings b JOIN events e ON e.id=b.event_id WHERE b.id=$1 AND b.user_id=$2",
        [id, user.id],
      )
    ).rows[0];
    if (!b) throw new NotFoundException("Booking not found");
    const items = (
      await c.query(
        "SELECT seat_id,label,price FROM booking_items WHERE booking_id=$1 ORDER BY label",
        [id],
      )
    ).rows;
    const payment =
      (
        await c.query(
          "SELECT id,state,amount,currency,provider FROM payments WHERE booking_id=$1",
          [id],
        )
      ).rows[0] ?? null;
    const refund =
      (
        await c.query(
          "SELECT id,state,reason,amount FROM refunds WHERE booking_id=$1",
          [id],
        )
      ).rows[0] ?? null;
    return { ...b, items, payment, refund };
  }
  async detail(id: string, user: User) {
    const lookup = (
      await this.db.query(
        "SELECT event_id FROM bookings WHERE id=$1 AND user_id=$2",
        [id, user.id],
      )
    ).rows[0];
    if (!lookup) throw new NotFoundException("Booking not found");
    return this.db.tx(async (c) => {
      await eventLock(c, lookup.event_id);
      await this.expireForEvent(c, lookup.event_id);
      return this.detailTx(c, id, user);
    });
  }
  async list(user: User, page: number) {
    return (
      await this.db.query(
        "SELECT b.id,b.state,b.total,b.currency,b.created_at,b.expires_at,e.title,e.starts_at,coalesce(p.state,'NONE') payment_state FROM bookings b JOIN events e ON e.id=b.event_id LEFT JOIN payments p ON p.booking_id=b.id WHERE b.user_id=$1 ORDER BY b.created_at DESC,b.id LIMIT 20 OFFSET $2",
        [user.id, (page - 1) * 20],
      )
    ).rows;
  }
  async ownedLock(c: PoolClient, id: string, user: User) {
    const ref = (
      await c.query(
        "SELECT event_id FROM bookings WHERE id=$1 AND user_id=$2",
        [id, user.id],
      )
    ).rows[0];
    if (!ref) throw new NotFoundException("Booking not found");
    await eventLock(c, ref.event_id);
    await this.expireForEvent(c, ref.event_id);
    return (
      await c.query(
        "SELECT b.*,e.starts_at FROM bookings b JOIN events e ON e.id=b.event_id WHERE b.id=$1 FOR UPDATE OF b",
        [id],
      )
    ).rows[0];
  }
  async paymentIntent(id: string, user: User) {
    return this.db.tx(async (c) => {
      const b = await this.ownedLock(c, id, user);
      if (b.state !== "HELD")
        throw new ConflictException("Only an active hold can enter checkout");
      await c.query(
        "INSERT INTO payments(id,booking_id,state,amount) VALUES($1,$2,'CREATED',$3) ON CONFLICT(booking_id) DO NOTHING",
        [randomUUID(), id, b.total],
      );
      return (
        await c.query(
          "SELECT id,booking_id,state,amount,currency,provider FROM payments WHERE booking_id=$1",
          [id],
        )
      ).rows[0];
    });
  }
  async requestRefund(c: PoolClient, b: any, p: any, reason: string) {
    const result = await c.query(
      "INSERT INTO refunds(id,payment_id,booking_id,state,reason,amount) VALUES($1,$2,$3,'PENDING',$4,$5) ON CONFLICT(payment_id) DO NOTHING RETURNING id",
      [randomUUID(), p.id, b.id, reason, p.amount],
    );
    if (result.rowCount)
      await outbox(c, "REFUND", {
        refundId: result.rows[0].id,
        bookingId: b.id,
        eventId: b.event_id,
      });
  }
  async applyWebhook(
    dto: WebhookDto,
    expectedProvider = "sandbox",
    client?: PoolClient,
  ) {
    const fingerprint = hash(
      JSON.stringify({
        paymentId: dto.paymentId,
        outcome: dto.outcome,
        amount: dto.amount,
        currency: dto.currency,
      }),
    );
    return this.db.tx(async (c) => {
      const reference = (
        await c.query(
          "SELECT b.event_id,b.id FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.id=$1",
          [dto.paymentId],
        )
      ).rows[0];
      if (!reference) throw new NotFoundException("Payment not found");
      await eventLock(c, reference.event_id);
      await this.expireForEvent(c, reference.event_id);
      const b = (
          await c.query("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [
            reference.id,
          ])
        ).rows[0],
        p = (
          await c.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [
            dto.paymentId,
          ])
        ).rows[0];
      if (p.provider !== expectedProvider)
        throw new ForbiddenException("Payment provider mismatch");
      if (dto.amount !== p.amount || dto.currency !== p.currency)
        throw new BadRequestException("Payment amount or currency mismatch");
      const inserted = await c.query(
        "INSERT INTO webhook_events(id,fingerprint,payment_id) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING RETURNING id",
        [dto.eventId, fingerprint, p.id],
      );
      if (!inserted.rowCount) {
        const previous = (
          await c.query("SELECT fingerprint FROM webhook_events WHERE id=$1", [
            dto.eventId,
          ])
        ).rows[0];
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException("Webhook event payload conflict");
        return { ok: true, duplicate: true };
      }
      if (dto.outcome === "FAILED") {
        if (p.state === "CREATED") {
          await c.query("UPDATE payments SET state='FAILED' WHERE id=$1", [
            p.id,
          ]);
          await audit(c, b.id, "PAYMENT_FAILED");
        }
        return { ok: true };
      }
      if (p.state === "SUCCEEDED" || p.state === "REFUNDED")
        return { ok: true, ignored: true };
      await c.query("UPDATE payments SET state='SUCCEEDED' WHERE id=$1", [
        p.id,
      ]);
      const inventory = (
        await c.query("SELECT count(*)::int n FROM seats WHERE booking_id=$1", [
          b.id,
        ])
      ).rows[0].n;
      const wanted = (
        await c.query(
          "SELECT count(*)::int n FROM booking_items WHERE booking_id=$1",
          [b.id],
        )
      ).rows[0].n;
      const confirmed =
        b.state === "HELD" && inventory === wanted && wanted > 0
          ? await c.query(
              "UPDATE bookings SET state='CONFIRMED',confirmed_at=clock_timestamp(),ticket_token=$2 WHERE id=$1 AND state='HELD' AND expires_at>clock_timestamp() RETURNING id",
              [b.id, token()],
            )
          : { rowCount: 0 };
      if (confirmed.rowCount) {
        await audit(c, b.id, "BOOKING_CONFIRMED");
        await outbox(c, "NOTIFY", {
          bookingId: b.id,
          userId: b.user_id,
          message: "Booking confirmed. Your ticket is ready.",
        });
      } else {
        await this.expireForEvent(c, b.event_id);
        await audit(c, b.id, "LATE_PAYMENT_REFUND_REQUIRED");
        await this.requestRefund(
          c,
          b,
          p,
          "Payment arrived after inventory was released",
        );
      }
      return { ok: true };
    }, client);
  }
  async sandboxSettle(id: string, user: User, outcome: "SUCCEEDED" | "FAILED") {
    if (!config.sandbox)
      throw new ForbiddenException("Sandbox payment is disabled");
    const p = (
      await this.db.query(
        "SELECT p.* FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.id=$1 AND b.user_id=$2",
        [id, user.id],
      )
    ).rows[0];
    if (!p) throw new NotFoundException("Payment not found");
    if (p.provider !== "sandbox")
      throw new ForbiddenException("External payments cannot be simulated");
    return this.applyWebhook(
      {
        eventId: "sandbox_" + id + "_" + outcome,
        paymentId: id,
        outcome,
        amount: p.amount,
        currency: p.currency,
      },
      "sandbox",
    );
  }
  async cancel(id: string, user: User) {
    return this.db.tx(async (c) => {
      const b = await this.ownedLock(c, id, user);
      if (["CANCELLED", "EXPIRED"].includes(b.state))
        return this.detailTx(c, id, user);
      if (b.checked_in_at)
        throw new ConflictException("Checked-in tickets cannot be cancelled");
      if (
        b.state === "CONFIRMED" &&
        new Date(b.starts_at).getTime() - Date.now() < 3600000
      )
        throw new ConflictException(
          "Cancellation closes one hour before the event",
        );
      await c.query(
        "UPDATE bookings SET state='CANCELLED',cancelled_at=clock_timestamp() WHERE id=$1",
        [id],
      );
      await c.query("UPDATE seats SET booking_id=NULL WHERE booking_id=$1", [
        id,
      ]);
      await audit(c, id, "BOOKING_CANCELLED", user.id);
      const p = (
        await c.query(
          "SELECT * FROM payments WHERE booking_id=$1 AND state='SUCCEEDED'",
          [id],
        )
      ).rows[0];
      if (p) await this.requestRefund(c, b, p, "Customer cancellation");
      return this.detailTx(c, id, user);
    });
  }
  async history(id: string, user: User) {
    await this.detail(id, user);
    return (
      await this.db.query(
        "SELECT action,detail,created_at FROM audit WHERE booking_id=$1 ORDER BY id",
        [id],
      )
    ).rows;
  }
  async checkin(ticketToken: string, user: User) {
    const ref = (
      await this.db.query(
        "SELECT id,event_id FROM bookings WHERE ticket_token=$1",
        [ticketToken],
      )
    ).rows[0];
    if (!ref) throw new NotFoundException("Invalid ticket");
    return this.db.tx(async (c) => {
      await eventLock(c, ref.event_id);
      if (user.role !== "ADMIN") {
        const assigned = (
          await c.query(
            "SELECT 1 FROM event_staff WHERE event_id=$1 AND user_id=$2",
            [ref.event_id, user.id],
          )
        ).rowCount;
        if (!assigned)
          throw new ForbiddenException("You are not assigned to this event");
      }
      const b = (
        await c.query("SELECT * FROM bookings WHERE id=$1 FOR UPDATE", [ref.id])
      ).rows[0];
      if (b.state !== "CONFIRMED")
        throw new ConflictException("Ticket is not valid for admission");
      if (b.checked_in_at)
        return { ok: true, alreadyCheckedIn: true, bookingId: b.id };
      await c.query(
        "UPDATE bookings SET checked_in_at=clock_timestamp(),checked_in_by=$2 WHERE id=$1",
        [b.id, user.id],
      );
      await audit(c, b.id, "TICKET_CHECKED_IN", user.id);
      return { ok: true, alreadyCheckedIn: false, bookingId: b.id };
    });
  }
  async events(search: string, page: number) {
    return (
      await this.db.query(
        "SELECT e.*,count(s.id)::int seat_count,count(s.id) FILTER(WHERE s.booking_id IS NULL OR (b.state='HELD' AND b.expires_at<=clock_timestamp()))::int available,min(s.price)::int min_price FROM events e JOIN seats s ON s.event_id=e.id LEFT JOIN bookings b ON b.id=s.booking_id WHERE e.published=true AND e.starts_at>clock_timestamp() AND (e.title ILIKE $1 OR e.city ILIKE $1) GROUP BY e.id ORDER BY e.starts_at,e.id LIMIT 12 OFFSET $2",
        ["%" + search.replace(/[\\%_]/g, "\\$&") + "%", (page - 1) * 12],
      )
    ).rows;
  }
  async event(id: string) {
    const e = (
      await this.db.query(
        "SELECT * FROM events WHERE id=$1 AND published=true",
        [id],
      )
    ).rows[0];
    if (!e) throw new NotFoundException("Event not found");
    const seats = (
      await this.db.query(
        "SELECT s.id,s.row_label,s.number,s.tier,s.price,CASE WHEN s.booking_id IS NULL OR (b.state='HELD' AND b.expires_at<=clock_timestamp()) THEN 'AVAILABLE' WHEN b.state='HELD' THEN 'HELD' ELSE 'BOOKED' END status FROM seats s LEFT JOIN bookings b ON b.id=s.booking_id WHERE s.event_id=$1 ORDER BY s.row_label,s.number",
        [id],
      )
    ).rows;
    return { ...e, seats, serverTime: new Date().toISOString() };
  }
  async createEvent(dto: EventDto) {
    if (new Date(dto.startsAt).getTime() < Date.now() + 3600000)
      throw new BadRequestException(
        "Event must start at least one hour from now",
      );
    return this.db.tx(async (c) => {
      const id = randomUUID();
      await c.query(
        "INSERT INTO events(id,title,venue,city,description,starts_at) VALUES($1,$2,$3,$4,$5,$6)",
        [id, dto.title, dto.venue, dto.city, dto.description, dto.startsAt],
      );
      for (let row = 0; row < dto.rows; row++)
        for (let n = 1; n <= dto.seatsPerRow; n++)
          await c.query(
            "INSERT INTO seats(id,event_id,row_label,number,tier,price) VALUES($1,$2,$3,$4,$5,$6)",
            [
              randomUUID(),
              id,
              String.fromCharCode(65 + row),
              n,
              row < 2 ? "PREMIUM" : "STANDARD",
              row < 2 ? Math.round(dto.price * 1.5) : dto.price,
            ],
          );
      return { id };
    });
  }
  async adminSummary() {
    const sales = (
      await this.db.query(
        "SELECT count(*)::int total_bookings,count(*) FILTER(WHERE state='CONFIRMED')::int confirmed,count(*) FILTER(WHERE checked_in_at IS NOT NULL)::int checked_in,coalesce(sum(total) FILTER(WHERE state='CONFIRMED'),0)::text confirmed_value FROM bookings",
      )
    ).rows[0];
    const jobs = (
      await this.db.query(
        "SELECT id,type,attempts,last_error,created_at FROM outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT 50",
      )
    ).rows;
    const refunds = (
      await this.db.query(
        "SELECT r.*,e.title FROM refunds r JOIN bookings b ON b.id=r.booking_id JOIN events e ON e.id=b.event_id ORDER BY r.created_at DESC LIMIT 50",
      )
    ).rows;
    return { ...sales, jobs, refunds };
  }
  async notifications(user: User) {
    return (
      await this.db.query(
        "SELECT id,booking_id,message,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30",
        [user.id],
      )
    ).rows;
  }
}
