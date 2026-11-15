# Recurring donations — architecture & security plan

**Goal:** let a donor pledge ₹500/month (or any approved amount) once, and have it
debited automatically from their own UPI account every month, without ever
collecting or storing card/UPI credentials, and in full compliance with RBI's
e-mandate (AutoPay) framework.

Rail: **PhonePe UPI AutoPay (Autopay v2 APIs)** — the merchant already has a
PhonePe PG account and settlement, so there is no new KYC or bank relationship.

---

## 1. The donor journey (what a person actually experiences)

| # | Step | Screen / event |
|---|------|----------------|
| 1 | Lands on `/pledge`, sees ₹500 / ₹1,000 / ₹2,500 tiers + custom | plan cards, live monthly↔yearly total |
| 2 | Enters name, email, mobile, **UPI ID**, optional PAN for 80G | one short form |
| 3 | Reads the RBI disclosure and ticks consent | "I authorise Satyalok to debit ₹500 every month…" |
| 4 | Taps **Continue to UPI mandate** | server creates the mandate, moves to `/pledge/status` |
| 5 | Approves the mandate **in their own UPI app** (UPI PIN = AFA) | ₹500 is collected immediately as month 1 |
| 6 | Sees "Your monthly pledge is active" + receipt email | `/pledge/status` polls and flips automatically |
| 7 | 24h before every later debit: email notice with skip/cancel links | cron + `notify` API |
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

## 3. Sequence — every later month

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
| GET | `/pledge/plans` | public | tiers + limits + consent version |
| POST | `/pledge` | public + `Idempotency-Key` | create mandate |
| GET | `/pledge/:pledgeRef/status` | public, rate-limited | polls + reconciles with gateway |
| GET | `/pledge/manage/:token` | signed token | portal data |
| POST | `/pledge/manage/:token/{pause,resume,skip,cancel}` | signed token | donor self-service |
| POST | `/pledge/recover` | public, 5/hour | email a fresh manage link |
| POST | `/webhook/phonepe/autopay` | sha256(user:pass) | ack fast, persist, process async |
| GET | `/admin/pledges` | admin cookie | list/search/filter |
| GET | `/admin/pledges/:id` | admin cookie | pledge + debit ledger |
| POST | `/admin/pledges/:id/cancel` | admin cookie | audited cancellation |
| POST | `/admin/pledges/:id/retry` | admin cookie | one more attempt (notice first) |
| POST | `/admin/pledges/sync-setup` | admin cookie | settle a mandate whose webhook was lost |

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

1. Request **UPI AutoPay** enablement on the PhonePe merchant account (a separate
   product flag from standard checkout).
2. Generate `PHONEPE_AUTOPAY_CLIENT_ID/SECRET` (OAuth2, not `SALT_KEY`); start with
   `PHONEPE_AUTOPAY_ENV=SANDBOX`.
3. Set the webhook URL to `https://<api-host>/webhook/phonepe/autopay` and copy the
   dashboard username/password into `PHONEPE_AUTOPAY_WEBHOOK_*`.
4. `openssl rand -base64 48` → `PLEDGE_ENCRYPTION_KEY`, `PLEDGE_HASH_PEPPER`,
   `PLEDGE_PORTAL_SECRET` (three different values).
5. Publish `/terms` and `/privacy` covering auto-debit, 24h notice, cancellation
   and grievance redressal; bump `PLEDGE_CONSENT_VERSION`.
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
npm test                   # 20 unit tests: money, schedule, deterministic ids,
                           # crypto, magic links, plan limits, autopay payloads,
                           # webhook signature and event ids
npm run test:integration   # 10 scenarios against a real in-memory MongoDB:
                           # activation, idempotent replay, settlement races,
                           # failure/retry, PAST_DUE, ambiguous timeout, skip,
                           # cancel-with-gateway-down, unique indexes
```

de-duplicate. A genuine new attempt increments `a`, so it cannot collide.
