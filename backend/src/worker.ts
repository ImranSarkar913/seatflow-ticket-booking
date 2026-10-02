import "reflect-metadata";
import { Queue, Worker, Job } from "bullmq";
import Redis from "ioredis";
import { Database, eventLock } from "./db";
import { BookingService, audit, outbox } from "./booking";
import { CheckoutService } from "./payment-checkout";
import { config } from "./config";
export async function processOutbox(db: Database, id: string) {
  return db.tx(async (c) => {
    const task = (
      await c.query("SELECT * FROM outbox WHERE id=$1 FOR UPDATE", [id])
    ).rows[0];
    if (!task || task.processed_at) return;
    const p = task.payload;
    if (task.type === "NOTIFY") {
      await c.query(
        "INSERT INTO notifications(id,user_id,booking_id,message) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
        [task.id, p.userId, p.bookingId, p.message],
      );
    } else if (task.type === "REFUND") {
      await eventLock(c, p.eventId);
      const refund = (
        await c.query("SELECT * FROM refunds WHERE id=$1 FOR UPDATE", [
          p.refundId,
        ])
      ).rows[0];
      if (!refund) throw new Error("Refund record missing");
      if (refund.state === "PENDING") {
        const payment = (
          await c.query("SELECT provider FROM payments WHERE id=$1", [
            refund.payment_id,
          ])
        ).rows[0];
        if (payment.provider !== "sandbox" || !config.sandbox)
          throw new Error(
            "External refund requires merchant portal action; no automatic refund was sent",
          );
        await c.query(
          "UPDATE refunds SET state='COMPLETED',completed_at=clock_timestamp() WHERE id=$1",
          [refund.id],
        );
        await c.query("UPDATE payments SET state='REFUNDED' WHERE id=$1", [
          refund.payment_id,
        ]);
        await audit(c, refund.booking_id, "SANDBOX_REFUND_COMPLETED", null, {
          refundId: refund.id,
        });
        const b = (
          await c.query("SELECT user_id FROM bookings WHERE id=$1", [
            refund.booking_id,
          ])
        ).rows[0];
        await outbox(c, "NOTIFY", {
          bookingId: refund.booking_id,
          userId: b.user_id,
          message: "Sandbox refund completed.",
        });
      }
    } else throw new Error("Unknown outbox task");
    await c.query(
      "UPDATE outbox SET processed_at=clock_timestamp(),last_error=NULL WHERE id=$1",
      [id],
    );
  });
}
export async function startWorker(db = new Database()) {
  const service = new BookingService(db),
    connection = new Redis(config.redis, { maxRetriesPerRequest: null }),
    queue = new Queue("seatflow-outbox", { connection });
  connection.on("error", () => {});
  const worker = new Worker(
    "seatflow-outbox",
    async (job: Job) => {
      try {
        await processOutbox(db, job.data.id);
      } catch (e: any) {
        await db.query(
          "UPDATE outbox SET attempts=attempts+1,last_error=$2 WHERE id=$1",
          [job.data.id, e.message.slice(0, 300)],
        );
        throw e;
      }
    },
    { connection, concurrency: 4 },
  );
  worker.on("error", (e) =>
    console.error(
      JSON.stringify({ event: "worker_error", message: e.message }),
    ),
  );
  worker.on("failed", (job, e) =>
    console.error(
      JSON.stringify({
        event: "job_failed",
        jobId: job?.id,
        message: e.message,
      }),
    ),
  );
  const checkout = new CheckoutService(db, service);
  let lastReconciliation = 0;
  let running = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await service.expireAll();
      if (Date.now() - lastReconciliation > 30000) {
        lastReconciliation = Date.now();
        await checkout.reconcile();
      }
      const pending = (
        await db.query(
          "SELECT id FROM outbox WHERE processed_at IS NULL AND attempts<5 ORDER BY created_at LIMIT 100",
        )
      ).rows;
      for (const p of pending) {
        const old = await queue.getJob(p.id);
        if (old) {
          if ((await old.getState()) === "failed") await old.retry();
          continue;
        }
        await queue.add(
          "deliver",
          { id: p.id },
          {
            jobId: p.id,
            attempts: 5,
            backoff: { type: "exponential", delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: 1000,
          },
        );
      }
    } catch (e: any) {
      console.error(
        JSON.stringify({ event: "worker_tick_error", message: e.message }),
      );
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), 2000);
  await tick();
  return {
    tick,
    queue,
    worker,
    stop: async () => {
      clearInterval(timer);
      while (running) await new Promise((r) => setTimeout(r, 10));
      await worker.close();
      await queue.close();
      connection.disconnect();
    },
  };
}
if (require.main === module) {
  const db = new Database();
  startWorker(db)
    .then((runtime) => {
      const stop = async () => {
        await runtime.stop();
        await db.onModuleDestroy();
        process.exit(0);
      };
      process.on("SIGTERM", stop);
      process.on("SIGINT", stop);
    })
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
}
