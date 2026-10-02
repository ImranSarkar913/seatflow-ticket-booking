# SeatFlow — Interview Guide

## 45-Second Project Overview

“SeatFlow is a full-stack event ticket booking application built with NestJS, TypeScript, React and PostgreSQL. I used database transactions, advisory locks and row locks to maintain consistent seat ownership during concurrent reservations. The system supports expiring holds, idempotent payment handling and late-payment refund obligations without reclaiming another customer's seats. Background processing uses Redis, BullMQ and a PostgreSQL outbox. It also includes event-scoped staff permissions, QR admission tickets, audit timelines, Docker Compose and CI configuration. SSLCOMMERZ and bKash adapters are implemented and tested with mocks; merchant end-to-end validation remains pending.”

Understand the implementation and explain it in your own words. Discuss AI assistance honestly when asked. Demonstrate your contribution through design reasoning, code walkthroughs, debugging and test evidence.

## Design Questions and Answers

### What happens when two customers request the same seat?

PostgreSQL owns the inventory state. Reservation mutations acquire the same event-level transaction lock and then lock the relevant seat rows.

After the first transaction commits, the next transaction checks the current ownership and rejects an unavailable seat with a conflict.

The reviewed version passed a native PostgreSQL concurrency test with 100 simultaneous same-seat reservation attempts: one successful hold and 99 conflicts.

This demonstrates contention correctness for that scenario, not general production throughput.

### Why not use Redis locks for seat reservations?

Redis supports queues and rate limiting. Inventory correctness stays within PostgreSQL transactions, locks and constraints.

This keeps seat ownership independent of queue availability and avoids making Redis lock expiration part of the inventory consistency model.

### Does event-level locking reduce throughput?

Yes. Inventory mutations for the same event are serialized.

Different events can proceed independently, subject to database and connection-pool capacity. Event-level locking makes correctness easier to reason about, but a high-demand event may require a more granular locking design.

Any redesign should be evaluated with correctness tests and representative benchmarks.

### What happens to expired holds when the worker is unavailable?

Reservation operations perform lazy expiration before assigning inventory. The worker provides proactive cleanup.

The availability view accounts for expired holds, but the reservation transaction remains the final authority when assigning seats.

### What happens if a payment succeeds after the hold expires?

The system checks the booking's current eligibility and seat ownership before confirmation.

If confirmation is no longer valid, the old booking is not confirmed. A refund obligation and corresponding outbox work are created.

Seats owned by a newer reservation are not reclaimed.

### What happens when the same webhook arrives repeatedly?

Payment events have unique identifiers and payload fingerprints.

An identical retry does not repeat the database effect. Reusing the same event identifier with a different payload is rejected.

Settlement also checks the stored payment amount and currency. A later failure event cannot downgrade an already confirmed payment.

External provider callbacks are independently verified before entering the settlement flow.

### How do you prevent checkout initialization from overwriting settlement?

A callback can settle a payment before the checkout initialization response returns.

Conditional updates prevent initialization from changing a SETTLED checkout back to READY or UNKNOWN. Regression tests cover both a successful initialization response and an initialization timeout after concurrent settlement.

### Is background processing exactly once?

No. Queue delivery is at least once.

Outbox identifiers, notification identifiers and refund uniqueness constraints make the relevant database effects idempotent.

External side effects require their own provider-specific guarantees and reconciliation. External refunds are currently handled manually through the merchant portal.

### What happens when cancellation and payment settlement occur concurrently?

Both flows acquire the same event-level lock.

For an eligible cancellation, if payment settles first, cancellation creates a refund obligation. If cancellation happens first, a later successful settlement creates the refund obligation.

Database constraints prevent duplicate refund records. Cancellation eligibility rules still apply, including the event cutoff and admission status.

### How is repeated QR admission handled?

Each confirmed booking receives a random admission token.

Staff access is checked against event assignments. The first valid check-in records admission; subsequent scans return an already-checked-in result without creating duplicate admission effects.

Checked-in tickets cannot be cancelled.

### Why did you use parameterized SQL instead of an ORM?

The reservation and settlement paths depend on explicit locks, transaction boundaries and conditional updates.

Parameterized SQL keeps those operations visible and auditable. An ORM could also be used, but the same consistency rules would still need to be implemented.

### What security controls are included?

- Salted password hashing.
- Opaque sessions stored through HTTP-only cookies.
- Session revocation on logout.
- CSRF and origin checks for authenticated mutations.
- Role-based authorization and event-scoped staff access.
- Request validation and parameterized SQL.
- Redis-backed rate limiting.
- Hashed session identifiers in rate-limit keys.
- Signed local payment webhooks.
- Independent external settlement verification.
- Restricted checkout redirects and bounded provider requests.

These controls are implemented and tested within the documented scope. They do not constitute a production security certification.

### What remains unverified or unimplemented?

SSLCOMMERZ and bKash adapters are implemented, and mocked provider tests pass. Merchant sandbox and live end-to-end acceptance have not been completed.

Other limitations include:

- Manual external refund execution.
- No outbound email or SMS.
- No password-reset flow.
- No camera-based QR scanner.
- No external tracing infrastructure.
- No production hosting or production-scale load testing.
- Per-event inventory serialization.
- Public deployment requires deliberate proxy, HTTPS, secrets and backup configuration.

## Verified Test Evidence

The reviewed backend passed its Docker suite against native PostgreSQL and Redis:

| Suite | Passed |
| --- | ---: |
| Cryptography unit tests | 3 |
| Payment and security tests | 17 |
| PostgreSQL/Redis integration tests | 15 |
| Total backend tests | 35 |

No backend tests failed or were skipped.

The reviewed frontend passed seven tests and its production build.

The native same-seat contention test produced one successful hold and 99 conflicts from 100 concurrent reservation attempts.

Provider tests use mocks. These results do not demonstrate merchant acceptance, real-money settlement or production capacity.

## Interview Preparation

1. Trace the hold, settlement and cancellation flows in `booking.ts`.
2. Explain where locks are acquired and when transactions commit.
3. Keep the native test output available as evidence.
4. Demonstrate expiration and rebooking while the worker is stopped.
5. Explain how a late payment creates a refund obligation.
6. Walk through duplicate webhook and unauthorized staff tests.
7. Explain the checkout initialization race and its regression tests.
8. Discuss event-level locking as a deliberate tradeoff.
9. Distinguish implemented provider adapters from verified merchant integration.

## CV Bullets

Select three bullets that match the role and fit your CV:

- Built a full-stack ticket booking application using NestJS, TypeScript, React and PostgreSQL, with expiring seat holds, cookie-based sessions and event-scoped admission controls.
- Implemented transactional inventory and idempotent reservation/payment handling; verified same-seat contention with 100 concurrent attempts producing one successful hold and 99 conflicts.
- Added Redis/BullMQ workers with a PostgreSQL outbox, QR admission tickets, Docker Compose and automated backend/frontend tests.
- Implemented SSLCOMMERZ and bKash checkout adapters with independent settlement verification, callback reconciliation and mocked regression tests; merchant end-to-end validation pending.

Use measured results and explain their scope. Do not claim production customers, revenue, internet-scale throughput or completed live payment validation without supporting evidence.