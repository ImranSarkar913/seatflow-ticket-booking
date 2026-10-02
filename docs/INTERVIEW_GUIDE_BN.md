# Interview-এ project ব্যাখ্যা

## ৪৫ সেকেন্ডের পরিচয়

“SeatFlow একটি full-stack event ticket booking project। NestJS/TypeScript backend এবং React frontend ব্যবহার করেছি। PostgreSQL transaction ও advisory/row locks দিয়ে seat reservation consistent রাখি। Holds expire হয়, payment events idempotent, আর late payment inventory ফেরত না নিয়ে refund request তৈরি করে। Redis/BullMQ এবং PostgreSQL outbox দিয়ে background processing করি। Staff-এর event-specific permission, QR check-in, audit timeline, Docker ও CI configuration আছে। Payment integration বর্তমানে sandbox।”

AI সহায়তায় তৈরি code বুঝে নিজের ভাষায় explain করবে। Project seniority-এর নিশ্চয়তা নয়; design reasoning, debugging এবং measured evidence তোমার দক্ষতা প্রমাণ করবে।

## প্রশ্ন ও যুক্তি

**একই seat দুইজন চাইলে?** Inventory PostgreSQL-এ। Mutation একই event lock নেয়, এরপর available seat rows lock করে। এক transaction commit হওয়ার পর অন্যটি ownership দেখে 409 পায়। তোমার আগের Docker log-এ native test-এর 100 concurrent requests-এ 1 winner এবং 99 conflicts হয়েছে। Updated version-এ suite আবার চালাবে; এটিকে global throughput benchmark বলবে না।

**Redis lock কেন ব্যবহার করোনি?** Redis queue/rate limit-এর জন্য। Inventory correctness database transaction/constraints-এর মধ্যে রাখি, যাতে queue/cache failure double booking-এর কারণ না হয়।

**Event-level lock throughput কমায় না?** একই event-এ mutation serialize হয়—এটা conscious tradeoff। আলাদা events parallel চলে। Very high-demand event-এর জন্য per-seat ordered locking redesign করতে হবে, tests ও benchmarks দেখে।

**Worker বন্ধ থাকলে expired seat আটকে থাকবে?** Reservation/detail mutation lazy expiration করে; worker শুধু proactive cleanup। Availability API expired hold-কে available দেখায়; final authority hold transaction।

**Hold শেষ, অন্য user seat নিয়েছে, তারপর old payment success এলে?** Old booking confirm হয় না; refund record/outbox তৈরি হয়। নতুন owner-এর seat কখনো ফেরত নেওয়া হয় না।

**একই webhook ১০বার এলে?** Event ID unique; identical fingerprint duplicate-safe। Same ID অন্য payload হলে 409। Amount/currency stored payment intent-এর সঙ্গে মিলতে হয়। Failed event confirmed payment downgrade করে না।

**Queue exactly-once?** না। Delivery at least once; outbox/notification IDs ও refund uniqueness দিয়ে database effects idempotent। Real provider-এ আলাদা idempotency/reconciliation দরকার।

**Cancellation ও payment একসঙ্গে এলে?** একই event lock। Payment আগে হলে cancellation refund চায়; cancellation আগে হলে late payment refund চায়। দুই ordering-এই inventory released এবং refund unique।

**QR replay?** Ticket token random। STAFF assignment verify হয়। First scan admission record লেখে; repeat returns alreadyCheckedIn without duplicate audit। Checked-in ticket cancel করা যায় না।

**কেন ORM নেই?** Hot path-এর SQL transaction/locks/deadline conditional update visible রাখতে parameterized pg ব্যবহার করেছি। ORM ব্যবহার করলেও একই invariants explicitly implement করতে হতো।

**কী এখনো করা হয়নি?** SSLCOMMERZ ও bKash adapters implement করা আছে এবং mocked provider tests pass। Merchant credentials দিয়ে sandbox/live end-to-end acceptance এখনো হয়নি। External refunds manual; outbound email, password reset, camera scanner, external tracing এবং production hosting/load testing হয়নি।

## Interview প্রস্তুতি

1. `booking.ts`-এর hold → payment → cancellation flow নিজে trace করো।
2. Native Docker integration tests চালাও এবং 100-request output রেখে দাও।
3. Worker বন্ধ রেখে hold expire/rebook → late payment scenario demonstrate করো।
4. Duplicate webhook এবং staff unauthorized admission test explain করো।
5. Event-level lock-এর সীমাবদ্ধতা বলো; unmeasured traffic/capacity number দেবে না।

## CV bullets

- Built a full-stack ticket booking application using NestJS, TypeScript, React and PostgreSQL, with expiring seat holds, secure sessions and role-scoped venue admission.
- Implemented transactional inventory updates, idempotent reservation/payment handling, late-payment refund workflows and auditable booking state transitions.
- Added Redis/BullMQ workers with a PostgreSQL outbox, QR tickets, Docker Compose and CI configuration for API, lifecycle and frontend tests.

- Implemented SSLCOMMERZ and bKash checkout adapters with independent settlement verification, callback reconciliation and mocked provider regression tests; merchant end-to-end validation pending.

CV-তে প্রথম তিনটি bullet যথেষ্ট। Provider-focused role হলে তৃতীয় bullet-এর বদলে চতুর্থটি ব্যবহার করতে পারো। Latest revision-এর native suite pass হওয়ার পরে interview-এ factual result বলো: “Verified single-seat contention with 100 concurrent requests: one successful hold and 99 conflicts.” “Senior-level production platform” বা real users/revenue দাবি করবে না।
