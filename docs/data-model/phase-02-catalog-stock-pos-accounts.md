# Phase 2 — Category, Item, PriceHistory, StockMovement, POSAccount

Read `00-global-conventions.md` first. Implement **only** the models in this document.

| Item              | Value                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Build phase       | 2 — Item Catalog (includes stock receiving/adjustments and POS account setup)                                                            |
| Depends on        | Phase 1 (`Store`, `Staff`, `AuditLog`)                                                                                                   |
| Models introduced | `Category`, `Item`, `PriceHistory` (catalog); `StockMovement` (inventory); `POSAccount` (payments)                                       |
| Migrations        | `phase_02a_catalog`, `phase_02b_stock_movements`, `phase_02c_pos_accounts`, `phase_02d_item_image`                                       |
| Related ADRs      | 0005 (store scope), 0006 (transactions), 0007 (inventory), 0011 (audit), 0018 (catalog/inventory boundaries), 0019 (item image storage)  |
| Nest modules      | `catalog` (Category, Item, PriceHistory, item images); `inventory` (StockMovement, stock service, stock status); `payments` (POSAccount) |

## 1. Prisma schema

Phase 2 ships as four migrations. The schema below is the final shape; each slice adds only its own models/columns.

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
  image_key         String?          // added by phase_02d_item_image; opaque key, never a URL (ADR 0019)

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

| Change                                                                                             | Reason                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog and inventory are separate modules (`catalog`, `inventory`)                                | ADR 0018; catalog writes must not write stock. Neither module imports the other in either direction; they share only `PrismaService` and common/shared code.                                               |
| Four migrations instead of one                                                                     | `phase_02a_catalog`, `phase_02b_stock_movements`, `phase_02c_pos_accounts`, `phase_02d_item_image` keep each slice reviewable.                                                                             |
| Opening stock is not part of item creation                                                         | Catalog creation always starts at `stock_quantity = 0`; opening stock is a separate `initial` inventory movement (ADR 0018). Deliberate deviation from the earlier "create with opening stock" suggestion. |
| Item create and edit are **Manager+**, not Admin                                                   | ADR 0018 product decision: managers who handle deliveries can add a product and stock it without waiting for an admin. Category create/edit, item deactivate, and reconciliation stay Admin.               |
| Image upload/replace/remove are **Manager+**, not Admin                                            | ADR 0018/0019; consistent with item create being Manager+.                                                                                                                                                 |
| `Item.image_key String?`                                                                           | One optional product image; the key is stored, never a URL or provider detail (ADR 0019). Added by its own migration.                                                                                      |
| Unified image contract: `PUT /items/:id/image` and multipart field `image` (also on `POST /items`) | ADR 0019. Replaces the earlier `POST /items/:id/image` with field `file`. No alias routes or field names are kept.                                                                                         |
| Item id is generated up front (UUID) on create                                                     | ADR 0019; the storage key `items/{store_id}/{item_id}/{uuid}` must be formed before the database write.                                                                                                    |
| Item create with an image is all-or-nothing                                                        | ADR 0019; storage failure creates no item, and a failed DB write triggers a best-effort delete of the uploaded object.                                                                                     |
| New read-only endpoint `GET /inventory/items/:id/stock-status`                                     | ADR 0018; catalog may not read movements, so inventory owns the data the UI needs to choose between "Set opening stock" and "Receive stock".                                                               |
| `@@unique([store_id, name])` + a raw `lower(name)` unique index on `Category`                      | Names are normalized (trim/collapse whitespace) and unique case-insensitively per store.                                                                                                                   |
| `@@unique([store_id, barcode])` on `Item`                                                          | Barcode scanning needs one barcode to resolve to one item. Empty barcodes are stored as `NULL`.                                                                                                            |
| FK relations from `*_staff_id` fields to `Staff`                                                   | Integrity. Columns remain nullable.                                                                                                                                                                        |
| `StockMovement.sale_id` / `refund_id` have **no** FK yet                                           | `Sale`/`Refund` do not exist until Phases 3/7. Phase 3 adds `sale` relation; Phase 7 adds `refund` relation. Do not add those tables early.                                                                |
| Adjustment `note` is optional                                                                      | ADR 0007 is Accepted and wins over this document's earlier "expected" wording. The reason category is still required by the API.                                                                           |
| Negative stock is forbidden with no override                                                       | ADR 0018; `Item_stock_nonneg` enforces it and ADR 0007's strict-stock rule wins over any looser phase text.                                                                                                |

## 2. Field rules

**Item**

- `current_price`, `cost_price` are integer minor units. Never floats.
- `stock_quantity` is a derived cache of the sum of the item's `StockMovement.quantity_change` rows, only ever changed by `inventory/StockService` together with a `StockMovement` in one transaction (see §4 and ADR 0018). No other file may use `increment`, `decrement`, or `set` on it (Prisma or raw SQL); reads, `select`, and `where` are fine anywhere. It is never accepted by create/update DTOs. Item creation always starts at zero; opening stock is a separate inventory call. Item responses include it read-only.
- Deactivate (`active = false`), never hard-delete, once an item has been referenced by anything.
- `cost_price` is margin data. It is returned only to Managers and Admins and is omitted from cashier responses at the response-shaping layer.
- `current_price`, `cost_price`, and `reorder_threshold` are non-negative integers. Price changes require Manager or above and go through the dedicated price endpoint; ordinary item updates never accept `current_price`.
- Roles: item reads are available to every authenticated role. Item create (including optional image) and edit are Manager+ (ADR 0018). Price changes are Manager+. Deactivation is Admin. Image upload/replace/remove are Manager+. Cashiers are read-only on catalog mutations. Roles are enforced through the existing roles mechanism; services that already perform a defensive role check keep doing so.
- `PATCH /items/:id` is JSON-only: it never accepts an image and rejects `stock_quantity` and `current_price`. Changing both descriptive fields and the image takes two calls (`PATCH` + `PUT /items/:id/image`); both are idempotent, which is acceptable for Phase 2.
- `unit` is a free string. Note quantities are integers, so fractional units (e.g. 0.5 kg) are not representable in v1; sell in a base unit (e.g. grams) or accept the limit. Confirm with ADR 0007.
- SKU is unique within a store. `sku` may be edited later because sales snapshot it.

**Item image (ADR 0019)**

- `image_key` is an opaque application-generated key of the form `items/{store_id}/{item_id}/{uuid}`. It never holds a URL, a provider public-ID format, or transformation settings. A missing image is `image_key = NULL`; there is no placeholder row and no image table in Phase 2.
- Responses may expose `image_key` and derived `variants` URLs; derived URLs are never persisted.
- Two delivery variants, constants in code (not columns), derived at response time:
  - `thumb`: `c_fill,w_160,h_160,f_auto,q_auto`
  - `full`: `c_limit,w_800,f_auto,q_auto`
- If storage is disabled, an existing key still returns `image_key` but `variants` is `null`.
- Input is limited to 2 MB and JPEG/PNG/WebP. The declared MIME type is not trusted. `sharp` (`failOn: "error"`, pixel limit) validates content, applies EXIF rotation, strips metadata, and re-encodes to WebP quality 82. SVG, animated formats, and malformed files are rejected.
- Storage sits behind the `ImageStorage` interface, injected via the `IMAGE_STORAGE` Nest provider token. Interface: `upload`/`put`, `remove`, `url`, and an `enabled` flag.
  - `CloudinaryImageStorage` is the production adapter (uploads with `overwrite` and `invalidate`, deletes by key, derives delivery URLs).
  - `DisabledImageStorage` is the default when nothing is configured; it rejects uploads/removals with `503 image_storage_not_configured`.
  - Tests use a test-only `MemoryImageStorage` under `test/helpers/`; no test can reach Cloudinary.
  - `IMAGE_STORAGE_DRIVER` selects `disabled` (default) or `cloudinary`. Cloudinary mode requires `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`; empty values are not accepted.
- Storage failures return `503 image_storage_unavailable` (or `503 image_storage_not_configured` when disabled).
- Orphaned provider objects are possible (process dies between upload and commit, or cleanup fails). They are harmless to correctness; a future maintenance job can remove unreferenced keys.

**PriceHistory**

- Inherits store scope from `Item` (no `store_id`).
- One row per **actual** price change (`old_price <> new_price`). Item creation writes no row.
- Price update = update `Item.current_price` + insert `PriceHistory` + insert `AuditLog` (`item.price_changed`) in one transaction. Manager role or above only.

**StockMovement**

- Immutable. No update/delete paths; corrections are new movements.
- Sign by reason (signed in the database and the API):

| reason                         | quantity_change |
| ------------------------------ | --------------- |
| `initial`, `restock`, `refund` | `> 0`           |
| `sale`, `damage`               | `< 0`           |
| `adjustment`                   | `<> 0`          |

- The damage endpoint takes a positive quantity and stores the negative movement.
- `sale_id` is set for `sale` rows (Phase 3+); `refund_id` for `refund` rows (Phase 7).
- `note` is optional for every reason. `adjustment` and `damage` still require the reason category itself.
- `initial` is allowed only when the item has no prior movements, and only once per item. A second attempt returns:
  - status `409`, code `initial_stock_exists`
  - message: `"Opening stock was already recorded for this item. Use receive stock to add more."`
  - Subsequent deliveries must use `receive` (restock). The UI must treat `initial` as one-time and route later deliveries through `receive`.
- `initial` and `restock` are rejected on inactive items (`409 item_inactive`); `adjustment` and `damage` remain allowed so leftover stock can be written off.
- Receiving accepts optional `supplier_name` and `delivery_reference`. There are no columns for them; they are written only to the `stock.received` audit details.
- Reconciliation is detect-only: it reports items whose `stock_quantity` differs from the sum of their movements, and items with stock but no movements. It never repairs drift. A human corrects drift with an explicit `adjustment` movement through `StockService`.

**POSAccount**

- Manager/Admin-configured payment destinations. `details` holds a label-level hint only (bank name, last 4 digits). **Never store full card or account numbers.** The API rejects any details value containing 12 or more digits, ignoring spaces, dots, and hyphens.
- `label` is normalized (trim/collapse whitespace) and required. `type` is `pos_terminal` or `bank_account`.
- Deactivate rather than delete; payments will reference it. No hard-delete route.
- Cash payments never reference a POS account.
- Reads are available to every authenticated role because cashiers select a destination at payment time; setup and deactivation are Manager or above (consistent with ADR 0004).

### Catalog endpoints (Slice 2a)

| Method | Path                              | Roles    | Notes                                                                                                                                                                              |
| ------ | --------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/categories`              | Cashier+ | Paginated; filters `active`, `q`; order `(name, id)`.                                                                                                                              |
| GET    | `/api/v1/categories/:id`          | Cashier+ | Cross-store id is 404.                                                                                                                                                             |
| POST   | `/api/v1/categories`              | Admin    | Normalizes name; case-insensitive unique per store. Managers cannot create categories (see open items).                                                                            |
| PATCH  | `/api/v1/categories/:id`          | Admin    | No hard delete.                                                                                                                                                                    |
| GET    | `/api/v1/items`                   | Cashier+ | Paginated; filters `category_id`, `active`, `q` over name/SKU/barcode, `low_stock`; order `(name, id)`.                                                                            |
| GET    | `/api/v1/items/barcode/:barcode`  | Cashier+ | Exact scan lookup; 404 when unknown.                                                                                                                                               |
| GET    | `/api/v1/items/:id`               | Cashier+ | `cost_price` omitted for cashiers.                                                                                                                                                 |
| GET    | `/api/v1/items/:id/price-history` | Cashier+ | Paginated; order `(changed_at DESC, id DESC)`.                                                                                                                                     |
| POST   | `/api/v1/items`                   | Manager+ | Always starts `stock_quantity = 0`; rejects `stock_quantity`. Accepts optional multipart field `image` (max 2 MB); all-or-nothing (see §4).                                        |
| PATCH  | `/api/v1/items/:id`               | Manager+ | JSON only; rejects `stock_quantity`, `current_price`, and any image.                                                                                                               |
| POST   | `/api/v1/items/:id/price`         | Manager+ | Updates price + history + audit atomically; unchanged price is a no-op.                                                                                                            |
| POST   | `/api/v1/items/:id/deactivate`    | Admin    | Idempotent; no delete route.                                                                                                                                                       |
| PUT    | `/api/v1/items/:id/image`         | Manager+ | Upload or replace. Multipart field `image`, max 2 MB; validates with sharp and stores WebP; 503 when storage is disabled/unavailable; 409 `image_changed` on a concurrent replace. |
| DELETE | `/api/v1/items/:id/image`         | Manager+ | Idempotent; clears the key and removes the object best-effort.                                                                                                                     |

### Inventory endpoints (Slice 2b)

| Method | Path                                       | Roles    | Notes                                                                                                                                                                                                               |
| ------ | ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/inventory/items/:id/initial`      | Manager+ | Opening stock once; 409 `initial_stock_exists`; inactive item is 409 `item_inactive`.                                                                                                                               |
| POST   | `/api/v1/inventory/items/:id/receive`      | Manager+ | Positive `restock`; optional supplier/delivery data goes to audit only.                                                                                                                                             |
| POST   | `/api/v1/inventory/items/:id/adjust`       | Manager+ | Signed non-zero `quantity_change`; 409 `insufficient_stock` when it would go below zero.                                                                                                                            |
| POST   | `/api/v1/inventory/items/:id/damage`       | Manager+ | Positive input stored as a negative `damage` movement.                                                                                                                                                              |
| GET    | `/api/v1/inventory/items/:id/movements`    | Manager+ | Paginated; order `(created_at DESC, id DESC)`; cross-store item is 404.                                                                                                                                             |
| GET    | `/api/v1/inventory/items/:id/stock-status` | Manager+ | Read-only, store-scoped (cross-store is 404), no audit entry. Returns at least `opening_stock_allowed` and related status flags so the UI can choose "Set opening stock" vs "Receive stock" before a mutating call. |
| GET    | `/api/v1/inventory/reconciliation`         | Admin    | Paginated, read-only drift report; never repairs.                                                                                                                                                                   |

Cashiers have no inventory endpoints.

### POS account endpoints (Slice 2c)

| Method | Path                                  | Roles    | Notes                                                                                 |
| ------ | ------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| GET    | `/api/v1/pos-accounts`                | Cashier+ | Paginated; filters `active`, `type`; order `(label, id)`.                             |
| GET    | `/api/v1/pos-accounts/:id`            | Cashier+ | Cross-store id is 404.                                                                |
| POST   | `/api/v1/pos-accounts`                | Manager+ | Normalizes label; rejects full card/account numbers in `details`; records creator.    |
| PATCH  | `/api/v1/pos-accounts/:id`            | Manager+ | Updates label/type/details; no-op writes no audit row. Send `details: null` to clear. |
| POST   | `/api/v1/pos-accounts/:id/deactivate` | Manager+ | Idempotent; no delete route.                                                          |

## 3. DB constraints and raw SQL

```sql
ALTER TABLE "Item" ADD CONSTRAINT "Item_prices_nonneg"
  CHECK ("current_price" >= 0 AND ("cost_price" IS NULL OR "cost_price" >= 0));
ALTER TABLE "Item" ADD CONSTRAINT "Item_reorder_nonneg" CHECK ("reorder_threshold" >= 0);
ALTER TABLE "Item" ADD CONSTRAINT "Item_stock_nonneg" CHECK ("stock_quantity" >= 0);

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sign_by_reason" CHECK (
  ("reason" IN ('initial','restock','refund') AND "quantity_change" > 0) OR
  ("reason" IN ('sale','damage')              AND "quantity_change" < 0) OR
  ("reason" = 'adjustment'                    AND "quantity_change" <> 0)
);

ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_nonneg_changed"
  CHECK ("old_price" >= 0 AND "new_price" >= 0 AND "old_price" <> "new_price");

-- Opening stock is one-time per item, even under concurrent requests.
CREATE UNIQUE INDEX "StockMovement_one_initial_per_item"
  ON "StockMovement" ("item_id") WHERE "reason" = 'initial';
```

## 4. Service-layer rules

**Module boundaries (ADR 0018)**

- Catalog lives in `src/modules/catalog/`; inventory in `src/modules/inventory/`. Neither imports the other. Inventory looks up items with its own store-scoped Prisma query; catalog never calls into inventory and never reads movements.
- Swagger tags are `Catalog` and `Inventory`.
- Guard tests: (1) fail if any file other than `inventory/stock.service.ts` writes `stock_quantity`; (2) fail if any file under `catalog` imports from `inventory` or the reverse.

**Changing stock (the only allowed way)** — inside one `prisma.$transaction` in `StockService.applyMovement`, the single writer. Specialized public methods (`initialize`, `receive`, `adjust`, `recordDamage`) translate DTOs into movements; future sales/refunds call `applyMovement` with `sale`/`refund` and their own audit action. Every stock-changing operation goes through one `StockService` method so a future stock-count lock check can be added in a single place.

1. Lock the store-scoped `Item` row with `SELECT ... FOR UPDATE` and load `active` / `stock_quantity`; a missing or cross-store row is 404.
2. Enforce the reason rules: `initial` only with no prior movements; `initial`/`restock` only on active items; sign must match the reason.
3. Insert the `StockMovement` (with `store_id` from auth, `staff_id` from the actor, optional `sale_id`/`refund_id`).
4. Apply `Item.stock_quantity` with an **atomic** `increment`/`decrement`, never read-modify-write.
5. For decrements, guard with `updateMany` requiring `stock_quantity >= n` and `count === 1`; otherwise 409 `insufficient_stock` and roll back the movement and audit.
6. Write the `AuditLog` row.

**Initial stock**: item creation never accepts stock. Opening stock is a separate inventory call: create `Item` (stock 0) in the catalog, then run an `initial` movement through `StockService` in one transaction. It is allowed only when the item has no prior movements. ADR 0007's stock-count sessions, opening-stock sessions, and store-wide count lock are not modelled in Phase 2; the single-writer method is the extension point.

**Item create with optional image (ADR 0019) — all-or-nothing**

1. Validate the DTO and the image (if present) and normalize the image with `sharp`. Any failure is a 4xx with **no side effects** (no storage call, no database write).
2. Generate the item id up front (UUID) so the key `items/{store_id}/{item_id}/{random uuid}` can be formed.
3. If an image was supplied, `storage.put` the normalized bytes under that key.
4. In one database transaction, create the item (stock 0, `image_key` set when an image was uploaded) and write the single audit entry.
5. If step 4 fails (e.g. SKU or barcode conflict returning 409), best-effort delete the uploaded object, then rethrow. A failed compensating delete is logged and never masks the original error.
6. If step 3 fails, no item is created (`503 image_storage_unavailable` or `503 image_storage_not_configured`). A request with an image while storage is disabled creates nothing; a request without an image never touches storage and still succeeds.

**Image upload / replace / delete (ADR 0019)**

1. `PUT /items/:id/image` (Manager+) accepts multipart field `image`.
2. Verify the item exists in the authenticated store, then validate and normalize exactly as in the create path.
3. Upload under a new key. Only after the upload succeeds does a database transaction conditionally replace `image_key` and write `item.image_updated`. If the transaction fails, delete the new object best-effort.
4. After a successful commit, delete the previous key best-effort. A failed cleanup never fails the request and never restores the old key; the database stays authoritative.
5. `DELETE /items/:id/image` is idempotent: set `image_key` to null in a transaction with `item.image_removed` (written only on an actual removal), then delete the object best-effort.
6. Updates are conditional on the observed `image_key` still being current, so two concurrent uploads cannot silently overwrite each other; the loser gets `409 image_changed`.

**Cross-store safety**: every lookup is `where: { id, store_id }`. A category, item or account id from another store must behave as "not found".

Audit actions introduced:

| Action                                                                      | Entity                                                                                                               |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `item.created` / `item.updated` / `item.deactivated`                        | Item                                                                                                                 |
| `item.price_changed` (before/after)                                         | Item                                                                                                                 |
| `item.image_updated` / `item.image_removed`                                 | Item (keys only, never bytes, credentials, or signed URLs)                                                           |
| `stock.initialized` / `stock.received` / `stock.adjusted` / `stock.damaged` | Item (details include movement id; receiving details include `supplier_name` and `delivery_reference` when supplied) |
| `pos_account.created` / `pos_account.updated` / `pos_account.deactivated`   | POSAccount                                                                                                           |
| `category.created` / `category.updated`                                     | Category                                                                                                             |

Audit notes for images:

- Item creation writes a **single** `item.created` entry whose details include `has_image: true|false`. There is **no** separate `item.image_updated`/`item.image_changed` for a creation-time image. Anyone filtering the audit log solely for image-change actions will not see creation-time images; this is intentional.
- Every successful post-create upload/replacement writes `item.image_updated`; every actual removal writes `item.image_removed`.
- Every stock movement and price change is written with its audit entry in the same transaction (ADR 0011).

## 5. Seed data

The seed remains idempotent and creates missing catalog data only; it never overwrites operational item prices, stock, or POS account edits.

- Three categories (`Beverages`, `Snacks`, `Household`) and four items with stable SKUs. Seeded items have no image; the seed never requires image storage.
- Each new item gets opening stock through `StockService.initialize` (an `initial` movement), never by writing `stock_quantity` directly. Opening quantities: 48, 36, 24, and 20.
- One `POSAccount` of each type (`pos_terminal`, `bank_account`), with safe label-level `details`.
- Rerunning the seed adds no items, movements, audit rows, or POS accounts.

## 6. Acceptance checklist

- [x] Every `stock_quantity` change has a matching `StockMovement` (test by summing movements per item and comparing).
- [x] Concurrent decrements never lose updates or go negative.
- [x] Opening stock is recorded once, through an `initial` movement; a second attempt returns `409 initial_stock_exists` with the documented message.
- [x] Inactive items reject `initial`/`restock` but allow adjustment/write-off.
- [x] Reconciliation reports drift read-only and is Admin-only.
- [x] `GET /inventory/items/:id/stock-status` is Manager+, read-only, store-scoped (cross-store 404), writes no audit entry, and returns `opening_stock_allowed`.
- [x] Only `inventory/stock.service.ts` writes `stock_quantity` (architecture test).
- [x] Catalog and inventory modules do not import each other (architecture test).
- [x] POS accounts reject full card/account numbers in `details`.
- [x] Seed creates catalog items with opening movements and one POS account of each type, and is idempotent.
- [x] Images store only a key and are validated, re-encoded, and cleaned up as described in ADR 0019.
- [x] Image storage is disabled by default and never required by unit/e2e tests (`MemoryImageStorage` in tests; `IMAGE_STORAGE_DRIVER` defaults to `disabled`).
- [x] Code, Swagger, docs, and tests all use `PUT /items/:id/image` and multipart field `image` (also on `POST /items`); no `POST .../image` or `file` alias remains.
- [x] Item create with an image is all-or-nothing: a validation failure has no side effects; a storage failure creates no item; a DB failure after upload deletes the object best-effort without masking the original error.
- [x] A create with an image while storage is disabled returns `503 image_storage_not_configured` and creates nothing; a create without an image succeeds.
- [x] Concurrent image replacements cannot silently overwrite each other (loser gets `409 image_changed`); failed cleanup of the old key never fails the request.
- [x] `PATCH /items/:id` is JSON-only and rejects images, `stock_quantity`, and `current_price`.
- [x] Item create/edit and image upload/replace/remove are Manager+; category create/edit, item deactivate, and reconciliation remain Admin; cashiers cannot mutate the catalog.
- [x] Creation writes a single `item.created` audit entry with `has_image`, and no separate image audit entry.
- [x] Price change writes `PriceHistory` + `AuditLog` atomically; staff role cannot change price.
- [x] `UNIQUE(store_id, sku)` enforced; items from another store are invisible.
- [x] Catalog writes never accept stock and item creation starts at zero.
- [x] `cost_price` is omitted for cashiers at the response-shaping layer.
- [x] Category names are normalized and unique case-insensitively per store.
- [x] Price changes write history + audit atomically; unchanged price is a no-op.
- [x] Catalog lists use `{ data, meta }`, deterministic ordering with `id` last, and store scope.
- [x] `StockMovement.sale_id`/`refund_id` exist as nullable UUID columns without FKs.
- [x] No `Sale`, `Payment` or other later-phase model was added.

## 7. Open items to confirm against ADRs

- **Resolved (ADR 0018):** negative stock is never allowed, with no override.
- **Open (product follow-up, ADR 0018):** managers cannot create categories, so a manager receiving a brand-new product that also needs a brand-new category still needs an admin for the category step. If managers are later allowed to create categories, record it in a follow-up ADR or amendment.
- Fractional quantities / weighed items.
- Whether a paid-sale void restores stock and with which `reason` (the enum has no `void` value; adding one is a one-line migration but needs an ADR first).
- Future: a maintenance job to list and remove orphaned (unreferenced) provider image keys (ADR 0019).
