import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Database } from "./db";
import { BookingService } from "./booking";
import { User } from "./auth";
import { config } from "./config";
import { paymentConfig, sslOrigin } from "./payment-config";
import {
  Provider,
  providerRequest,
  sslCredentials,
  sslQuery,
  bkashRequest,
  safeCheckout,
  taka,
  verifySettlement,
} from "./payment-provider";
@Injectable()
export class CheckoutService {
  constructor(
    private readonly db: Database,
    private readonly booking: BookingService,
  ) {}
  methods() {
    return {
      environment: paymentConfig.environment,
      sandbox: config.sandbox,
      sslcommerz: paymentConfig.ssl.enabled,
      bkash: paymentConfig.bkash.enabled,
    };
  }
  async start(
    bookingId: string,
    user: User,
    provider: Provider,
    phone: string,
  ) {
    if (
      !(provider === "sslcommerz"
        ? paymentConfig.ssl.enabled
        : paymentConfig.bkash.enabled)
    )
      throw new ServiceUnavailableException(
        "This payment provider is not configured",
      );
    const p = await this.booking.paymentIntent(bookingId, user);
    const claim = await this.db.tx(async (c) => {
      await c.query("SELECT * FROM payments WHERE id=$1 FOR UPDATE", [p.id]);
      const existing = (
        await c.query("SELECT * FROM payment_checkouts WHERE payment_id=$1", [
          p.id,
        ])
      ).rows[0];
      if (existing) {
        if (existing.provider !== provider)
          throw new ConflictException(
            "This reservation is already bound to another payment method",
          );
        return { ...existing, existing: true };
      }
      const locked = (
        await c.query("SELECT * FROM payments WHERE id=$1", [p.id])
      ).rows[0];
      if (locked.provider !== "sandbox" || locked.state !== "CREATED")
        throw new ConflictException(
          "Payment already attempted; use a new reservation",
        );
      const invoice = "SF" + p.id.replace(/-/g, "").slice(0, 28);
      await c.query("UPDATE payments SET provider=$2 WHERE id=$1", [
        p.id,
        provider,
      ]);
      await c.query(
        "INSERT INTO payment_checkouts(payment_id,provider,invoice) VALUES($1,$2,$3)",
        [p.id, provider, invoice],
      );
      return { invoice, existing: false };
    });
    if (claim.existing) {
      if (claim.state === "READY" && claim.checkout_url)
        return { paymentId: p.id, checkoutUrl: claim.checkout_url };
      throw new ConflictException(
        "Checkout creation or settlement is pending. Refresh payment status; do not pay again.",
      );
    }
    try {
      let result: any, remote: string | undefined, url: string;
      const callback = paymentConfig.callbackOrigin + "/api/payment-checkout/";
      if (provider === "sslcommerz") {
        result = await providerRequest(sslOrigin + "/gwprocess/v4/api.php", {
          ...sslCredentials(),
          total_amount: taka(p.amount),
          currency: "BDT",
          tran_id: claim.invoice,
          success_url: callback + "sslcommerz/return",
          fail_url: callback + "sslcommerz/return",
          cancel_url: callback + "sslcommerz/return",
          ipn_url: callback + "sslcommerz/ipn",
          shipping_method: "NO",
          product_name: "Event admission",
          product_category: "Tickets",
          product_profile: "non-physical-goods",
          cus_name: user.name,
          cus_email: user.email,
          cus_phone: phone,
          cus_add1: "Not collected - digital admission",
          cus_city: "Dhaka",
          cus_country: "Bangladesh",
        });
        if (
          result.status !== "SUCCESS" ||
          typeof result.sessionkey !== "string"
        )
          throw new Error("Checkout rejected");
        remote = result.sessionkey;
        url = safeCheckout(result.GatewayPageURL, provider);
      } else {
        result = await bkashRequest("create", {
          mode: "0011",
          payerReference: phone,
          callbackURL: callback + "bkash/return",
          amount: taka(p.amount),
          currency: "BDT",
          intent: "sale",
          merchantInvoiceNumber: claim.invoice,
        });
        if (
          result.statusCode !== "0000" ||
          typeof result.paymentID !== "string"
        )
          throw new Error("Checkout rejected");
        remote = result.paymentID;
        url = safeCheckout(result.bkashURL, provider);
      }
      if (!remote || remote.length > 160)
        throw new Error("Invalid provider reference");
      const saved = await this.db.query(
        "UPDATE payment_checkouts SET state='READY',provider_payment_id=$2,checkout_url=$3,last_error=NULL WHERE payment_id=$1 AND state IN ('INITIATING','UNKNOWN') RETURNING payment_id",
        [p.id, remote, url],
      );
      if (!saved.rowCount) throw new ConflictException("Payment status changed during checkout creation. Open My bookings; do not pay again.");
      return { paymentId: p.id, checkoutUrl: url };
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      await this.db.query(
        "UPDATE payment_checkouts SET state='UNKNOWN',last_error='Checkout initiation uncertain; no automatic second creation' WHERE payment_id=$1 AND state='INITIATING'",
        [p.id],
      );
      throw new ServiceUnavailableException(
        "Checkout initiation uncertain. Do not pay again; inspect booking/payment status or contact merchant.",
      );
    }
  }
  async ownRefresh(id: string, user: User) {
    const p = (
      await this.db.query(
        "SELECT p.id FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE p.id=$1 AND b.user_id=$2",
        [id, user.id],
      )
    ).rows[0];
    if (!p) throw new NotFoundException("Payment not found");
    return this.verify(id, false);
  }
  async sslCallback(invoice: unknown, valId: unknown) {
    if (typeof invoice !== "string" || invoice.length > 100)
      throw new BadRequestException("Missing transaction ID");
    const p = (
      await this.db.query(
        "SELECT payment_id FROM payment_checkouts WHERE invoice=$1 AND provider='sslcommerz'",
        [invoice],
      )
    ).rows[0];
    if (!p) throw new NotFoundException("Unknown checkout");
    return this.verify(
      p.payment_id,
      false,
      typeof valId === "string" && valId.length <= 160 ? valId : undefined,
    );
  }
  async bkashCallback(id: unknown, status: unknown) {
    if (typeof id !== "string" || id.length > 160)
      throw new BadRequestException("Missing payment ID");
    const p = (
      await this.db.query(
        "SELECT payment_id FROM payment_checkouts WHERE provider_payment_id=$1 AND provider='bkash'",
        [id],
      )
    ).rows[0];
    if (!p) throw new NotFoundException("Unknown checkout");
    return this.verify(p.payment_id, status === "success");
  }
  async verify(id: string, execute = false, valId?: string) {
    // Session advisory lock on a dedicated connection: provider requests are outside database transactions.
    const c = await this.db.pool.connect();
    let locked = false;
    try {
      locked = (
        await c.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1,7)) ok",
          ["verify:" + id],
        )
      ).rows[0].ok;
      if (!locked) return { pending: true };
      const p = (
        await c.query(
          "SELECT pc.*,p.amount,p.state payment_state,p.booking_id FROM payment_checkouts pc JOIN payments p ON p.id=pc.payment_id WHERE p.id=$1",
          [id],
        )
      ).rows[0];
      if (!p) throw new NotFoundException("External checkout not found");
      if (p.state === "SETTLED") return { ok: true, bookingId: p.booking_id };
      let result: any;
      if (p.provider === "sslcommerz") {
        if (valId) result = await sslQuery({ val_id: valId }, true);
        else {
          const q = await sslQuery({ tran_id: p.invoice });
          const candidate = Array.isArray(q.element)
            ? q.element.find(
                (v: any) =>
                  v.tran_id === p.invoice &&
                  ["VALID", "VALIDATED"].includes(v.status) &&
                  typeof v.val_id === "string",
              )
            : q;
          if (!candidate?.val_id)
            return { pending: true, bookingId: p.booking_id };
          result = await sslQuery({ val_id: candidate.val_id }, true);
        }
        if (!["VALID", "VALIDATED"].includes(result.status))
          return { pending: true, bookingId: p.booking_id };
      } else {
        if (!p.provider_payment_id)
          return { pending: true, bookingId: p.booking_id };
        result = await bkashRequest("payment/status", {
          paymentID: p.provider_payment_id,
        });
        if (
          result.transactionStatus !== "Completed" &&
          (execute || result.userVerificationStatus === "Complete")
        ) {
          try {
            result = await bkashRequest("execute", {
              paymentID: p.provider_payment_id,
            });
          } catch {
            result = await bkashRequest("payment/status", {
              paymentID: p.provider_payment_id,
            });
          }
        }
        if (result.transactionStatus !== "Completed")
          return { pending: true, bookingId: p.booking_id };
      }
      const reference = verifySettlement(
        p.provider,
        result,
        p,
        p.provider_payment_id,
      );
      // Stable settlement event prevents callback/reconciliation double confirmation.
      await this.booking.applyWebhook(
        {
          eventId:
            "provider_" +
            createHash("sha256")
              .update(p.provider + ":" + reference)
              .digest("hex"),
          paymentId: id,
          outcome: "SUCCEEDED",
          amount: p.amount,
          currency: "BDT",
        },
        p.provider,
        c,
      );
      await c.query(
        "UPDATE payment_checkouts SET state='SETTLED',settlement_reference=$2,verified_at=clock_timestamp(),last_error=NULL WHERE payment_id=$1",
        [id, reference],
      );
      return { ok: true, bookingId: p.booking_id };
    } catch (e) {
      await c.query(
        "UPDATE payment_checkouts SET last_error='Provider verification pending or rejected; retry or inspect merchant portal' WHERE payment_id=$1",
        [id],
      );
      throw e;
    } finally {
      let destroy = false;
      try {
        if (locked) {
          await c.query(
            "UPDATE payment_checkouts SET last_checked_at=clock_timestamp() WHERE payment_id=$1",
            [id],
          );
          await c.query("SELECT pg_advisory_unlock(hashtextextended($1,7))", [
            "verify:" + id,
          ]);
        }
      } catch {
        destroy = true;
      } finally {
        c.release(destroy);
      }
    }
  }
  async reconcile() {
    if (!paymentConfig.ssl.enabled && !paymentConfig.bkash.enabled) return;
    const pending = (
      await this.db.query(
        "SELECT payment_id FROM payment_checkouts WHERE state<>'SETTLED' AND created_at>now()-interval '7 days' AND (last_checked_at IS NULL OR last_checked_at<now()-interval '60 seconds') ORDER BY last_checked_at NULLS FIRST LIMIT 5",
      )
    ).rows;
    for (const p of pending)
      try {
        await this.verify(p.payment_id);
      } catch {
        /* sanitized error persisted; next tick retries */
      }
  }
}
