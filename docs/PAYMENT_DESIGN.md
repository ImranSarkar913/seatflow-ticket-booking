# Provider integration design and limits

## Settlement boundary

The frontend never submits a price, currency or successful outcome to provider checkout. An authenticated, CSRF-protected checkout request supplies only a provider and phone number. The amount comes from the stored reservation. Each payment is bound to one provider before any outbound API call.

SSLCOMMERZ notifications and browser returns are public form endpoints. Their contents are untrusted. A validation ID is independently validated with merchant credentials, and invoice, amount, BDT currency and risk level are compared with stored values. Missing callbacks can be recovered by transaction-ID lookup followed by the same validation call.

bKash uses server-only token grant, checkout create, query and execute. A callback only identifies a stored payment. Querying a completed payment avoids re-executing it; an execute transport timeout triggers a status query. Invoice, amount, currency, intent and payment ID must all match. Tokens are cached in process and are never returned to the frontend.

A verified settlement enters the existing booking transaction. Event inventory locking, expiry and late-payment refund requests are reused. An internal provider guard is checked while the payment row is locked, so an overlapping local-simulation request cannot settle a payment that has just been assigned to an external provider. The generic signed demo webhook also cannot settle external payments.

## Idempotency and failure recovery

Checkout state is stored in additive `payment_checkouts`; the original migration is untouched. Retries reuse a ready checkout. An uncertain initialization is not automatically repeated. SSLCOMMERZ can be queried by the stable merchant invoice; an uncertain bKash creation without a saved remote payment ID requires merchant investigation.

Verification uses a nonblocking PostgreSQL session advisory lock per payment. Network calls happen outside database transactions. The settlement transaction reuses that same checked-out connection, avoiding pool starvation from taking a second connection. Session locks are released, or the connection is destroyed if cleanup fails. Provider references map to deterministic settlement event IDs; the existing event ledger rejects conflicting reuse and makes replay harmless.

The worker checks up to five unsettled payments per reconciliation tick, no more often than once a minute per record. Automatic reconciliation scans the previous seven days. Older exceptions require explicit customer refresh/merchant investigation. This is a bounded recovery mechanism, not a complete accounting system. A provider failure is pending/unknown, never proof that no money moved.

No provider network traffic is attempted when both adapters are disabled. API secrets are neither shipped nor logged. HTTP requests have timeouts, reject redirects and sanitize network errors. Hosted checkout links use fixed HTTPS hostname allowlists; unknown hosts require an intentional adapter review rather than arbitrary redirects.

## Refunds and production boundary

Only payments whose stored provider is `sandbox` can receive a simulated refund. An external cancellation or late settlement creates a genuine pending refund obligation and visible worker error. External refunds are **not sent automatically**; the merchant must operate the provider portal. The app deliberately does not offer an unverified "mark paid/refunded" switch. Pending external refunds remain pending until a future provider-verified refund adapter is implemented.

This update is a checkout integration scaffold with mocked contract tests. It is not credential-validated merchant sandbox integration, a live payment certification or a complete automated refund system. Before live operation, resolve refund/exception operations, validate the approved provider API version, perform merchant E2E tests and configure HTTPS/secrets/monitoring/backups. Do not advertise external refunds as automated.

## Official references reviewed

- SSLCOMMERZ v4 documentation: https://developer.sslcommerz.com/doc/v4/index.html (session initiation, order validation and transaction query).
- SSLCOMMERZ sandbox registration: https://developer.sslcommerz.com/registration/
- bKash official versioned sandbox demo: https://merchantdemo.sandbox.bka.sh/tokenized-checkout/version/v1.2.0-beta and its publicly served checkout JavaScript (checkout-only mode, invoice, callback and response shape).
- bKash tokenized documentation links: https://developer.bka.sh/docs/tokenized-checkout-overview , https://developer.bka.sh/docs/create-payment-2 , https://developer.bka.sh/docs/execute-payment-2 , https://developer.bka.sh/docs/query-payment-1 . These documentation pages could not be retrieved during this build. The adapter targets the versioned v1.2.0-beta contract; verify it against the merchant onboarding specification before enabling it.

No real provider credentials were supplied, and no real money was moved.


## Reviewed checkout state race

Initialization responses only change INITIATING/UNKNOWN to READY; initialization errors only change INITIATING to UNKNOWN. A concurrent SETTLED row stays settled. The caller receives a conflict and is directed to My bookings rather than being given a stale checkout URL. Regression tests cover successful and timed-out initialization after concurrent settlement.
