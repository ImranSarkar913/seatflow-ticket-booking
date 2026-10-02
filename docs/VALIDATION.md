# Final review and verification — 2026-10-02

This report separates current checks from evidence on the previous delivered version. It is a portfolio readiness review, not production certification.

## Current reviewed source

- Backend TypeScript compilation passed.
- 3 cryptography unit tests and 17 payment/security tests passed, zero failed/skipped. Provider HTTP calls and the rate-limiter test use mocks; these are not merchant acceptance tests.
- Frontend TypeScript compilation and production build passed; 7 Vitest tests passed.
- npm audit found 0 reported vulnerabilities in backend production dependencies and in the full frontend dependency tree at review time. This does not prove the application has no vulnerabilities.
- Original migration 001 remains unchanged; migration 002 is unchanged by this review. No data reset is required.

## Native evidence supplied by the user, before these review fixes

The Windows Docker log shows PostgreSQL 18 and Redis 7.4, migrations 001/002 applied, 3 unit + 14 payment + 15 native integration tests passed (32 backend tests, zero failed/skipped).

The native same-seat probe reported 100 simultaneous service reservation attempts, one successful hold and 99 conflicts, pool size 20. The recorded 873 ms is one run of one-event contention correctness, not general HTTP throughput or a capacity promise.

The reviewed version adds three backend regression tests and one frontend amount-formatting test. Rerun the Docker suite on this revision (expected backend total: 35) or let GitHub Actions run it. Native PostgreSQL/Redis and Docker are unavailable in the current review environment, so that rerun is pending.

## Fixes included

1. A provider checkout response arriving after concurrent settlement could regress SETTLED to READY; an initiation timeout could regress it to UNKNOWN. Conditional database updates now preserve settled state. Two regression tests cover both orderings.
2. Frontend currency formatting rounded fractional BDT amounts to whole taka. Amounts now display two decimal places; a regression test checks exact paisa formatting.
3. Rate limiter Redis keys contained raw session cookies, and rotating arbitrary cookies could evade the per-cookie limit. Session keys now use SHA-256 and API requests also have a shared source-IP cap. An HTTP regression test verifies credential masking and IP enforcement.
4. Updated stale documentation about provider adapters and test evidence. The full ZIP needs no patch installer.

## Limits to explain accurately

- SSLCOMMERZ/bKash adapters are disabled by default. Merchant credentials, public HTTPS callbacks and provider sandbox/live end-to-end acceptance have not been tested.
- External refunds remain pending until handled through the merchant portal. They are never falsely marked refunded by the local simulator.
- Behind the provided Nginx proxy, the source-IP cap can be shared by clients because forwarded headers are not blindly trusted. This local demo configuration needs deliberate trusted-proxy and distributed rate-limit design before public hosting.
- Per-event inventory locking serializes mutations for one event. It prioritizes correctness; high-demand throughput remains unmeasured.
- Notifications are in-app; email/SMS, password reset, camera scanning, production hosting, backups and external monitoring are outside the implemented demo.
- Latest Docker/frontend browser smoke test and GitHub Actions execution are pending. Earlier browser screenshots show the local simulation, not provider payment proof.

## Run this revision

```bash
docker.exe compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests
docker.exe compose -f docker-compose.test.yml down
```

Then open http://localhost:3000 and verify customer hold/payment/QR, staff admission, admin view and expiry/cancellation on demo data. Use the merchant sandbox checklist in PAYMENT_UPDATE_BN.md before enabling providers.
