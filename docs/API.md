# Provider checkout API addition

| Method | Path under /api | Authorization |
|---|---|---|
| GET | /payment-checkout/methods | Public; enabled methods only, no secrets |
| POST | /payment-checkout/bookings/:id | Booking owner; session + Origin + CSRF; JSON provider and phone |
| POST | /payment-checkout/:id/refresh | Payment owner; session + Origin + CSRF |
| POST | /payment-checkout/sslcommerz/ipn | Public form callback; independently verified with provider |
| POST | /payment-checkout/sslcommerz/return | Public form return; verification + fixed-origin 303 redirect |
| GET | /payment-checkout/bkash/return | Public query callback; query/execute verification + fixed-origin redirect |

Checkout body: `{ "provider": "sslcommerz", "phone": "01712345678" }` or provider `bkash`. No amount or success flag is accepted. The response includes paymentId and a validated hosted checkout URL. Provider calls require configured credentials. Refund obligations for external providers remain pending manual merchant action; no external refund completion API is provided.

## Original API reference

# API guide

All routes are under `/api`. Interactive DTO documentation: `/api/docs`. Error JSON includes `statusCode`, `message` and `requestId`; the response header also carries `X-Request-Id`.

Browser auth uses credentials-included cookies. `/auth/login` and `/auth/me` return a CSRF token. Every authenticated mutation needs `X-CSRF-Token` and the configured `Origin`. Never place session secrets in URLs/localStorage.

| Method | Route                        | Access / purpose                                           |
| ------ | ---------------------------- | ---------------------------------------------------------- |
| POST   | /auth/register               | Public; creates CUSTOMER only; name, email, password       |
| POST   | /auth/login                  | Public; returns user/CSRF and session cookie               |
| GET    | /auth/me                     | Session user/CSRF                                          |
| POST   | /auth/logout                 | Revokes current session                                    |
| GET    | /events?search=&page=1       | Public; 12 future published events/page                    |
| GET    | /events/:id                  | Public; seat map and server time                           |
| POST   | /events                      | ADMIN; creates event and priced seat inventory             |
| POST   | /bookings/holds              | Session; Idempotency-Key required; eventId + seatIds       |
| GET    | /bookings?page=1             | Own bookings, 20/page                                      |
| GET    | /bookings/:id                | Own detail; refreshes effective hold expiry                |
| GET    | /bookings/:id/audit          | Own lifecycle history                                      |
| POST   | /bookings/:id/payment-intent | Own active hold; one intent per booking                    |
| POST   | /payments/:id/sandbox-settle | Own intent; outcome SUCCEEDED or FAILED; sandbox only      |
| POST   | /payments/webhook            | Public signature-verified provider boundary                |
| POST   | /bookings/:id/cancel         | Own booking; idempotent, cutoff enforced                   |
| POST   | /check-in                    | ADMIN or event-assigned STAFF; ticket token                |
| GET    | /notifications               | Own in-app notifications                                   |
| GET    | /admin/summary               | ADMIN; confirmed value, jobs, refunds and admission counts |
| GET    | /admin/staff                 | ADMIN; existing staff accounts                             |
| POST   | /admin/events/:id/staff      | ADMIN; assign userId; duplicate-safe                       |
| POST   | /admin/jobs/:id/retry        | ADMIN; reset pending task retry metadata                   |
| GET    | /health                      | Process health/time/payment mode                           |
| GET    | /ready                       | Database and Redis readiness                               |

## Hold payload

```json
{ "eventId": "EVENT_UUID", "seatIds": ["SEAT_UUID_1", "SEAT_UUID_2"] }
```

`Idempotency-Key`: 8–100 letters/numbers/underscore/hyphen. A new booking intent gets a new key; retries keep the key. Seat IDs are sorted for fingerprinting, so reordered identical seats reuse the original booking. Fields such as price/role/userId are not accepted.

## Signed webhook

```json
{
  "eventId": "provider-event-unique-id",
  "paymentId": "PAYMENT_UUID",
  "outcome": "SUCCEEDED",
  "amount": 75000,
  "currency": "BDT"
}
```

Compute HMAC-SHA256 with `WEBHOOK_SECRET` over the timestamp string, a period and the **exact UTF-8 body bytes**. Send hex signature in `X-Webhook-Signature`, epoch seconds in `X-Webhook-Timestamp`. Timestamp tolerance is five minutes. A provider must freshly sign retransmitted events while retaining the event ID; the database then deduplicates.

## Status codes

Nest POST routes return 201 on accepted mutations, including idempotent retries. GETs return 200. Invalid DTO/price/currency: 400. No session/invalid signature: 401. Role/origin/CSRF failure: 403. Missing/other customer's booking: 404. Inventory/state/idempotency conflict: 409. Rate limit: 429. Dependencies/lock timeout: 503.

Do not retry a 409 with the same stale seat selection indefinitely. Refresh inventory. Retrying a network failure with the same hold key is safe. Payment intent creation also reuses the stored intent.
