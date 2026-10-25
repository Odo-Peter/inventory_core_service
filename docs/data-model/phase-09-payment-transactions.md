# Phase 9 — PaymentTransaction (deferred)

Read `00-global-conventions.md` first. **Do not implement this phase until it is explicitly requested.** v1 ships with manual POS/account recording (Phase 5).

| Item | Value |
| --- | --- |
| Build phase | 9 (future) — Automatic payment confirmation via webhook |
| Depends on | Phases 4–5 stable in production use |
| Models introduced | `PaymentTransaction` |
| Suggested migration name | `phase_09_payment_transactions` |
| Related ADRs | 0006, 0009, 0011, 0013/0014 (secrets, monitoring), 0015 (scope) |
| Nest module | `payments` |

## 1. Prisma schema (build-plan shape)

```prisma
enum PaymentTransactionStatus {
  initiated
  successful
  failed
}

model PaymentTransaction {
  id                 String                   @id @default(uuid()) @db.Uuid
  payment_id         String                   @db.Uuid
  provider           String
  provider_reference String?
  status             PaymentTransactionStatus
  raw_payload        Json?
  created_at         DateTime                 @default(now())
  confirmed_at       DateTime?

  payment            Payment                  @relation(fields: [payment_id], references: [id])

  @@unique([provider, provider_reference]) // webhook idempotency; NULL references allowed
  @@index([payment_id])
  @@index([status, created_at])
}
```

Required edit: `model Payment { /* ...existing */ transactions PaymentTransaction[] }`.

No `store_id` column: store scope is inherited through `payment → sale → store`. Never derive the store from webhook payload content.

## 2. Known design conflict (resolve before implementing)

`payment_id` is required, but a transaction in `initiated` state exists **before** any money is confirmed. `Payment` has no status field, and a sale becomes paid when payments cover the total, so creating a `Payment` at initiation would count unconfirmed money.

Choose and record in ADR 0009 before migrating:

| Option | Change | Trade-off |
| --- | --- | --- |
| A (recommended) | Make `payment_id` nullable and add `sale_id` to `PaymentTransaction`; create the `Payment` only on `successful` | Small deviation from the plan; no phantom payments |
| B | Add a status to `Payment` and exclude non-confirmed rows from coverage and reports | Touches every Phase 4–7 query |
| C | Create `PaymentTransaction` only after success | Loses `initiated`/`failed` history |

## 3. Field and flow rules

- `provider` is a short identifier (e.g. the chosen gateway). `provider_reference` is the provider's transaction id.
- Webhook receiver: verify the provider signature over the **raw** request body before parsing; reject on failure; respond quickly and idempotently. Upsert by `(provider, provider_reference)` so replays are no-ops.
- On `successful`: set `confirmed_at`, create/confirm the `Payment` (`method` per provider channel, `recorded_by_staff_id` null), and run the same finalization routine as Phase 4–5 in one transaction.
- Amount check: the confirmed amount must equal the expected amount (and currency must equal `Store.currency`); mismatches are logged, flagged and not auto-finalized.
- `raw_payload` may contain personal data. Redact secrets, restrict who can read it, and apply the retention rule from ADR 0011. Never write it to `AuditLog.details`.
- Provider keys and webhook secrets live in environment/secret storage, never in the database or repo.

Audit actions: `payment_transaction.initiated`, `payment_transaction.confirmed`, `payment_transaction.failed`, `payment_transaction.amount_mismatch`.

## 4. DB constraints

```sql
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_confirmed_when_success"
  CHECK ("status" <> 'successful' OR "confirmed_at" IS NOT NULL);
```

## 5. Acceptance checklist

- [ ] Replaying the same webhook twice produces one transaction update and one payment.
- [ ] Invalid signature rejected without touching the database.
- [ ] Amount/currency mismatch never finalizes a sale.
- [ ] Manual recording (Phase 5) still works unchanged.
- [ ] The design conflict in §2 is resolved and documented.
