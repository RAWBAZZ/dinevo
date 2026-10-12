# Multi-restaurant quote requests

Customers complete the homepage preferences, select up to ten restaurants and send one quote request. The atomic RPC creates one private request per selected active listing. Retries reuse an idempotency key; changed payloads under the same key are rejected. Requests expire after 24 hours or at the dining time, whichever is earlier.

Quotes do not require published availability. They are explicitly TEST bookings with no real table reservation or payment. Existing published-slot booking flows are unchanged. Historical bookings retain their non-null slot IDs; slotless requests must satisfy a database constraint requiring a quote batch and test status.

Claimed restaurant partners see requests in Upcoming and can send an offer with a discount, minimum bill and exclusions. Offers last five minutes. The customer's Requests and Offers tabs show these records; accepting continues through the existing acknowledged 2% test-token and partner-confirmation workflow. Unclaimed restaurants retain queued requests for their future claimed partner, but no external email, SMS or push is sent.

Contact restaurant / Message customer opens a private in-app conversation per request. Reopen to refresh it. Messages are capped at 1,000 characters with server-side rate limiting, idempotent retries and RLS. Only the requesting customer and current restaurant members can read or send. Closed bookings have read-only conversations. Each message produces an in-app notification to the other participant(s).

The request selection bar disappears after successful submission and the customer opens Requests. Homepage Requests, Offers and Bookings navigation now uses the secured booking centre, not legacy offers tables. The black/gold styling and separate customer/partner/admin sessions remain.

## Verification

The actual migrations and partner DOM were tested in disposable PostgreSQL (PGlite). Nineteen assertions cover multi-delivery, no artificial slots, retries, access isolation, partner offers, message isolation, queued claims, inactive listings and the test-token continuation. Ten additional customer-selection assertions cover selecting two cards, payload and budget, and clearing the send bar. Existing 26 token-flow and 10 booking UI assertions passed, along with portal separation tests. No real customer requests were submitted during verification.

The migration was applied to the connected Supabase project on 12 October 2026. Readback verified the new RPCs, no anonymous quote execution, no direct browser message inserts and message RLS enabled.

The security advisor reports the intentionally authenticated RPCs: explicit auth checks, fixed search paths and restricted grants were tested. See [RPC advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Existing claim tables intentionally have no browser policies/grants; [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remains an existing project setting to address separately.

Run tests with pinned development dependencies installed outside the static site:

```sh
NODE_PATH=/tmp/dinevo-quotes/node_modules node tests/multi-quotes.cjs
NODE_PATH=/tmp/dinevo-quotes/node_modules node tests/quote-selection.cjs
NODE_PATH=/tmp/dinevo-quotes/node_modules node tests/test-token-flow.cjs
NODE_PATH=/tmp/dinevo-quotes/node_modules node tests/booking-centre-ui.cjs
NODE_PATH=/tmp/dinevo-quotes/node_modules node tests/portal-separation.cjs
```
