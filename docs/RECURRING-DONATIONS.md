# Recurring donations — architecture & security plan

**Goal:** let a donor pledge ₹500/month (or any approved amount) once, and have it
debited automatically from their own UPI account every month, without ever
collecting or storing card/UPI credentials, and in full compliance with RBI's
e-mandate (AutoPay) framework.

Rail: **Razorpay Subscriptions / auto-debit** (primary; the merchant is onboarded
on Razorpay), with **PhonePe UPI AutoPay** retained as an optional fallback for
deployments that only have PhonePe credentials. One-time donations can use either
PhonePe or Razorpay; the donor picks on the donation page.

---

## 1. The donor journey (what a person actually experiences)

| # | Step | Screen / event |
|---|------|----------------|
| 1 | Lands on `/pledge`, sees ₹500 / ₹1,000 / ₹2,500 tiers + custom | plan cards, live monthly↔yearly total |
| 2 | Enters name, email, mobile, **UPI ID**, optional PAN for 80G | one short form |
| 3 | Reads the RBI disclosure and ticks consent | "I authorise Satyalok to debit ₹500 every month…" |
| 4 | Taps **Continue to UPI mandate** | server creates the mandate, moves to `/pledge/status` |
| 5 | Approves the mandate **with their bank** (UPI PIN or card OTP = AFA) | ₹500 is collected immediately as month 1 |
| 6 | Sees "Your monthly pledge is active" + receipt email | `/pledge/status` polls and flips automatically |
| 7 | 24h before every later debit: pre-debit notice | Razorpay `customer_notify` (or PhonePe `notify` fallback) |
| 8 | Monthly debit happens, receipt + 80G certificate mailed | webhook → settlement |
| 9 | Any time: `/pledge/manage/<signed token>` → skip, pause, resume, cancel | magic link, no password |

The money never touches Satyalok's servers. Satyalok only ever sees a masked
handle (`do****@okhdfcbank`) plus the gateway's transaction id.

---

## 2. Sequence — first pledge

```
Donor          React (/pledge)        API (Express)              PhonePe AutoPay     UPI app / bank
  |                  |                      |                         |                  |
  |-- pick Rs500 --->|                      |                         |                  |
  |-- form+consent ->|-- POST /pledge ----->|                         |                  |
  |                  |  Idempotency-Key     |-- validate vs plans     |                  |
  |                  |                      |-- Pledge(PENDING_AUTH)                     |
  |                  |                      |-- POST /subscriptions/v2/setup --------->  |
  |                  |<-- {pledgeRef,nextAction} <---- orderId ------------------------  |
  |                  |   (UPI_COLLECT: donor approves in app, no redirect needed)        |
  |------------------- approve mandate in UPI app (UPI PIN) --------------------------->|
  |                  |                      |<-- webhook setup.completed -------------|  |
  |                  |                      |-- verify sha256(user:pass)                 |
  |                  |                      |-- confirm via /subscriptions/v2/{id}/status|
  |                  |                      |-- ACTIVE + cycle 1 debit -> SUCCESS        |
  |                  |                      |-- Donation row + receipt email             |
  |<-- poll /pledge/:ref/status ------------>|                                           |
  |<-- "active" + receipt email --------------------------------------------------------|
```

## 3. Sequence — every later month (Razorpay)

```
checkout handler : donor authorises mandate (UPI AutoPay / card)
Razorpay         : subscription.activated webhook -> ACTIVE
each month       : Razorpay charges the mandate itself (customer_notify = 1,
                   so the RBI 24h pre-debit notice is sent by Razorpay)
                 : subscription.charged webhook -> PledgeDebit(SUCCESS)
                 : receipt email + 80G certificate
failure          : subscription.pending -> Razorpay retries
retries exhausted: subscription.halted -> PAST_DUE
```

Our cron workers only drive PhonePe Autopay pledges; Razorpay pledges are
filtered out of `planAndNotify` (the gateway owns the schedule). The shared debit
ledger, receipts, portal and admin console are identical for both providers.

### Fallback rail — every later month (PhonePe Autopay)

```
cron 01:05 IST : planAndNotify
   find ACTIVE pledges whose nextDebitAt - 26h <= now
   create exactly one PledgeDebit (cycle = cyclesCompleted+1, attempt 1)
   POST /subscriptions/v2/notify        (RBI pre-debit notice)
   email "Rs500 will be debited on <date>" + skip/cancel links

cron 01:40 IST : executeRedemptions
   find NOTIFIED debits where notifiedAt + 24h <= now
   atomic claim (NOTIFIED -> REDEEMING, lock owner)
   POST /subscriptions/v2/redeem
   GET  /subscriptions/v2/order/{orderId}/status      <- authoritative
   SUCCESS -> Donation + receipt + nextDebitAt += 1 month
   FAILED  -> retry ladder (D+1, D+3, D+7) then PAST_DUE

every 10 min : reconcileInFlight
   anything stuck in REDEEMING/UNKNOWN/NOTIFYING for >5 min
   -> ask the gateway, settle accordingly (never blind-retry)
```

---

## 4. Data model

| Collection | Purpose | Key safety property |
|---|---|---|
| `Pledge` | the mandate + donor snapshot + consent | `merchantSubscriptionId` unique, `idempotencyKey` unique |
| `PledgeDebit` | one row per billing **attempt** | `merchantOrderId` unique **and deterministic**, plus unique `(pledgeId, cycleNumber, attempt)` |
| `PaymentEvent` | every inbound webhook | `eventId` unique → exactly-once processing |
| `Donation` | existing collection, one row per successful debit | reuses `merchantTransactionId` unique |
| `Donor` | identity, rollups, blocklist | `donorKey = HMAC(email)` |

**Why one `Donation` row per debit?** The existing admin dashboard, 80G
certificate generator and receipt template keep working untouched. An auditor
reads `donations` without knowing what a mandate is.

Deterministic order ids are the anti-double-charge primitive:

```
SLD-<pledgeSuffix>-c0003-a02      cycle 3, attempt 2
```

A timeout → we resend the *same* id, and both our unique index and the gateway
de-duplicate. A genuine new attempt increments `a`, so it cannot collide.

---

## 5. Security model

### Money safety
1. **The client never sends an amount that is used.** It sends `planId` (or a
   custom amount validated server-side against `RECURRING_RULES`).
2. **Hard AFA ceiling.** Amounts above ₹15,000 per debit would need bank
   authentication every month, so they are rejected at validation rather than
   failing silently forever.
3. **Idempotency everywhere** — `Idempotency-Key` on create, unique indexes on
   subscription/order ids, `eventId` on webhooks.
4. **Never trust the callback for money.** A webhook only triggers settlement; the
   settlement itself re-reads `/order/{id}/status` from the gateway.
5. **Atomic claim before every debit** (`findOneAndUpdate` on status + lock TTL),
   so overlapping cron ticks or two API instances cannot both charge.
6. **Ambiguous outcome = stop.** Network timeout/5xx marks the debit `UNKNOWN` and
   parks it for reconciliation instead of retrying into a possible double debit.

### Data protection
- No card numbers, no UPI PIN, no bank credentials, ever.
- **PAN encrypted at rest** with AES-256-GCM (`v1:iv:tag:ciphertext`); only a
  masked value (`XXXXXX234F`) is stored in the legacy plaintext column, and the
  real PAN is decrypted in memory only to render an 80G certificate.
- Donor lookup uses `HMAC(email)` with a server pepper — no searchable plaintext
  index on identity.
- Responses only expose masked instrument data and a first name.
- Webhook signature compared with `crypto.timingSafeEqual`.
- Donor portal tokens are HMAC-signed, expiring (72h), scoped and single-purpose —
  no password database to leak.
- Rate limits: 8 pledge creations / 10 min / IP, 5 recovery emails / hour / IP.

### Abuse & failure
- Max 3 live pledges per donor key.
- Donor blocklist (`Donor.isBlocked`) checked before any mandate is created.
- Stale `PENDING_AUTH` mandates auto-expire after 48h so they don't eat the limit.
- Every admin mutation records who acted (`cancelledBy: admin:<email>`); nothing is
  hard-deleted, because mandates are financial records.

---

## 6. RBI e-mandate compliance map (framework 2026)

| Requirement | How it is met |
|---|---|
| AFA at registration | mandate approved in the UPI app with the UPI PIN; the first debit is the authorisation transaction (`authWorkflowType: TRANSACTION`) |
| Explicit validity period | `expiresAt` = start + `PLEDGE_VALIDITY_YEARS` (default 5), sent as `paymentFlow.expireAt` |
| Fixed amount / capped variable | `amountType: FIXED`, `maxAmount` = pledged amount in paise |
| Pre-debit notice ≥ 24h | `notify` API **and** our own email; the redeemer enforces `notifiedAt + 24h` in code (`redemptionValidAfter`) |
| Post-debit notification | receipt email with merchant, amount, date, reference, grievance contact |
| Modify / withdraw at will | `/pledge/manage/<token>`: skip, pause, resume, cancel — one click, no retention flow |
| No customer charges | Satyalok absorbs gateway fees; nothing is billed to the donor |
| Dispute handling | grievance email in every mail + `PaymentEvent` audit trail per callback |
| Opt out of a specific debit | "Skip this month" before the debit runs |

Developer-facing evidence lives in code, not just docs: `RECURRING_RULES`,
`notifyDebit`, `executeRedemptions`, `redemptionValidAfter`, and the `consent`
sub-document (version + timestamp + IP + user agent + exact wording shown).


---

## 7. API surface

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/pledge/plans` | public | capability (`available`, `comingSoon`, `provider`, `requiresVpa`), tiers, limits, consent |
| GET | `/payment/providers` | public | which one-time rails are configured (PhonePe / Razorpay) |
| POST | `/payment/razorpay/order` | public, rate-limited | create a Razorpay order for a one-time donation |
| POST | `/payment/razorpay/verify` | public, rate-limited | verify checkout HMAC, capture, book donation + receipt |
| POST | `/pledge` | public + `Idempotency-Key` | create mandate (503 `RECURRING_COMING_SOON` while gated off) |
| GET | `/pledge/:pledgeRef/status` | public, rate-limited | polls + reconciles with gateway |
| GET | `/pledge/manage/:token` | signed token | portal data |
| POST | `/pledge/manage/:token/{pause,resume,skip,cancel}` | signed token | donor self-service |
| POST | `/pledge/recover` | public, 5/hour | email a fresh manage link |
| POST | `/webhook/phonepe/autopay` | sha256(user:pass) | ack fast, persist, process async |
| POST | `/webhook/razorpay` | HMAC of raw body | subscription lifecycle + one-time payment events |
| GET | `/admin/pledges` | admin cookie | list/search/filter |
| GET | `/admin/pledges/:id` | admin cookie | pledge + debit ledger |
| POST | `/admin/pledges/:id/cancel` | admin cookie | audited cancellation |
| POST | `/admin/pledges/:id/retry` | admin cookie | one more attempt (notice first) |
| POST | `/admin/pledges/sync-setup` | admin cookie | settle a mandate whose webhook was lost |

**Admin console.** `/admin/dashboard/pledges` lists pledges with status counts,
monthly committed rupees, search and filters. Opening a pledge shows the donor,
mandate, consent record and debit ledger, with three audited actions: **sync
with gateway**, **retry debit** (only when the latest attempt failed or is
unknown) and **cancel pledge** (reason recorded). There is no delete action.

**Coming-soon mode.** The programme is only live when
`PHONEPE_AUTOPAY_ENABLED=true` *and* OAuth credentials exist. Otherwise
`GET /pledge/plans` returns `available: false`, `comingSoon: true`,
`plans: []` and `previewPlans` (the static tiers), the Pledge page shows the
"coming soon" screen instead of a form, the donate page shows a monthly-giving
note, and `POST /pledge` returns 503 `RECURRING_COMING_SOON`. The one-time
donation flow is untouched. This lets the UI ship before the merchant approval
lands.

---

## 8. State machines

**Pledge**

```
PENDING_AUTH --approved--> ACTIVE --pause--> PAUSED --resume--> ACTIVE
      |                      |  \--retries exhausted--> PAST_DUE --success--> ACTIVE
      |                      \--cancel/revoke--> CANCELLED
      \--failed/expired--> AUTH_FAILED        schedule ends --> COMPLETED
```

**Debit**

```
SCHEDULED --notify--> NOTIFYING --ok--> NOTIFIED --24h--> REDEEMING --ok---> SUCCESS
                                                               \--fail--> FAILED --retry--> new attempt
                             \--timeout--> UNKNOWN --reconcile--> SUCCESS | FAILED
    \--donor skips--> SKIPPED
```

---

## 9. Failure playbook

| Situation | Behaviour |
|---|---|
| Webhook lost | `/pledge/:ref/status` reconciles; `reconcileInFlight` sweep; admin `sync-setup` |
| Duplicate webhook | `eventId` unique → second is a no-op |
| Debit call times out | `UNKNOWN`, no retry; reconciliation asks the gateway |
| Bank declines | retry D+1, D+3, D+7 with a fresh 24h notice; then PAST_DUE + email |
| Gateway cancel fails | local state still `CANCELLED` (we drive every debit, so nothing can charge) and `providerCancelPending` is retried by cron |
| SMTP down | receipt fails fast (10s timeouts) and is logged; the payment is **not** rolled back |
| Donor revokes in their app | issuer `revoked/paused` webhook mirrored onto the pledge |

---

## 10. Go-live checklist

1. In Razorpay: download the API key pair and set the webhook to
   `https://<api-host>/webhook/razorpay` with a secret. Enable the events listed in
   `DEPLOY-RECURRING.md`.
2. Put `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and
   `RAZORPAY_ENABLED=true` on the server. Plans are created automatically the
   first time each monthly amount is used.
3. Optional fallback: request **UPI AutoPay** on PhonePe, then set
   `PHONEPE_AUTOPAY_*` (OAuth2, not `SALT_KEY`) and its webhook credentials.
4. `openssl rand -base64 48` → `PLEDGE_ENCRYPTION_KEY`, `PLEDGE_HASH_PEPPER`,
   `PLEDGE_PORTAL_SECRET` (three different values).
5. The `/terms` and `/privacy` pages ship in the frontend; have them reviewed by
   whoever owns programme compliance, and bump `PLEDGE_CONSENT_VERSION` if the
   consent wording changes.
6. Sandbox tests: happy path, declined debit, revoke from the app, cancel while a
   debit is in flight, webhook replay.
7. First production pledge at ₹100: verify notify at T-24h → debit → receipt →
   80G certificate → next debit date.
8. Only then flip `PHONEPE_AUTOPAY_ENABLED=true` in production.

---

## 11. Deliberate trade-offs

- **UPI only.** Covers most Indian donors and avoids card tokenisation work; card
  e-mandate can be added later behind the same adapter.
- **CUSTOM retry strategy.** PhonePe could auto-retry, but explicit control gives a
  clean audit trail and guarantees the 24h notice per attempt.
- **In-memory rate limiter.** Fine for abuse control on one instance; swap the
  store for Redis if the fleet grows.
- **Rupees in Mongo, paise at the boundary.** Matches the existing `Donation`
  schema; every conversion goes through `money.util.js`.
- **Skip the month on terminal failure.** Keeps the mandate alive so a recovered
  account resumes automatically instead of forcing re-registration.

---

## 12. Tests

```
npm test                   # 25 unit tests: money, schedule, deterministic ids,
                           # crypto, magic links, plan limits, autopay payloads,
                           # webhook signatures (PhonePe + Razorpay), event ids
npm run test:integration   # 11 scenarios against a real in-memory MongoDB:
                           # activation, idempotent replay, settlement races,
                           # failure/retry, PAST_DUE, ambiguous timeout, skip,
                           # cancel-with-gateway-down, unique indexes, admin listing
```
