# SeatFlow — Local Setup and Demo Guide

## Prerequisites

Keep Docker Desktop running with its Linux container engine enabled.

A local Node.js installation is needed to run the environment setup scripts. Docker runs the application using Node.js 24 images.

Open your terminal in the project root: the directory containing `docker-compose.yml`, `backend/`, `frontend/` and `docs/`.

If another application, such as the Industrial Incident Dashboard, already uses port `3000`, stop it from that application's project root:

```powershell
docker.exe compose down
```

Do not delete its database volumes. The projects have different Compose names but use the same browser port.

## 1. Configure the Environment

For a new installation, run:

```powershell
node scripts/setup-env.cjs
node scripts/add-payment-env.cjs
notepad .env
```

The setup script generates random local passwords and secrets. It does not overwrite an existing `.env`.

The root `.env` contains `DEMO_PASSWORD`, which is used to create the demo accounts. Keep this file private and do not commit it.

### Manual Configuration

If Node.js is unavailable, copy the template:

```powershell
Copy-Item .env.example .env
notepad .env
```

Replace the placeholder values:

- `POSTGRES_PASSWORD`: use a strong local database password.
- `DEMO_PASSWORD`: use 12–128 characters.
- `WEBHOOK_SECRET`: use at least 32 characters.

Letters, numbers and hyphens make manual configuration straightforward. If using characters such as `#` or `$`, single-quote the value in `.env`.

The application uses separate PostgreSQL connection fields, so the database password does not require URL encoding.

If `APP_ORIGIN=http://localhost:3000`, open the application using `localhost`, rather than `127.0.0.1`.

### Existing Installation

Preserve the original `.env` and database password. Do not generate replacement credentials for an existing database.

If moving the updated code to a new folder, copy the previous installation's `.env` into the new project root, then run:

```powershell
node scripts/add-payment-env.cjs
```

The script appends missing payment settings without replacing existing values. See the main README for the complete upgrade procedure.

## 2. Start the Application

For a new installation:

```powershell
docker.exe compose up --build -d
docker.exe compose --profile tools run --rm seed
docker.exe compose ps -a
```

The `migrate` container exiting with code `0` is expected. PostgreSQL, Redis and the backend should become healthy.

Seed only a new database. If users already exist, skip seeding and sign in with the existing accounts.

Open http://localhost:3000.

| Role | Email | Password |
| --- | --- | --- |
| Customer | customer@seatflow.example | Root `.env` → `DEMO_PASSWORD` |
| Staff | staff@seatflow.example | Same demo password |
| Admin | admin@seatflow.example | Same demo password |

## 3. Explore the Customer Workflow

With local payment simulation enabled:

1. Sign in as the customer.
2. Open an event and choose **Pick seats**.
3. Select available seats.
4. Choose **Reserve seats**.
5. Check the hold countdown.
6. Choose **Simulate successful payment**.
7. Open the confirmed booking and inspect its QR ticket.

Use the declined-payment action to test a failed payment attempt. You can retry successful settlement while the hold remains eligible.

From **My bookings**, open an eligible confirmed booking and cancel it. Cancellation creates a refund obligation; the worker processes refunds for local simulated payments.

Notifications are persisted in the database and available through `/api/notifications`. A standalone notification inbox is not implemented in the UI.

### External Provider Payments

SSLCOMMERZ and bKash adapters are included but disabled by default. They require merchant credentials and a public HTTPS callback configuration.

Mocked provider tests pass, but merchant sandbox/live end-to-end acceptance remains unverified.

External refunds require merchant-portal processing and remain pending in the application. The local simulator does not complete external refunds.

## 4. Explore Staff and Admin Workflows

### Staff Admission

1. Copy the ticket token from a confirmed customer booking.
2. Sign out and sign in as staff.
3. Open **Operations**.
4. Paste the token and choose **Validate ticket**.
5. Submit it again to verify the already-checked-in response.

Staff must be assigned to the ticket's event. Camera-based QR scanning is not implemented.

### Administration

Sign in as admin and open **Operations** to inspect:

- Booking totals.
- Pending background jobs.
- Recent refunds.
- Staff assignments.
- Event creation.

Demo staff accounts are seeded. Public registration creates customer accounts.

Assign staff to a newly created event before expecting staff admission access. Admins can perform admission without a staff assignment.

## 5. Run Automated Tests

Run the backend suite using a separate test database and Redis instance:

```powershell
docker.exe compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests
docker.exe compose -f docker-compose.test.yml down
```

The suite resets its test database, not the demo database. It includes native PostgreSQL contention tests.

The reviewed backend passed:

| Suite | Passed |
| --- | ---: |
| Unit tests | 3 |
| Payment and security tests | 17 |
| PostgreSQL/Redis integration tests | 15 |
| Total | 35 |

No backend tests failed or were skipped.

Payment provider tests use mocks; they do not replace merchant sandbox acceptance testing.

### Optional Same-Seat Contention Probe

With the local demo seeded:

```powershell
docker.exe compose --profile tools run --rm benchmark
```

Expected result:

- `successfulHolds`: `1`
- `conflicts`: `99`
- `unexpected`: `0`

The probe creates temporary holds and cancels them afterward. It does not delete existing bookings.

This checks contention correctness for one seat. It does not establish large-scale production capacity.

## Troubleshooting

Inspect service status and logs:

```powershell
docker.exe compose ps -a
docker.exe compose logs --tail=100 migrate backend worker
```

| Problem | Suggested action |
| --- | --- |
| Port `3000` is already in use | Stop the other application or frontend development server |
| PostgreSQL password authentication fails | Verify the original database password; changing `.env` does not change the password stored in an existing database |
| CSRF or origin error | Use the URL matching `APP_ORIGIN`, then sign out and sign in again |
| HTTP `429` | Wait approximately one minute before retrying |
| Seat hold conflict | Refresh availability and select another seat |
| Simulated refund remains pending | Inspect worker logs |
| External refund remains pending | Handle it through the merchant portal; automatic external refund execution is not implemented |
| `migrate` exits with code `0` | Expected: migration completed |
| Tests exit with code `0` | Successful test execution |
| `Aborting on container exit` follows passing tests | Expected behavior of `--abort-on-container-exit` |

Do not delete database volumes to resolve a configuration error without first diagnosing the cause.

## Stop and Restart

Stop the application while retaining its named volumes:

```powershell
docker.exe compose down
```

Restart it:

```powershell
docker.exe compose up -d
```

Do not use `docker compose down -v` for normal shutdown. It removes named volumes, including the stored database.

## GitHub Publishing

Suggested repository name:

```text
seatflow-ticket-booking
```

The root `.gitignore` applies to both applications.

Do not commit:

- Actual `.env` files or secret backups.
- `node_modules/`.
- `build/` or `dist/`.
- Logs and generated test reports.

Keep environment templates, package lockfiles, migrations and tests.

Review staged files before committing:

```powershell
git add -A
git status --short
git diff --cached --stat
```

For a first commit:

```powershell
git commit -m "feat: add SeatFlow ticket booking platform with payment adapters and tests"
```