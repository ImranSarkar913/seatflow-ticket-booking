# SeatFlow চালানোর বাংলা গাইড

## আগে যা লাগবে

Docker Desktop চালু রাখবে। Host PC-তে Node থাকলে `setup-env.cjs` ব্যবহার করা যায়; Docker নিজে Node 24 image চালাবে। Project root হলো যে folder-এ `docker-compose.yml`, `backend`, `frontend`, `docs` আছে। ZIP extract করার পরে বাইরের folder নয়, এই root-এ terminal খুলবে।

আগের Incident Dashboard port 3000 ব্যবহার করলে **আগের project-এর root-এ** `docker.exe compose down` চালাও। ওই database volume delete করবে না। দুই project-এর Compose name আলাদা, কিন্তু browser port একই।

## ১. Configuration

PowerShell:

```powershell
node scripts/setup-env.cjs
notepad .env
```

Script নিজে random local password/secrets তৈরি করবে। `.env` আগে থাকলে overwrite করবে না। `DEMO_PASSWORD` login-এর জন্য দরকার; নিজের PC-তে দেখে রাখবে। File কাউকে পাঠাবে না।

Node না থাকলে:

```powershell
Copy-Item .env.example .env
notepad .env
```

`POSTGRES_PASSWORD`, `DEMO_PASSWORD` বদলাবে; `DEMO_PASSWORD` ১২–১২৮ character। `WEBHOOK_SECRET` অন্তত ৩২ character। সহজভাবে letters/numbers/hyphen ব্যবহার করো। Special `#`/`$` ব্যবহার করলে dotenv value single quotes দিয়ে লিখবে। এই project-এ আলাদা PG environment fields ব্যবহার করেছি; database password URL encode করতে হবে না।

`APP_ORIGIN=http://localhost:3000` থাকলে browser-এ ঠিক `localhost` ব্যবহার করবে, `127.0.0.1` নয়।

## ২. Stack চালাও

```powershell
docker.exe compose up --build -d
docker.exe compose --profile tools run --rm seed
docker.exe compose ps -a
```

`migrate` → Exited (0) স্বাভাবিক। Backend/PostgreSQL/Redis healthy হওয়া উচিত। Seed একবার চলবে; আগের users থাকলে পুনরায় seed না চালিয়ে login করবে।

Browser: **http://localhost:3000**

Customer: `customer@seatflow.example`
Staff: `staff@seatflow.example`
Admin: `admin@seatflow.example`
Password: root `.env`-এর `DEMO_PASSWORD`।

## ৩. Customer flow দেখো

Customer দিয়ে login → Pick seats → available seat select → Reserve seats → countdown → Simulate successful payment → QR ticket।

Declined payment button দিয়ে failure পরীক্ষা করো। Hold শেষ হওয়ার আগে successful payment retry করতে পারো। My bookings থেকে booking খুলে cancellation করলে refund request তৈরি হবে; worker পরে sandbox refund complete করবে। Notification delivery database-এ থাকে; API `/notifications` আছে। UI-তে standalone notification inbox নেই।

## ৪. Staff/admin flow

Ticket-এর Copy ticket token দিয়ে token নাও। Customer logout করে staff login → Operations → token paste → Validate ticket। আবার দিলে already checked in দেখাবে। Camera scanning implement করা হয়নি।

Admin login → Operations: booking totals, pending jobs, recent refunds, staff assignment এবং new event creation। STAFF account seeded আছে; register করলে CUSTOMER হবে। নতুন event-এ staff assign না করলে শুধু admin admission করতে পারবে।

## ৫. Tests

Demo থেকে আলাদা database/container:

```powershell
docker.exe compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests
docker.exe compose -f docker-compose.test.yml down
```

এই suite test database reset করে, demo database করে না। Native PostgreSQL-তে two contention tests-ও চলে।

একই seat-এর জন্য ১০০ request benchmark:

```powershell
docker.exe compose --profile tools run --rm benchmark
```

Expected: successfulHolds 1, conflicts 99, unexpected 0। Script demo-তে temporary hold বানিয়ে শেষে cancel করে; পুরোনো booking delete করে না। এটি correctness contention test, লাখ user capacity-এর প্রমাণ নয়।

## Troubleshooting

```powershell
docker.exe compose logs --tail=100 migrate backend worker
docker.exe compose ps -a
```

- Port 3000 busy: আগের project বা frontend dev server বন্ধ করো।
- Password authentication failed: existing PostgreSQL volume-এ আগের password রয়ে গেছে। শুধু `.env` password বদলালে DB password বদলায় না। Logs দিয়ে diagnose করো; volume delete করো না।
- CSRF/origin error: configured `APP_ORIGIN` অনুযায়ী URL খোলো, logout/login করো।
- 429: rate limit; এক মিনিট পরে retry।
- Hold conflict: seat অন্য user reserve করেছে। Seat map refresh/অন্য seat বেছে নাও।
- Refund pending: worker logs দেখো। Payment/refund পুরোটা sandbox; bank transfer হয় না।

## বন্ধ এবং আবার চালানো

```powershell
docker.exe compose down
docker.exe compose up -d
```

`down` database রাখে। `down -v` database delete করে—স্বাভাবিক shutdown-এ ব্যবহার করবে না।

## GitHub

নতুন repo name: `seatflow-ticket-booking`। `.env`, `node_modules`, `build`, `dist` push করবে না। Root `.gitignore` দুই app-এ প্রযোজ্য। `.env.example`, lockfiles, migrations এবং tests রাখবে।

Suggested commit: `feat: build transactional ticket booking with expiring holds and sandbox payments`
