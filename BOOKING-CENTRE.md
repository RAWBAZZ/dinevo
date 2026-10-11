# Dinevo booking centre

## Temporary 2% test-payment flow

After restaurant acceptance, the customer reviews the booking, enters an estimated bill and explicitly accepts **TEST — no money collected**. The database calculates 2% in paise and records it separately as `test_token_paise`; `paid_paise` remains zero and no payment reference is invented. The customer can also continue an unpaid payment-pending booking through this test path. A real paid booking cannot be converted.

Both dashboards and notifications label the result TEST. The restaurant acknowledges the simulated token, confirms the test booking, simulates arrival, marks seated and completes the visit. Future-dated test bookings can simulate arrival immediately; real bookings retain their check-in time restriction. Test reviews are labelled test feedback, not verified real visits.

Test bookings do not reserve real seat capacity, trigger real visit reminders, debit a wallet or create cash refunds. Explicit test consent and ownership are enforced server-side. Retrying the same simulated token is idempotent. The existing real payment verification RPC remains server-only and refuses test bookings.

Use a verified partner account to publish a slot, then a customer account to request it. Restaurant identity/owner setup is still required; this change does not let customers claim restaurant ownership. No production restaurant or account was fabricated for testing.

New integration check: `NODE_PATH=/tmp/dinevo-tests/node_modules node tests/test-token-flow.cjs`. It drives both dashboard DOMs through a Supabase-shaped adapter into disposable PostgreSQL using the actual migrations and row policies. It does not create production records. Physical browser/camera and signed-in live-account QA remain separate checks.

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
2. An approved administrator signs into `admin.html`, lists a restaurant and privately shares its generated claim code with its verified owner. After email sign-in at `dashboard.html`, the owner claims the restaurant with that code. The same account can claim multiple restaurants. OBAMA MAMA is the existing test restaurant. Browser roles cannot directly insert memberships.
3. The owner opens the partner service board → Availability → Publish a time slot. During this temporary testing phase the customer UI uses the explicitly acknowledged 2% test-token route. It exercises the full partner workflow without collecting money or securing a real table.
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

## Restaurant administration and ownership

The restaurant-claims migration was applied on 11 October 2026. The verified project owner's confirmed account was provisioned as administrator through a server-side operation. Admin roles cannot be set through profile metadata or browser writes.

- `admin.html`: create a restaurant with name, city, cuisines and test flag; receive a unique claim code. A blank cuisine list means all cuisines. Creation retries use an idempotency key.
- `dashboard.html`: replaces the legacy dashboard with the secured partner booking centre. After verified email sign-in, claim a restaurant and select among all restaurants the account manages. Existing memberships remain valid.
- Codes expire after seven days and can be claimed by one account. Only their hashes are stored. Administrators can generate a replacement code; this invalidates the previous code but does not remove existing members. Share codes privately after verifying the recipient's ownership.
- A partner publishes availability after claiming; creating a listing alone does not create bookable slots.

Ownership tests use the real migration in PGlite and actual dashboard/admin DOMs, covering multiple memberships, denied non-admin operations, expiry, replay, rate limits, regeneration, idempotency, escaping and database isolation. The ownership, test-token, database and DOM suites pass 83 assertions. These are automated checks, not a signed-in physical-device production test.

```sh
NODE_PATH=/tmp/dinevo-tests/node_modules node tests/restaurant-claims.cjs
NODE_PATH=/tmp/dinevo-tests/node_modules node tests/test-token-flow.cjs
```

The claim-code and rate-limit tables intentionally have RLS with no browser policies and no browser grants: access is through checked RPCs only. This produces the informational [RLS-without-policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). The authenticated RPC and existing leaked-password advisories described above remain.
