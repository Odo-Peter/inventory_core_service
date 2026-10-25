# Phase 7 — Refund, RefundItem

Read `00-global-conventions.md` first. Implement **only** the models in this document.

| Item | Value |
| --- | --- |
| Build phase | 7 — Remaining Core Features (returns/refunds) |
| Depends on | Phases 1–5 (Phase 6 reporting should be updated to net out refunds) |
| Models introduced | `Refund`, `RefundItem` |
| Suggested migration name | `phase_07_refunds` |
| Related ADRs | 0004 (approval roles), 0006, 0007, 0008, 0009, 0010, 0011 |
| Nest module | `sales` or `payments` — choose one and stay consistent (global conventions) |

Other Phase 7 features (low-stock alerts, discounts, dashboard, audit log screen, shift reconciliation) use existing tables and fields. Customer/loyalty records are **not** part of this phase.

## 1. Prisma schema

```prisma
model Refund {
  id                   String        @id @default(uuid()) @db.Uuid
  store_id             String        @db.Uuid
  sale_id              String        @db.Uuid
  shift_id             String?       @db.Uuid // PROPOSED, see deviations
  staff_id             String        @db.Uuid
  approved_by_staff_id String?       @db.Uuid
  reason               String
  total                Int           // minor units
  method               PaymentMethod // typed instead of String, see deviations
  pos_account_id       String?       @db.Uuid
  created_at           DateTime      @default(now())

  store                Store         @relation(fields: [store_id], references: [id])
  sale                 Sale          @relation(fields: [sale_id], references: [id])
  shift                Shift?        @relation(fields: [shift_id], references: [id])
  staff                Staff         @relation("RefundStaff", fields: [staff_id], references: [id])
  approved_by          Staff?        @relation("RefundApprovedBy", fields: [approved_by_staff_id], references: [id])
  pos_account          POSAccount?   @relation(fields: [pos_account_id], references: [id])
  refund_items         RefundItem[]
  stock_movements      StockMovement[]

  @@index([sale_id])
  @@index([store_id, created_at])
  @@index([shift_id, method])
}

model RefundItem {
  id           String   @id @default(uuid()) @db.Uuid
  refund_id    String   @db.Uuid
  sale_item_id String   @db.Uuid
  quantity     Int
  amount       Int      // minor units
  restock      Boolean  @default(false)

  refund       Refund   @relation(fields: [refund_id], references: [id])
  sale_item    SaleItem @relation(fields: [sale_item_id], references: [id])

  @@unique([refund_id, sale_item_id])
  @@index([sale_item_id])
}
```

### Required edits to earlier models

```prisma
model Store      { /* ...existing */ refunds Refund[] }
model Shift      { /* ...existing */ refunds Refund[] }
model Sale       { /* ...existing */ refunds Refund[] }
model SaleItem   { /* ...existing */ refund_items RefundItem[] }
model POSAccount { /* ...existing */ refunds Refund[] }
model Staff {
  // ...existing
  refunds_processed Refund[] @relation("RefundStaff")
  refunds_approved  Refund[] @relation("RefundApprovedBy")
}
model StockMovement {
  // ...existing; adds the FK for the existing refund_id column
  refund Refund? @relation(fields: [refund_id], references: [id])
}
```

### Deviations from the build plan

| Change | Reason |
| --- | --- |
| `Refund.method` is `PaymentMethod`, not `String` | The plan left the type open. Shift reconciliation needs to identify cash refunds exactly, so use the existing enum. |
| `Refund.shift_id` (nullable) | Expected cash is `opening float + cash payments − cash refunds` **per shift**, but the plan gives `Refund` no shift link. Set from the processing staff's open shift. Confirm with ADR 0010. |
| `@@unique([refund_id, sale_item_id])` | One row per sale line per refund. |

## 2. Field rules

**Refund**
- `reason` is required. `total = Σ refund_items.amount` (server-computed).
- `staff_id` is the processor (from auth). `approved_by_staff_id` is required when the processor's role or the amount requires approval per ADR 0004/0008; the approver must be an active `manager`/`admin` of the same store.
- `method` cash → `pos_account_id` null; card/transfer → required, active, same store (same rule as `Payment`).
- Immutable once written. Mistakes are corrected with a compensating record, not an edit.

**RefundItem**
- `quantity > 0`. Across all refunds of a sale, `Σ quantity` per `sale_item_id` must not exceed `SaleItem.quantity`.
- `amount` is the pro-rata share of the line's `line_total` (so discounts carry through): `amount = round(line_total × quantity / SaleItem.quantity)`. When a line's final units are refunded, give the remainder to the last refund so lines sum exactly to `line_total`. Put the rounding rule in a unit-tested helper.
- `restock = true` means the goods return to sellable stock.

**Sale status after a refund**
- Some refunded quantity but not all lines fully returned → `partially_refunded`.
- Every line fully returned → `refunded`.
- Total refunded across refunds must not exceed `Σ payments` on the sale. Tax (`tax_total`) is not allocated to lines in v1, so full refunds of taxed sales need a rule from ADR 0008.

## 3. DB constraints and raw SQL

```sql
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_total_positive" CHECK ("total" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_account_by_method" CHECK (
  ("method" = 'cash' AND "pos_account_id" IS NULL) OR
  ("method" <> 'cash' AND "pos_account_id" IS NOT NULL)
);
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "RefundItem" ADD CONSTRAINT "RefundItem_amount_nonneg" CHECK ("amount" >= 0);
```

## 4. Service-layer rules (single transaction)

1. Lock the sale row (`FOR UPDATE`); require status `paid` or `partially_refunded`, same store.
2. Validate quantities against previously refunded totals, validate approval, and validate the method/account rule.
3. Insert `Refund` and `RefundItem` rows; compute `total`.
4. For each `restock = true` line, insert a `StockMovement` (`reason = refund`, `quantity_change = +quantity`, `sale_id`, `refund_id`, `staff_id`) and atomically increment `Item.stock_quantity`. Lines with `restock = false` write **no** movement (a damage record would be a separate, explicit `damage` movement if ADR 0007 wants one).
5. Update `Sale.status`.
6. Write the audit row (`refund.created`, with approver and totals).

Refunds by `staff` role below the approval threshold may be allowed; above it, require approval. All thresholds come from config/ADR, not literals.

## 5. Effects on other phases

- Phase 6 reports: net revenue = finalized sale totals − refund totals; expected cash subtracts `Refund` rows with `method = cash` and the shift's `shift_id`.
- Void of a **paid** sale is not defined by the build plan. Prefer routing reversals of paid sales through this refund flow unless an ADR defines voids.

## 6. Acceptance checklist

- [ ] Cannot refund more units of a line than were sold, across multiple refunds.
- [ ] Refund line amounts sum exactly to `Refund.total`; full refund of a discounted line equals `line_total`.
- [ ] `restock = true` increments stock via a `refund` movement linked to both ids; `false` leaves stock unchanged.
- [ ] Sale transitions `paid → partially_refunded → refunded` correctly.
- [ ] Cash refund reduces the shift's expected cash; card/transfer refund does not.
- [ ] Approval rules enforced; approver from another store is rejected.

## 7. Open items to confirm against ADRs

- Refund approval threshold and who may approve.
- Tax handling on refunds.
- Whether a refund may use a different method than the original payment.
- `Refund.shift_id` (see deviations).
