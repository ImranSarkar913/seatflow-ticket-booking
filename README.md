# SeatFlow — Transactional Ticket Booking

A full-stack event ticket booking application built with NestJS, TypeScript, React and PostgreSQL. SeatFlow handles concurrent seat reservations, expiring holds, idempotent payment processing, late-payment compensation and role-scoped ticket admission.

The application includes a customer booking interface, staff check-in tools, an administration dashboard and background workers.

> **Payment integration:** Local payment simulation is available by default. SSLCOMMERZ hosted checkout and bKash tokenized checkout adapters are implemented but disabled until merchant credentials are configured. Provider verification is covered by mocked tests; merchant sandbox and live end-to-end acceptance remain unverified. External refunds require manual merchant-portal processing.

## Technology Stack

| Layer | Technologies |
| --- | --- |
| Backend | NestJS 12, TypeScript, Node.js 24 |
| Frontend | React 19, TypeScript, Vite 8 |
| Database | PostgreSQL 18, parameterized SQL, checksum-verified migrations |
| Background processing | Redis 7.4, BullMQ, PostgreSQL outbox |
| Authentication | Opaque cookie sessions, CSRF protection, role-based authorization |
| Testing | Node.js Test Runner, Supertest, Vitest, Testing Library |
| Deployment | Docker Compose, Nginx |
| CI | GitHub Actions |
| Optional browser testing | Playwright |

## Features

### Customer Booking

- Browse upcoming events and view seat availability with five-second polling.
- Reserve up to six seats through an atomic, idempotent booking operation.
- Automatically release expired holds.
- Pay through local simulation or a configured SSLCOMMERZ/bKash checkout.
- View booking status, payment history and an audit timeline.
- Receive a QR admission ticket after booking confirmation.
- Cancel eligible confirmed bookings until one hour before the event.

### Staff and Administration

- Restrict staff admission access to assigned events.
- Validate ticket tokens and safely handle repeated check-in requests.
- Prevent cancellation of checked-in tickets.
- Create events and assign existing staff accounts.
- Inspect refunds, outbox failures and operational summaries.
- Request retries for failed background jobs.

### Payment and Recovery

- Validate payment amounts and currencies against stored payment intents.
- Independently verify external provider settlements.
- Handle duplicate payment events without duplicate booking effects.
- Reconcile external payments when callbacks are missing.
- Preserve settled payment state when checkout initialization completes concurrently.
- Create refund obligations for late successful payments without reclaiming another customer's seats.
- Keep external refunds pending rather than marking them completed through the local simulator.

## Architecture and Correctness

PostgreSQL is the source of truth for inventory and booking state. Reservation mutations use transactions, per-event advisory locks and row locks to maintain consistent seat ownership.

The system applies the following rules:

- Overlapping multi-seat reservations either succeed completely or fail completely.
- Idempotent retries reuse the original reservation when the request matches.
- Reusing an idempotency key with a different request is rejected.
- Expired holds can be reclaimed even when the worker is unavailable.
- Late payment settlement cannot take seats from a newer reservation.
- Duplicate payment events cannot produce duplicate confirmation or refund effects.
- Repeated ticket check-in does not create duplicate admission records.

Redis supports queues and rate limiting; it does not own seat inventory. Background delivery uses a PostgreSQL outbox and BullMQ with at-least-once delivery and idempotent database effects.

Explicit parameterized SQL is used instead of an ORM to keep locking, transaction boundaries and conditional state transitions visible.

Per-event locking intentionally serializes inventory mutations for the same event. This favors understandable correctness; higher-demand workloads require further measurement and design work.

## Prerequisites

For the recommended Docker setup:

- Docker Desktop with the Linux container engine running.
- Docker Compose.
- Git, if cloning the repository.
- A local Node.js installation to run the environment setup scripts.

Application containers run Node.js 24. Native backend development requires Node.js 24.15 or later, PostgreSQL and Redis.

Run all root-level commands from the directory containing `docker-compose.yml`.

## Quick Start — New Installation

These commands work in Windows Git Bash:

```bash
node.exe scripts/setup-env.cjs
node.exe scripts/add-payment-env.cjs

docker.exe compose up --build -d
docker.exe compose --profile tools run --rm seed

docker.exe compose ps -a
```

The setup script generates local secrets. Provider integrations remain disabled by default.

Seed the database only for a new installation. The seed script refuses to overwrite a nonempty user database.

| Service | URL |
| --- | --- |
| Application | http://localhost:3000 |
| Swagger API documentation | http://localhost:3000/api/docs |
| Health endpoint | http://localhost:3000/api/health |
| Readiness endpoint | http://localhost:3000/api/ready |

### Demo Accounts

| Role | Email | Password |
| --- | --- | --- |
| Customer | customer@seatflow.example | Root `.env` → `DEMO_PASSWORD` |
| Staff | staff@seatflow.example | Same demo password |
| Admin | admin@seatflow.example | Same demo password |

Open the environment file locally to view the demo password:

```bash
notepad.exe .env
```

Never commit or share the actual `.env` file.

## Updating an Existing Installation

Keep the existing database password and local environment configuration.

If the previous installation is in `D:\seatflow-with-payments`, run these commands from the new project folder:

```bash
cp /d/seatflow-with-payments/.env .env
node.exe scripts/add-payment-env.cjs

docker.exe compose up --build -d --force-recreate
docker.exe compose ps -a
```

Replace the source path if your previous installation is elsewhere. If the updated code is already in the original folder and its `.env` is present, skip the copy command.

The Compose project name remains `seatflow`. With the same Docker context and existing volumes, the application reuses:

- `seatflow_postgres-data`
- `seatflow_redis-data`

Migrations are checksum-verified and repeatable. The payment migration adds checkout storage without replacing the original migration.

An exited `migrate` container with exit code `0` is expected.

Do not reseed an existing installation. Do not run `docker compose down -v` or delete the database volumes when preserving data.

After rebuilding, open http://localhost:3000 and perform a hard refresh.

## Environment Configuration

The root `.env.example` contains the supported local configuration.

| Variable | Purpose |
| --- | --- |
| `POSTGRES_PASSWORD` | Local PostgreSQL password |
| `DEMO_PASSWORD` | Password used when creating demo accounts |
| `WEBHOOK_SECRET` | Secret for signed local payment webhooks |
| `APP_ORIGIN` | Allowed frontend origin |
| `COOKIE_SECURE` | Whether session cookies require HTTPS |
| `HOLD_SECONDS` | Seat hold duration |
| `ENABLE_SANDBOX` | Enable local payment simulation |
| `PAYMENT_ENVIRONMENT` | Provider environment |
| `PAYMENT_CALLBACK_ORIGIN` | Public callback origin |
| `SSLCOMMERZ_ENABLED` | Enable SSLCOMMERZ checkout |
| `BKASH_ENABLED` | Enable bKash checkout |

Local Compose exposes the frontend only at `127.0.0.1:3000`. PostgreSQL and Redis remain internal to the Docker network.

The supplied configuration is intended for local development. Public deployment requires HTTPS, secure cookies, managed secrets, backups and appropriate proxy configuration.

## Payment Provider Setup

### Local Simulation

Local simulation requires no merchant account and is enabled by default. Use it to demonstrate reservation, confirmation, cancellation and simulated refund workflows.

It does not transfer money.

### SSLCOMMERZ

Configure the following values in the root `.env`:

```dotenv
PAYMENT_ENVIRONMENT=sandbox
PAYMENT_CALLBACK_ORIGIN=https://your-public-sandbox-host.example

SSLCOMMERZ_ENABLED=true
SSLCOMMERZ_STORE_ID=your-sandbox-store-id
SSLCOMMERZ_STORE_PASSWORD=your-sandbox-store-password
```

### bKash

Configure the following values:

```dotenv
PAYMENT_ENVIRONMENT=sandbox
PAYMENT_CALLBACK_ORIGIN=https://your-public-sandbox-host.example

BKASH_ENABLED=true
BKASH_USERNAME=your-sandbox-username
BKASH_PASSWORD=your-sandbox-password
BKASH_APP_KEY=your-sandbox-app-key
BKASH_APP_SECRET=your-sandbox-app-secret
```

These are placeholders. Use credentials supplied for your merchant sandbox.

Both providers require an externally reachable HTTPS callback origin. Configure the frontend origin and deployment routing consistently with that public host.

After changing environment values, recreate the services:

```bash
docker.exe compose up -d --force-recreate
```

Before enabling live payments, validate the merchant API contract and complete sandbox tests for successful payment, cancellation, failed payment, repeated callbacks, missing callbacks and late settlement.

External refund execution is not automated. Refund obligations remain pending in the application and must be handled through the merchant portal.

## Tests and Verification

### Backend Docker Suite

Run the complete backend suite against a separate test PostgreSQL database and Redis instance:

```bash
docker.exe compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests

docker.exe compose -f docker-compose.test.yml down
```

The test database is separate from the local demo database.

The reviewed version passed the following suites on Windows Docker Desktop:

| Suite | Passed |
| --- | ---: |
| Cryptography unit tests | 3 |
| Payment and security tests | 17 |
| Native PostgreSQL/Redis integration tests | 15 |
| **Total backend tests** | **35** |

No backend tests failed or were skipped.

The native concurrency scenario submitted 100 simultaneous reservation attempts for the same seat and produced:

- One successful hold.
- 99 conflicts.
- No double booking in that scenario.

This verifies single-seat contention behavior under the tested conditions. It is not a general throughput or production-capacity benchmark.

### Frontend Tests and Build

From the `frontend` directory:

```bash
npm ci --ignore-scripts
npm test
npm run build
```

The reviewed frontend passed seven tests and its TypeScript/production build.

At review time, `npm audit` reported no known vulnerabilities in backend production dependencies or the full frontend dependency tree. Dependency audit results do not establish complete application security.

### Optional Contention Probe

With the local demo seeded:

```bash
docker.exe compose --profile tools run --rm benchmark
```

This probe creates and cancels holds in the demo database. The expected same-seat result is one successful hold, 99 conflicts and zero unexpected errors.

### Optional Browser End-to-End Test

With the seeded local application running on port `3000`, open PowerShell in `frontend`:

```powershell
npm ci --ignore-scripts
npx playwright install chromium

$env:E2E_DEMO_PASSWORD = Read-Host "Local demo password"
npm run test:e2e
Remove-Item Env:E2E_DEMO_PASSWORD
```

The test creates, pays and cancels a booking. Use disposable demo data.

Browser binaries are installed separately. The optional browser suite is not included in the default CI workflow.

## Continuous Integration

GitHub Actions is configured to run:

- Backend unit and payment/security tests.
- Native PostgreSQL/Redis integration tests.
- Frontend tests.
- Backend and frontend compilation.

The workflow runs on pushes and pull requests. Check the repository's Actions tab for the result of each revision; workflow configuration alone does not prove a successful CI run.

## Native Development

Docker is the recommended setup. For native development, configure reachable PostgreSQL and Redis services.

### Backend

Copy `backend/.env.example` to `backend/.env` and configure the values.

From `backend`:

```bash
npm ci --ignore-scripts
npm run build
npm run migrate
npm run seed
npm start
```

Seed only a new database and configure the required seed settings.

Start the worker in a separate terminal:

```bash
npm run worker
```

`npm run dev` performs an initial build and watches compiled output. After changing TypeScript source, rebuild to update `dist`.

### Frontend

From `frontend`:

```bash
npm ci --ignore-scripts
npm start
```

## Repository Structure

| Path | Contents |
| --- | --- |
| `backend/src/` | Controllers, authentication, booking logic, database access and workers |
| `backend/migrations/` | PostgreSQL schema migrations |
| `backend/test/` | Unit, payment, HTTP, lifecycle and concurrency tests |
| `frontend/src/` | Typed React application and frontend tests |
| `frontend/e2e/` | Optional Playwright workflow test |
| `scripts/` | Local environment setup utilities |
| `.github/workflows/` | CI configuration |
| `docs/` | Supporting technical documentation |

Additional technical references:

- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)
- [Payment design](docs/PAYMENT_DESIGN.md)
- [Operations](docs/OPERATIONS.md)

## Troubleshooting

Inspect service status:

```bash
docker.exe compose ps -a
```

Inspect application logs:

```bash
docker.exe compose logs --tail=100 backend worker migrate
```

Common situations:

| Situation | Action |
| --- | --- |
| `migrate` exited with code `0` | Expected; migration completed successfully |
| Tests exited with code `0` | Test execution succeeded |
| `Aborting on container exit` after successful tests | Expected with `--abort-on-container-exit` |
| Provider checkout is unavailable | Check provider enablement, merchant credentials and HTTPS callback configuration |
| Existing accounts fail after an update | Confirm that the original `.env` and Docker volumes were retained |
| HTTP `429` | Wait for the rate-limit window to reset |
| Frontend displays an older build | Rebuild containers and hard-refresh the browser |

To stop the application while retaining database volumes:

```bash
docker.exe compose down
```

## Current Limitations

- Merchant sandbox and live payment end-to-end acceptance are not verified.
- External refunds require manual merchant-portal processing.
- Notifications are in-app; outbound email and SMS are not implemented.
- Password reset, camera-based QR scanning, event editing/deletion and staff invitation flows are not implemented.
- Public registration creates customer accounts; staff accounts must already exist before assignment.
- Availability uses polling rather than WebSockets.
- Per-event locking serializes inventory mutations for the same event.
- Request logging and operational summaries are included; external tracing and metrics infrastructure are not.
- Behind the supplied Nginx proxy, source-IP rate limits may be shared across clients. Public deployment requires deliberate trusted-proxy configuration.
- Production hosting, backup scheduling and production-scale load testing require additional work.

## Git Hygiene

The root `.gitignore` excludes local secrets and generated files, including:

- `.env` and local environment variants.
- `node_modules/`.
- `dist/` and `build/`.
- Coverage, logs and browser test reports.
- Local update backups.

Commit `.env.example` templates with placeholders, not actual credentials.

Review staged files before committing:

```bash
git add -A
git status --short
git diff --cached --stat
```

## License

MIT. See [LICENSE](LICENSE).