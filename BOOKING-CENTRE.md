# Dinevo booking centre

A live, Supabase-backed booking flow at `booking-centre.html`; partner service board at `booking-centre.html?partner=1`. Existing black/gold styling is retained. Home and partner dashboard link to the new flow. Legacy requests and the explicitly labelled wallet demo remain separate; legacy data is not silently treated as verified reservations/payments.

## Features, in priority order

1. Customer and authorised restaurant staff share a persisted event timeline.
2. Booking UUID and locally generated QR; staff verify the guest code to check in. Camera scanning uses BarcodeDetector where supported; a paste-code fallback is always available. Codes rotate at arrival; replays fail.
3. Five fixed customer cancellation reasons, immutable cancellation cutoff/discount/token snapshots, and refund states. Eligible paid cancellations request a refund; only provider verification marks it refunded.
4. Scheduled 24-hour/2-hour in-app reminders, plus customer running-late updates. Alerts deduplicate. No email/SMS/push delivery is claimed. New bookings made within two hours receive both reminder categories.
5. Partner-published slots, capacity checks under a row lock, expiring holds, waitlist join/leave and one-time in-app availability alerts. Alerts do not reserve seats.
6. One review per completed visit; no review before service completion. Reviews are currently visible to the guest and restaurant, not publicly syndicated.
7. Partner service board: Upcoming, Arrived, Seated, Completed, Cancelled. Upcoming includes requests, offers, payment pending and confirmed bookings.
8. Occasion, seating, dietary needs and high-chair requests with restaurant acknowledgement.

Customer request holds last up to 30 minutes. A partner acceptance starts a five-minute customer confirmation hold. No-token bookings confirm when the customer accepts the terms. Paid-token bookings require verified payment then restaurant acknowledgement. Confirmation is animated and includes date/time. Date entry and display use IST. Unpaid expired holds release capacity.

## Applied database setup

On 10 October 2026 both migrations were applied to project `nvvmkuyimymigcazjobv`. The `dinevo-booking-updates` pg_cron job runs every minute. Do not reapply the initial migration manually. The SQL files are the versioned source for a fresh environment.

All new tables have RLS. Browser roles can read only authorised records and cannot directly mutate bookings, membership, tokens or refunds. RPCs use a fixed empty search path and explicit authorisation. Restaurant access comes from `d2_members`, never a UI dropdown or editable user metadata.

## Required activation

1. Merge the review PR and deploy the existing Vercel project normally.
2. Verify each restaurant owner's identity and registered account. An administrator creates the real restaurant in `d2_restaurants` and its verified account mapping in `d2_members`. No sample restaurant or guessed owner has been added. Use the Supabase Auth user UUID, not an email as a UUID. Do not grant customers self-service membership insertion.
3. The owner opens the partner service board → Availability → Publish a time slot. The UI currently publishes no-token slots, which can complete the full live reservation flow without collecting money.
4. Before enabling paid slots, connect a payment provider through a server-side adapter. Verify webhook signatures, captured status, currency INR, the booking binding, exact amount, unique provider reference and idempotency. Only then call `d2_verify_payment` with a service credential. Late/mismatched payments are rejected and must be reconciled/refunded through the provider. Process refund requests with the provider and call `d2_verify_refund` only after verified success. Never expose service credentials in these static pages.

No wallet funds are issued or debited by this module. The existing ₹100 wallet preview remains a labelled simulation. Backend refund state does not transfer money.

## Existing legacy access

The older `requests`, `offers`, `restaurant_status`, and `restaurant_profiles` policies were not changed by these additive migrations. Inspection found broad authenticated policies and self-claimable legacy restaurant profiles. Before production rollout of the older dashboard, migrate verified ownership and replace those permissive policies. The new centre uses only its isolated `d2_*` tables, but that does not secure legacy data retroactively.

## Verification

Install development test dependencies outside the static web root:

```sh
npm install --prefix /tmp/dinevo-tests @electric-sql/pglite jsdom
NODE_PATH=/tmp/dinevo-tests/node_modules node tests/booking-centre-db.cjs
NODE_PATH=/tmp/dinevo-tests/node_modules node tests/booking-centre-ui.cjs
node --check booking-centre.js
```

The database test runs the actual migration in disposable PostgreSQL (PGlite) and exercises customer/partner isolation, capacity, direct-write and payment ACLs, transitions, check-in replay, review gating, payment/refund idempotency, hold expiry, reminders and waitlist alerts. DOM tests exercise form closure, escaped restaurant names, preference submission, QR rendering hook and cancellation choices.

QR rendering uses bundled `qrcode` under its MIT license in `vendor/qrcode.LICENSE`. No booking code is sent to a third-party QR service. Supabase JS is loaded consistently with the existing application.

This version reads up to 300 bookings/notices and 1,500 events per account on refresh. Add pagination before high-volume use. Refresh is every 15 seconds while visible. Production payment-provider tests, physical camera tests and full multi-device browser QA remain activation checks; DOM tests do not substitute for those.

## Supabase advisor review

The security advisor reports the intentionally exposed authenticated SECURITY DEFINER RPCs. These implement the booking state machine while denying direct table writes; their explicit ownership checks, fixed search paths and restricted grants were tested. Payment/refund/scheduler RPCs are not executable by browser roles. See [Supabase RPC advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

The project also has [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). This existing Auth setting was not changed.
