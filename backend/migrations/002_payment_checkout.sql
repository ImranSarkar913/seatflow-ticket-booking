-- Additive migration: never changes existing reservations or credentials.
CREATE TABLE payment_checkouts (
 payment_id uuid PRIMARY KEY REFERENCES payments(id),
 provider text NOT NULL CHECK(provider IN ('sslcommerz','bkash')),
 invoice text UNIQUE NOT NULL,
 state text NOT NULL DEFAULT 'INITIATING' CHECK(state IN ('INITIATING','READY','UNKNOWN','SETTLED')),
 provider_payment_id text,
 checkout_url text,
 settlement_reference text,
 verified_at timestamptz,
 last_checked_at timestamptz,
 last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,provider_payment_id)
);
CREATE INDEX checkout_reconciliation ON payment_checkouts(last_checked_at) WHERE state<>'SETTLED';
