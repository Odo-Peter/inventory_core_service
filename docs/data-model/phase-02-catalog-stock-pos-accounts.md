# Phase 2 — Category, Item, PriceHistory, StockMovement, POSAccount

Read `00-global-conventions.md` first. Implement **only** the models in this document.

| Item | Value |
| --- | --- |
| Build phase | 2 — Item Catalog (includes stock receiving/adjustments and POS account setup) |
| Depends on | Phase 1 (`Store`, `Staff`, `AuditLog`) |
| Models introduced | `Category`, `Item`, `PriceHistory`, `StockMovement`, `POSAccount` |
| Suggested migration name | `phase_02_catalog_stock_pos_accounts` |
| Related ADRs | 0005, 0006 (transactions), 0007 (inventory), 0011 (audit) |
| Nest modules | `inventory` (Category, Item, PriceHistory, StockMovement); `payments` or an admin submodule (POSAccount) — pick one and stay consistent |

## 1. Prisma schema

```prisma
enum StockMovementReason {
  initial
  restock
  sale
  refund
  adjustment
  damage
}

enum POSAccountType {
  pos_terminal
  bank_account
}

model Category {
  id         String   @id @default(uuid()) @db.Uuid
  store_id   String   @db.Uuid
  name       String
  active     Boolean  @default(true)

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  store      Store    @relation(fields: [store_id], references: [id])
  items      Item[]

  @@unique([store_id, name]) // recommended addition, see deviations
  @@index([store_id, active])
}

model Item {
  id                String   @id @default(uuid()) @db.Uuid
  store_id          String   @db.Uuid
  sku               String
  barcode           String?
  name              String
  category_id       String?  @db.Uuid
  unit              String   // e.g. "piece", "kg"
  current_price     Int      // minor units
  cost_price        Int?     // minor units
  stock_quantity    Int      @default(0)
  reorder_threshold Int      @default(0)
  active            Boolean  @default(true)

  created_at        DateTime @default(now())
  updated_at        DateTime @updatedAt

  store             Store    @relation(fields: [store_id], references: [id])
  category          Category? @relation(fields: [category_id], references: [id])
  price_history     PriceHistory[]
  stock_movements   StockMovement[]

  @@unique([store_id, sku])
  @@unique([store_id, barcode]) // recommended addition (NULLs allowed multiple times)
  @@index([store_id, category_id])
  @@index([store_id, active])
}

model PriceHistory {
  id                  String   @id @default(uuid()) @db.Uuid
  item_id             String   @db.Uuid
  old_price           Int
  new_price           Int
  changed_by_staff_id String?  @db.Uuid
  changed_at          DateTime @default(now())

  item                Item     @relation(fields: [item_id], references: [id])
  changed_by          Staff?   @relation("PriceHistoryChangedBy", fields: [changed_by_staff_id], references: [id])

  @@index([item_id, changed_at])
}

model StockMovement {
  id              String              @id @default(uuid()) @db.Uuid
  store_id        String              @db.Uuid
  item_id         String              @db.Uuid
  quantity_change Int
  reason          StockMovementReason
  sale_id         String?             @db.Uuid // plain column now; FK added in Phase 3
  refund_id       String?             @db.Uuid // plain column now; FK added in Phase 7
  staff_id        String?             @db.Uuid
  note            String?
  created_at      DateTime            @default(now())

  store           Store               @relation(fields: [store_id], references: [id])
  item            Item                @relation(fields: [item_id], references: [id])
  staff           Staff?              @relation(fields: [staff_id], references: [id])

  @@index([store_id, item_id, created_at])
  @@index([sale_id])
  @@index([refund_id])
}

model POSAccount {
  id                  String         @id @default(uuid()) @db.Uuid
  store_id            String         @db.Uuid
  label               String
  type                POSAccountType
  details             String?
  active              Boolean        @default(true)
  created_by_staff_id String?        @db.Uuid

  created_at          DateTime       @default(now())
  updated_at          DateTime       @updatedAt

  store               Store          @relation(fields: [store_id], references: [id])
  created_by          Staff?         @relation("POSAccountCreatedBy", fields: [created_by_staff_id], references: [id])

  @@index([store_id, active])
}
```

### Required edits to Phase 1 models (back-relations only)

```prisma
model Store {
  // ...existing
  categories      Category[]
  items           Item[]
  stock_movements StockMovement[]
  pos_accounts    POSAccount[]
}

model Staff {
  // ...existing
  price_changes        PriceHistory[]  @relation("PriceHistoryChangedBy")
  stock_movements      StockMovement[]
  pos_accounts_created POSAccount[]    @relation("POSAccountCreatedBy")
}
```

### Deviations from the build plan

| Change | Reason |
| --- | --- |
| `@@unique([store_id, name])` on `Category` | Plan says names "should" be unique per store but does not specify. Drop it if ADR 0007 disagrees. Case-insensitive uniqueness needs service-level normalisation (or a `lower(name)` index). |
| `@@unique([store_id, barcode])` on `Item` | Barcode scanning needs one barcode to resolve to one item. |
| FK relations from `*_staff_id` fields to `Staff` | Integrity. Columns remain nullable. |
| `StockMovement.sale_id` / `refund_id` have **no** FK yet | `Sale`/`Refund` do not exist until Phases 3/7. Phase 3 adds `sale` relation; Phase 7 adds `refund` relation. Do not add those tables early. |

## 2. Field rules

**Item**
- `current_price`, `cost_price` are integer minor units. Never floats.
- `stock_quantity` is a running total, only ever changed together with a `StockMovement` in one transaction (see §4). Never expose it as directly writable on create/update DTOs, except via the initial-stock path below.
- Deactivate (`active = false`), never hard-delete, once an item has been referenced by anything.
- `unit` is a free string. Note quantities are integers, so fractional units (e.g. 0.5 kg) are not representable in v1; sell in a base unit (e.g. grams) or accept the limit. Confirm with ADR 0007.
- SKU is unique within a store. `sku` may be edited later because sales snapshot it.

**PriceHistory**
- Inherits store scope from `Item` (no `store_id`).
- One row per **actual** price change (`old_price <> new_price`). Item creation writes no row.
- Price update = update `Item.current_price` + insert `PriceHistory` + insert `AuditLog` (`item.price_changed`) in one transaction. Manager role or above only.

**StockMovement**
- Immutable. No update/delete paths; corrections are new movements.
- Sign by reason:

| reason | quantity_change |
| --- | --- |
| `initial`, `restock`, `refund` | `> 0` |
| `sale`, `damage` | `< 0` |
| `adjustment` | `<> 0` |

- `sale_id` is set for `sale` rows (Phase 3+); `refund_id` for `refund` rows (Phase 7).
- `note` is expected for `adjustment` and `damage` (service-level validation).

**POSAccount**
- Admin/manager-configured payment destinations. `details` holds a label-level hint only (bank name, last 4 digits). **Never store full card or account numbers.**
- Deactivate rather than delete; payments will reference it.
- Cash payments never reference a POS account.

## 3. DB constraints and raw SQL

```sql
ALTER TABLE "Item" ADD CONSTRAINT "Item_prices_nonneg"
  CHECK ("current_price" >= 0 AND ("cost_price" IS NULL OR "cost_price" >= 0));
ALTER TABLE "Item" ADD CONSTRAINT "Item_reorder_nonneg" CHECK ("reorder_threshold" >= 0);
-- Include only if ADR 0007 forbids negative stock (recommended default):
ALTER TABLE "Item" ADD CONSTRAINT "Item_stock_nonneg" CHECK ("stock_quantity" >= 0);

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sign_by_reason" CHECK (
  ("reason" IN ('initial','restock','refund') AND "quantity_change" > 0) OR
  ("reason" IN ('sale','damage')              AND "quantity_change" < 0) OR
  ("reason" = 'adjustment'                    AND "quantity_change" <> 0)
);

ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_nonneg_changed"
  CHECK ("old_price" >= 0 AND "new_price" >= 0 AND "old_price" <> "new_price");
```

## 4. Service-layer rules

**Changing stock (the only allowed way)** — inside one `prisma.$transaction`:
1. Insert the `StockMovement` (with `store_id` from auth, `staff_id` from the actor).
2. Apply `Item.stock_quantity` with an **atomic** `increment`/`decrement`, never read-modify-write.
3. For decrements, guard against going negative (e.g. `updateMany` with `stock_quantity >= n` and check `count === 1`), unless ADR 0007 permits negative stock.
4. Write the `AuditLog` row.

**Initial stock**: creating an item with opening stock = create `Item` (stock 0) + `initial` movement + increment, in one transaction.

**Cross-store safety**: every lookup is `where: { id, store_id }`. A category, item or account id from another store must behave as "not found".

Audit actions introduced:

| Action | Entity |
| --- | --- |
| `item.created` / `item.updated` / `item.deactivated` | Item |
| `item.price_changed` (before/after) | Item |
| `stock.received` / `stock.adjusted` / `stock.damaged` | Item (details include movement id) |
| `pos_account.created` / `pos_account.updated` / `pos_account.deactivated` | POSAccount |
| `category.created` / `category.updated` | Category |

## 5. Seed data

A handful of categories and items with initial stock (via `initial` movements, not by writing `stock_quantity` directly), and at least one `POSAccount` of each type for later phases.

## 6. Acceptance checklist

- [ ] Every `stock_quantity` change has a matching `StockMovement` (test by summing movements per item and comparing).
- [ ] Concurrent decrements never lose updates or go negative.
- [ ] Price change writes `PriceHistory` + `AuditLog` atomically; staff role cannot change price.
- [ ] `UNIQUE(store_id, sku)` enforced; items from another store are invisible.
- [ ] `StockMovement.sale_id`/`refund_id` exist as nullable UUID columns without FKs.
- [ ] No `Sale`, `Payment` or other later-phase model was added.

## 7. Open items to confirm against ADRs

- Is negative stock ever allowed? (ADR 0007; default above is no.)
- Fractional quantities / weighed items.
- Whether a paid-sale void restores stock and with which `reason` (the enum has no `void` value; adding one is a one-line migration but needs an ADR first).
