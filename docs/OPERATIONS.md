# Payment update operations

Read [PAYMENT_UPDATE_BN.md](PAYMENT_UPDATE_BN.md) before enabling external providers. Callback origin must be reachable by the provider over HTTPS. Never revert to the original worker after creating external payments: the updated worker checks the payment's stored provider before simulating any refund. External refunds require merchant portal operations and remain pending in-app; an operator must reconcile those obligations. Do not launch live payments until refund handling and merchant E2E are complete.

## Original demo operations

# Operations runbook

## Local setup versus deployment

Compose is a local sandbox configuration. It publishes only loopback port 3000; DB/Redis are internal. Live hosting is a separate task. For production set COOKIE_SECURE=true, exact HTTPS APP_ORIGIN, strong independent secrets, external payment/refund adapters and managed backups. NODE_ENV=production refuses insecure cookies.

ENABLE_SANDBOX=false disables the customer payment simulation and refuses to mark external refunds complete. It does not magically add Stripe/bKash. Production billing is not ready until adapters and reconciliation have been reviewed and tested.

## Safe commands

`docker compose down` stops the project while keeping its named volumes. Avoid `down -v` for routine shutdown. Do not change POSTGRES_PASSWORD after volume creation without actually rotating the PostgreSQL user password. Separate PG fields avoid URL parsing bugs, but dotenv syntax still applies.

Use `docker compose logs --tail=100 backend worker migrate`. Logs contain request IDs/method/path/status/duration, not body/cookies/passwords. They may include resource UUIDs. Debug provider payloads only in an isolated environment.

## Durable state and recovery

Bookings, ownership, payment events, refund state and outbox intent are PostgreSQL records. Redis availability is required for rate-limited API requests. Failed Redis publishing leaves outbox records pending. Worker restart republishes unprocessed entries. Duplicate job execution is expected and safe for database effects.

If a job has failed five times, inspect its last_error in the admin screen. Fix the cause, then retry that record. Do not manually set refund COMPLETED for real money movement. Sandbox notifications are stored in the application; there is no email/SMS delivery claim.

## Backup

Binary-safe: let PostgreSQL write inside the container, then copy to the host. This avoids PowerShell 5 text-redirection corrupting a custom-format dump.

```powershell
docker.exe compose exec -T postgres pg_dump -U seatflow -d seatflow -Fc -f /tmp/seatflow.dump
docker.exe compose cp postgres:/tmp/seatflow.dump ./seatflow.dump
```

Restore into a **new disposable database/container** first and inspect row counts/constraints. Do not overwrite the running demo without retaining a backup. Schedule encrypted backups and prove restore procedures before live use. Restore automation is intentionally not executed by the project.

## Monitor

Track oldest unprocessed outbox age, failed attempts, pending refunds, reservation conflicts, lock timeouts, pool saturation and HTTP duration. Admin confirmed_value is the value of currently CONFIRMED bookings; it is not net provider revenue and excludes cancelled bookings. A live ledger needs separate settlement/refund reconciliation.

Rate limiting in the API uses Redis. The local Nginx proxy does not forward an untrusted client IP into Express trust-proxy logic; login limits effectively share the proxy IP in Docker. For live deployment, configure a trusted proxy allowlist and per-account anti-abuse policy after threat review. Do not blindly enable `trust proxy=true`.

## Test isolation

`docker-compose.test.yml` uses project name seatflow-tests and database seatflow_test. Test code refuses a PGDATABASE not ending `_test`, then drops its public schema. Never point it at valuable data, even if the name happens to end `_test`.

The benchmark mutates the seeded demo: it creates/cancels temporary holds and leaves their audit records. ALLOW_BENCHMARK=true is required outside Compose. Use disposable data for benchmarks.
