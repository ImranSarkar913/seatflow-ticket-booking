import "reflect-metadata";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
process.env.PGPASSWORD ??= "test-only";
process.env.WEBHOOK_SECRET ??= "test-only-secret-at-least-32-characters";
process.env.PAYMENT_ENVIRONMENT = "sandbox";
process.env.ENABLE_SANDBOX = "true";
process.env.SSLCOMMERZ_ENABLED = "true";
process.env.SSLCOMMERZ_STORE_ID = "mock-store";
process.env.SSLCOMMERZ_STORE_PASSWORD = "mock-secret";
process.env.BKASH_ENABLED = "true";
process.env.BKASH_USERNAME = "mock-user";
process.env.BKASH_PASSWORD = "mock-secret";
process.env.BKASH_APP_KEY = "mock-key";
process.env.BKASH_APP_SECRET = "mock-secret";
const {
  paisa,
  taka,
  safeCheckout,
  verifySettlement,
  providerRequest,
} = require("../dist/payment-provider");
const { CheckoutService } = require("../dist/payment-checkout");
const { BookingService } = require("../dist/booking");
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const user = {
  id: "u",
  name: "Test Customer",
  email: "test@example.com",
  role: "CUSTOMER",
};
function fixture(provider = "sslcommerz", exists = true) {
  const p: any = {
    payment_id: id,
    id,
    booking_id: "b",
    invoice: "SFaaaaaaaaaaaa4aaa8aaaaaaaaaaaaa",
    amount: 125050,
    currency: "BDT",
    provider,
    state: "READY",
    payment_state: "CREATED",
    provider_payment_id: "REMOTE123",
    checkout_url: "https://sandbox.sslcommerz.com/checkout",
  };
  let existing = exists;
  const calls: any[] = [];
  async function query(sql: string, args: any[] = []): Promise<any> {
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ ok: true }] };
    if (sql.startsWith("SELECT pc.")) return { rows: [{ ...p }] };
    if (sql.startsWith("SELECT * FROM payment_checkouts"))
      return { rows: existing ? [{ ...p }] : [] };
    if (sql.startsWith("SELECT * FROM payments"))
      return {
        rows: [
          {
            id,
            provider: existing ? p.provider : "sandbox",
            state: "CREATED",
            amount: p.amount,
          },
        ],
      };
    if (sql.startsWith("INSERT INTO payment_checkouts")) {
      existing = true;
      p.provider = args[1];
      p.invoice = args[2];
      p.state = "INITIATING";
    }
    if (sql.includes("state='UNKNOWN'")) {if(p.state==='INITIATING')p.state='UNKNOWN';else return {rows:[],rowCount:0};}
    if (sql.includes("state='READY'")) {
      if(!['INITIATING','UNKNOWN'].includes(p.state))return {rows:[],rowCount:0};
      p.state = "READY";
      p.provider_payment_id = args[1];
      p.checkout_url = args[2];
    }
    if (sql.includes("state='SETTLED'")) {
      p.state = "SETTLED";
      p.settlement_reference = args[1];
    }
    return { rows: [], rowCount: 1 };
  }
  const db = {
    query,
    tx: (fn: any) => fn({ query }),
    pool: { connect: async () => ({ query, release() {} }) },
  };
  const booking = {
    paymentIntent: async () => ({ id, amount: p.amount }),
    applyWebhook: async (...v: any[]) => {
      calls.push(v);
    },
  };
  return { p, calls, service: new CheckoutService(db as any, booking as any) };
}
function mock(response: (url: string, options: any) => any) {
  globalThis.fetch = async (url: any, options: any) =>
    new Response(JSON.stringify(response(String(url), options)), {
      status: 200,
    });
}
function ssl(p: any) {
  return {
    status: "VALIDATED",
    tran_id: p.invoice,
    amount: "1250.50",
    currency: "BDT",
    risk_level: "0",
    bank_tran_id: "BANK123",
    val_id: "VAL123",
  };
}
test("exact decimal paisa conversion rejects malformed amounts", () => {
  assert.equal(paisa("1250.50"), 125050);
  assert.equal(paisa("1.5"), 150);
  assert.equal(taka(125050), "1250.50");
  for (const x of ["1.001", "1e3", "-1", "0", "NaN", 1250])
    assert.throws(() => paisa(x));
});
test("redirect allowlist rejects lookalikes, credentials, http and nonstandard ports", () => {
  assert.match(
    safeCheckout("https://sandbox.sslcommerz.com/checkout", "sslcommerz"),
    /^https:/,
  );
  for (const u of [
    "http://sandbox.sslcommerz.com",
    "https://sandbox.sslcommerz.com.evil.test",
    "https://evil.test",
    "https://user@sandbox.sslcommerz.com",
    "https://sandbox.sslcommerz.com:444",
  ])
    assert.throws(() => safeCheckout(u, "sslcommerz"));
  assert.match(
    safeCheckout("https://sandbox.payment.bkash.com/?paymentId=1", "bkash"),
    /^https:/,
  );
});
test("settlement checks invoice, amount, currency, risk and provider identity", () => {
  const { p } = fixture();
  assert.equal(verifySettlement("sslcommerz", ssl(p), p), "BANK123");
  for (const fields of [
    { tran_id: "other" },
    { amount: "1250.51" },
    { currency: "USD" },
    { risk_level: "1" },
  ])
    assert.throws(() =>
      verifySettlement("sslcommerz", { ...ssl(p), ...fields }, p),
    );
  const b = {
    merchantInvoice: p.invoice,
    amount: "1250.50",
    currency: "BDT",
    paymentID: "REMOTE123",
    intent: "sale",
    trxID: "TRX1",
  };
  assert.equal(verifySettlement("bkash", b, p, "REMOTE123"), "TRX1");
  assert.throws(() =>
    verifySettlement("bkash", { ...b, paymentID: "OTHER" }, p, "REMOTE123"),
  );
});
test("unverified or mismatched SSL callback cannot confirm booking", async () => {
  const f = fixture();
  mock(() => ({ ...ssl(f.p), amount: "1.00" }));
  await assert.rejects(f.service.verify(id, false, "VAL123"));
  assert.equal(f.calls.length, 0);
  mock(() => ({ status: "INVALID" }));
  assert.equal((await f.service.verify(id, false, "VAL123")).pending, true);
  assert.equal(f.calls.length, 0);
});
test("verified settlement uses stable event; replay has no second effect", async () => {
  const f = fixture();
  mock(() => ssl(f.p));
  await f.service.verify(id, false, "VAL123");
  await f.service.verify(id, false, "VAL123");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0].amount, 125050);
  assert.equal(f.calls[0][1], "sslcommerz");
  assert.match(f.calls[0][0].eventId, /^provider_[a-f0-9]{64}$/);
});
test("missing SSL callback recovered by lookup and independent validation", async () => {
  const f = fixture();
  const urls: string[] = [];
  mock((url) => {
    urls.push(url);
    return url.includes("validationserverAPI")
      ? ssl(f.p)
      : { element: [ssl(f.p)] };
  });
  await f.service.verify(id);
  assert.equal(f.calls.length, 1);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /tran_id=/);
  assert.match(urls[1], /val_id=/);
});
test("checkout uses server amount and fixed callback; retry reuses session", async () => {
  const f = fixture("sslcommerz", false);
  let requests = 0;
  mock((_url, options) => {
    requests++;
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("total_amount"), "1250.50");
    assert.match(
      body.get("ipn_url")!,
      /\/api\/payment-checkout\/sslcommerz\/ipn$/,
    );
    return {
      status: "SUCCESS",
      sessionkey: "SESSION1",
      GatewayPageURL: "https://sandbox.sslcommerz.com/checkout",
    };
  });
  await f.service.start("b", user, "sslcommerz", "01712345678");
  await f.service.start("b", user, "sslcommerz", "01712345678");
  assert.equal(requests, 1);
  await assert.rejects(f.service.start("b", user, "bkash", "01712345678"));
});
test("uncertain initiation does not create another checkout", async () => {
  const f = fixture("sslcommerz", false);
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("Timeout");
  };
  await assert.rejects(f.service.start("b", user, "sslcommerz", "01712345678"));
  assert.equal(f.p.state, "UNKNOWN");
  await assert.rejects(f.service.start("b", user, "sslcommerz", "01712345678"));
  assert.equal(requests, 1);
});
test("bKash completed query avoids duplicate execution", async () => {
  const f = fixture("bkash");
  let executes = 0;
  mock((url) => {
    if (url.endsWith("token/grant"))
      return { statusCode: "0000", id_token: "mock-token", expires_in: 3600 };
    if (url.endsWith("/execute")) executes++;
    return {
      statusCode: "0000",
      transactionStatus: "Completed",
      paymentID: "REMOTE123",
      merchantInvoice: f.p.invoice,
      amount: "1250.50",
      currency: "BDT",
      intent: "sale",
      trxID: "TRX1",
    };
  });
  await f.service.verify(id, true);
  assert.equal(executes, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][1], "bkash");
});
test("bKash execute timeout queries status before settling", async () => {
  const f = fixture("bkash");
  let queries = 0;
  globalThis.fetch = async (url: any) => {
    if (String(url).endsWith("/execute")) throw new Error("Timeout");
    const result = String(url).endsWith("token/grant")
      ? { statusCode: "0000", id_token: "mock-token", expires_in: 3600 }
      : ++queries === 1
        ? { transactionStatus: "Initiated" }
        : {
            transactionStatus: "Completed",
            paymentID: "REMOTE123",
            merchantInvoice: f.p.invoice,
            amount: "1250.50",
            currency: "BDT",
            intent: "sale",
            trxID: "TRX2",
          };
    return new Response(JSON.stringify(result));
  };
  await f.service.verify(id, true);
  assert.equal(queries, 2);
  assert.equal(f.calls.length, 1);
});
test("transport hides credentials and disables automatic redirects", async () => {
  globalThis.fetch = async (_url: any, options: any) => {
    assert.equal(options.redirect, "error");
    throw new Error("secret=SHOULD_NOT_LEAK");
  };
  await assert.rejects(
    providerRequest("https://sandbox.sslcommerz.com"),
    (e: any) => !e.message.includes("SHOULD_NOT_LEAK"),
  );
});
test("sandbox button cannot settle external provider payment", async () => {
  const booking = new BookingService({
    query: async () => ({ rows: [{ provider: "bkash" }] }),
  } as any);
  await assert.rejects(
    booking.sandboxSettle(id, user, "SUCCEEDED"),
    /External payments cannot be simulated/,
  );
});
test("provider guard inside settlement transaction closes sandbox race", async () => {
  let writes = 0;
  const service = new BookingService({
    tx: async (fn: any) =>
      fn({
        query: async (sql: string) => {
          if (sql.startsWith("SELECT b.event_id"))
            return { rows: [{ event_id: "event", id: "b" }] };
          if (sql.startsWith("SELECT * FROM bookings"))
            return { rows: [{ id: "b" }] };
          if (sql.startsWith("SELECT * FROM payments"))
            return {
              rows: [{ provider: "bkash", amount: 125050, currency: "BDT" }],
            };
          if (sql.startsWith("UPDATE payments")) writes++;
          return { rows: [], rowCount: 0 };
        },
      }),
  } as any);
  await assert.rejects(
    service.applyWebhook({
      eventId: "sandbox_test",
      paymentId: id,
      outcome: "SUCCEEDED",
      amount: 125050,
      currency: "BDT",
    }),
    /Payment provider mismatch/,
  );
  assert.equal(writes, 0);
});

test("external refund remains pending even when local simulation is enabled", async () => {
  const { processOutbox } = require("../dist/worker");
  let completed = false;
  const db = {
    tx: async (fn: any) =>
      fn({
        query: async (sql: string) => {
          if (sql.startsWith("SELECT * FROM outbox"))
            return {
              rows: [
                { type: "REFUND", payload: { eventId: "e", refundId: "r" } },
              ],
            };
          if (sql.startsWith("SELECT * FROM refunds"))
            return { rows: [{ id: "r", state: "PENDING", payment_id: id }] };
          if (sql.startsWith("SELECT provider FROM payments"))
            return { rows: [{ provider: "sslcommerz" }] };
          if (sql.includes("state='COMPLETED'")) completed = true;
          return { rows: [] };
        },
      }),
  };
  await assert.rejects(
    processOutbox(db, "job"),
    /External refund requires merchant portal action/,
  );
  assert.equal(completed, false);
});

test('checkout creation cannot regress a concurrently settled payment to READY',async()=>{
 const f=fixture('sslcommerz',false);
 mock(()=>{f.p.state='SETTLED';return {status:'SUCCESS',sessionkey:'SESSION1',GatewayPageURL:'https://sandbox.sslcommerz.com/checkout'};});
 await assert.rejects(f.service.start('b',user,'sslcommerz','01712345678'),/Payment status changed/);
 assert.equal(f.p.state,'SETTLED');
});
test('initiation timeout cannot regress concurrent settlement to UNKNOWN',async()=>{
 const f=fixture('sslcommerz',false);
 globalThis.fetch=async()=>{f.p.state='SETTLED';throw new Error('timeout');};
 await assert.rejects(f.service.start('b',user,'sslcommerz','01712345678'));
 assert.equal(f.p.state,'SETTLED');
});


test("HTTP rate limiting hashes session credentials and bounds rotating cookies by IP", async () => {
  const Redis = require("ioredis").default;
  const { RedisService } = require("../dist/platform");
  const { Database } = require("../dist/db");
  const { hash } = require("../dist/crypto");
  const connect = Redis.prototype.connect;
  const limit = RedisService.prototype.limit;
  const query = Database.prototype.query;
  const keys: Array<{key:string; max:number}> = [];
  let blockIp = false;
  let app: any;
  Redis.prototype.connect = async () => undefined;
  RedisService.prototype.limit = async (key:string, max:number) => {
    keys.push({key, max});
    return !(blockIp && key.startsWith("rate:ip:"));
  };
  Database.prototype.query = async () => ({rows:[], rowCount:0});
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    const { createApp } = require("../dist/main");
    app = await createApp();
    await app.init();
    const request = require("supertest");
    const session = "private-session-test-value";
    await request(app.getHttpServer()).get("/api/events")
      .set("Cookie", "seatflow_session="+session).expect(200);
    assert.ok(keys.some(x => x.key === "rate:api:"+hash(session) && x.max === 240));
    assert.ok(keys.some(x => x.key.startsWith("rate:ip:") && x.max === 600));
    assert.ok(keys.every(x => !x.key.includes(session)));
    blockIp = true;
    for (const cookie of ["rotated-cookie-one", "rotated-cookie-two"])
      await request(app.getHttpServer()).get("/api/events")
        .set("Cookie", "seatflow_session="+cookie).expect(429);
  } finally {
    if (app) await app.close();
    Redis.prototype.connect = connect;
    RedisService.prototype.limit = limit;
    Database.prototype.query = query;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
});
