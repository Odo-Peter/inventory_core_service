# Phases 4–5 — Payment, Receipt

Read `00-global-conventions.md` first. Implement **only** the models in this document.

| Item | Value |
| --- | --- |
| Build phases | 4 — Cash payment path; 5 — Card/transfer manual recording (incl. split payments) |
| Depends on | Phases 1–3 (`POSAccount` from Phase 2, `Sale` from Phase 3) |
| Models introduced | `Payment`, `Receipt` |
| Suggested migration name | `phase_04_05_payments_receipts` (one migration is fine; Phase 4 may ship cash-only code first) |
| Related ADRs | 0006, 0009 (payments & receipts), 0010 (shifts), 0011 |
| Nest module | `payments` |

No payment-gateway integration here. A sale is paid when staff-recorded payments cover the total (gateway confirmation is Phase 9).

## 1. Prisma schema

```prisma
enum PaymentMethod {
  cash
  card
  transfer
}

model Payment {
  id                   String        @id @default(uuid()) @db.Uuid
  store_id             String        @db.Uuid
  sale_id              String        @db.Uuid
  method               PaymentMethod
  amount               Int           // minor units, applied to the sale
  pos_account_id       String?       @db.Uuid
  reference            String?
  recorded_by_staff_id String?       @db.Uuid
  created_at           DateTime      @default(now())

  store                Store         @relation(fields: [store_id], references: [id])
  sale                 Sale          @relation(fields: [sale_id], references: [id])
  pos_account          POSAccount?   @relation(fields: [pos_account_id], references: [id])
  recorded_by          Staff?        @relation("PaymentRecordedBy", fields: [recorded_by_staff_id], references: [id])

  @@index([sale_id])
  @@index([store_id, created_at])
  @@index([store_id, method, created_at])
  @@index([pos_account_id])
}

model Receipt {
  id             String   @id @default(uuid()) @db.Uuid
  store_id       String   @db.Uuid
  sale_id        String   @unique @db.Uuid
  receipt_number String
  generated_at   DateTime @default(now())
  printed_count  Int      @default(0)

  store          Store    @relation(fields: [store_id], references: [id])
  sale           Sale     @relation(fields: [sale_id], references: [id])

  @@unique([store_id, receipt_number])
}
```

### Required edits to earlier models

```prisma
model Store {
  // ...existing
  payments        Payment[]
  receipts        Receipt[]
  receipt_counter Int @default(0) // PROPOSED, see deviations
}
model Sale       { /* ...existing */ payments Payment[]  receipt Receipt? }
model POSAccount { /* ...existing */ payments Payment[] }
model Staff      { /* ...existing */ payments_recorded Payment[] @relation("PaymentRecordedBy") }
```

### Deviations from the build plan

| Change | Reason |
| --- | --- |
| `Store.receipt_counter Int @default(0)` | The plan requires receipt numbers "from a per-store counter inside the finalize transaction" but defines no counter field. Increment atomically (below). Alternative: a dedicated `ReceiptCounter(store_id PK, last_number)` table. Confirm with ADR 0009 before migrating. |
| FK relations on `pos_account_id`, `recorded_by_staff_id` | Integrity; columns stay nullable. |

## 2. Field rules

**Payment**
- `amount` is the amount **applied to the sale** (`> 0`), not cash tendered. For a paid sale, `Σ payments.amount = Sale.total` exactly. Change given back is a UI/receipt concern and is not modelled in v1 (confirm with ADR 0009 if tendered/change must be persisted).
- `cash` → `pos_account_id` null. `card`/`transfer` → `pos_account_id` required, referencing an `active` `POSAccount` of the same store.
- `reference` is optional (transfer narration or POS approval code).
- `recorded_by_staff_id` is the authenticated staff; it stays nullable for Phase 9 webhook-confirmed payments.
- Immutable once written. Mistakes are corrected via refund/void flows, not edits or deletes.
- Split payments: several rows per sale. The final row that brings `Σ amount` to `total` triggers finalization. Reject any payment that would exceed the remaining balance.

**Receipt**
- One per finalized sale (`sale_id` unique). Created in the same transaction that marks the sale paid.
- `receipt_number` unique per store. Format (padding/prefix) is set by ADR 0009; the numeric part comes from `Store.receipt_counter`.
- `printed_count` is incremented atomically on each print/reprint request (reprints are allowed; log them).
- Receipt content is derived at read time from `Sale`, `SaleItem` snapshots, staff name, and `Store` (name, `receipt_footer`). Note that Store name/footer are **not** snapshotted, so a reprint reflects current store settings.

## 3. DB constraints and raw SQL

```sql
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_account_by_method" CHECK (
  ("method" = 'cash' AND "pos_account_id" IS NULL) OR
  ("method" <> 'cash' AND "pos_account_id" IS NOT NULL)
);
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_printed_nonneg" CHECK ("printed_count" >= 0);
ALTER TABLE "Store" ADD CONSTRAINT "Store_receipt_counter_nonneg" CHECK ("receipt_counter" >= 0);
```

## 4. Finalization algorithm (single transaction)

Used by the cash endpoint (Phase 4) and the card/transfer endpoint (Phase 5):

1. Lock the sale: `SELECT ... FOR UPDATE` on `Sale` (serialises concurrent payments).
2. Validate: sale in this store, status `draft`, has lines, `amount ≤ total − Σ existing payments`, account rules above.
3. Insert the `Payment`.
4. If `Σ payments = total`:
   a. Run the shared Phase 3 finalize routine (stock movements + decrement, `status = paid`, `paid_at`).
   b. Allocate the receipt number with one atomic statement, e.g. `UPDATE "Store" SET receipt_counter = receipt_counter + 1 WHERE id = $1 RETURNING receipt_counter`. Because it runs inside this transaction, a rollback also rolls the counter back, so numbers stay gapless.
   c. Insert the `Receipt`.
5. Write audit rows. Commit.

If any step fails, nothing persists: no payment, no stock change, no receipt.

Audit actions introduced: `payment.recorded` (method, amount, account id), `sale.finalized`, `receipt.generated`, `receipt.reprinted`.

## 5. Shift attribution (needed by Phase 6)

`Payment` has no `shift_id`. Cash is attributed to a shift through `Sale.shift_id`. Open question for ADR 0010: if a draft is started in one shift and paid in another, which shift owns the cash? Until decided, document the behaviour in code and keep `Sale.shift_id` as the single source.

## 6. Acceptance checklist

- [ ] Cash path: draft → cash payment → sale `paid`, stock decremented, receipt created, all atomic.
- [ ] Card/transfer payment without a valid active same-store `pos_account_id` is rejected (service and DB).
- [ ] Split payment finalizes only when the sum equals the total; overpayment is rejected.
- [ ] Two concurrent final payments on one sale produce one receipt and one stock decrement.
- [ ] Receipt numbers are unique per store and gapless under rollback tests.
- [ ] `printed_count` increments atomically; `sale_id` unique on `Receipt`.
- [ ] No `PaymentTransaction` or `Refund` model was added.

## 7. Open items to confirm against ADRs

- Receipt counter storage and number format (ADR 0009).
- Idempotency for payment submission: `Payment` has no `client_ref`, so a double-submit could record two payments. ADR 0006 should say whether an idempotency key is required; if yes, add it as a deliberate, documented deviation.
- Whether tendered cash/change must be persisted.
- Which shift owns a payment when a sale spans shifts.
