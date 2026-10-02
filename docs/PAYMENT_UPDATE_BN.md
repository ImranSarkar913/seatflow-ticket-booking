# Complete SeatFlow — payment setup

এই complete project-এ payment update আগে থেকেই merge করা আছে। apply-update.cjs বা patch installer চালাবে না। প্রথমে root START_HERE_BN.md অনুসরণ করো। নিজের provider credentials ছাড়া buttons disabled থাকবে; আগের simulation চলবে।

## SSLCOMMERZ sandbox

নিজের sandbox store account/credentials নাও: https://developer.sslcommerz.com/registration/

Root `.env`-এ:

```dotenv
PAYMENT_ENVIRONMENT=sandbox
SSLCOMMERZ_ENABLED=true
SSLCOMMERZ_STORE_ID=your_sandbox_store_id
SSLCOMMERZ_STORE_PASSWORD='your_sandbox_store_password'
```

Placeholder দিয়ে provider enable করলে checkout কাজ করবে না। Real secret শুধু local `.env`-এ রাখবে। SSLCOMMERZ hosted page-এ তোমার store account-এর enabled card/mobile-banking/banking methods দেখাবে; কোনো specific payment channel enabled আছে বলে এই project ধরে নেয় না।

## Direct bKash sandbox

bKash merchant onboarding/support থেকে **tokenized checkout v1.2.0-beta** sandbox credentials ও approved API contract নাও। Provider onboarding অন্য version দিলে আগে adapter contract মিলিয়ে নিতে হবে। Official developer pages build-এর সময় accessible ছিল না; official sandbox demo-এর checkout request shape এবং versioned integration contract অনুসারে adapter লেখা, merchant-credential validation এখনও হয়নি।

```dotenv
PAYMENT_ENVIRONMENT=sandbox
BKASH_ENABLED=true
BKASH_USERNAME=your_sandbox_username
BKASH_PASSWORD='your_sandbox_password'
BKASH_APP_KEY=your_sandbox_app_key
BKASH_APP_SECRET='your_sandbox_app_secret'
```

Wallet number, OTP ও PIN provider page-এ দেবে। SeatFlow কোনো PIN, OTP বা card details নেয় না। Provider যে test wallet/OTP/PIN দেয় সেটাই ব্যবহার করবে।

## Public callback URL লাগবে

Provider-এর server তোমার `localhost`-এ IPN পাঠাতে পারে না। Approved HTTPS development tunnel বা hosted frontend দরকার, যা localhost:3000-এ forward করবে। Tunnel provider setup/account এই ZIP-এ অন্তর্ভুক্ত নয়। তোমার public HTTPS origin পাওয়ার পর:

```dotenv
# উদাহরণ, নিজের tunnel URL বসাবে; path বা trailing slash দেবে না
PAYMENT_CALLBACK_ORIGIN=https://your-assigned-tunnel.example
# Browser-এ localhost দিয়ে app খুললে এটা localhost-ই রাখবে
APP_ORIGIN=http://localhost:3000
```

Public tunnel দিয়ে login করলে APP_ORIGIN-ও সেই exact HTTPS origin করতে হবে। Callback সবসময় configured APP_ORIGIN-এ ফিরিয়ে দেয়। Tunnel endpoint public করলে demo passwords শক্ত রাখবে; এটা demo-only setup। Provider portal-এ origin/callback whitelist প্রয়োজন হলে সেটাও configure করো।

Settings বদলানোর পর:

```bash
docker.exe compose up -d --force-recreate backend worker
```

Browser → new reservation → mobile number → Pay via SSLCOMMERZ / Pay with bKash। One reservation একবার checkout শুরু হলে অন্য payment method-এ switch করা যায় না। Unknown/pending payment থাকলে আবার payment দেবে না; Refresh provider payment status বা My bookings দেখবে।

## টাকা কাটা কিন্তু hold expire হলে

Late verified success পুরোনো seat অন্য customer-এর কাছ থেকে ফেরত নেয় না। Refund request তৈরি হয়। **External refund automatically পাঠানো হয় না**। Merchant provider portal থেকে refund করে settlement reconcile করবে; app-এ refund pending-ই থাকে এবং worker/admin error এটির কথা বলে। App-এ manual completion button রাখা হয়নি, যাতে শুধুমাত্র click দিয়ে টাকা ফেরতের ভুয়া দাবি না হয়। External refunds ও exception cases operationally resolve করার ব্যবস্থা ছাড়া live launch করবে না।

## Tests

```bash
docker.exe compose -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests
docker.exe compose -f docker-compose.test.yml down
```

Suite-এ নতুন mock-provider payment tests-ও চলে। এটি provider sandbox validation-এর বিকল্প নয়। Reviewed version-এর test evidence ও remaining checks: [VALIDATION.md](VALIDATION.md)। Merchant credentials দিয়ে callback/checkout E2E এখনো verify হয়নি।

## Live mode

Live account approval, credentials, approved HTTPS deployment, real refund operations ও provider sandbox acceptance শেষ না করে live enable করবে না। Config live-এর জন্য requires:

```dotenv
PAYMENT_ENVIRONMENT=live
ENABLE_SANDBOX=false
COOKIE_SECURE=true
APP_ORIGIN=https://your-real-domain.example
PAYMENT_CALLBACK_ORIGIN=https://your-real-domain.example
```

এটি live readiness certificate নয়। No real money was moved during development.
