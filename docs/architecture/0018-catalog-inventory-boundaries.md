# ADR 0018: Catalog and Inventory Boundaries

- **Status:** Accepted
- **Date:** 2026-10-29
- **Extends:** ADR 0007 (Inventory Movements, Stock Receiving, and Stock Counts)
- **Supersedes:** nothing

## Context

Phase 2 introduces both descriptive product data and stock control. Treating them as one undifferentiated "inventory" module makes it too easy for ordinary catalog edits to write stock directly, and it hides the different permissions and audit needs of each concern. ADR 0007 already says the movement history is the canonical explanation of stock changes. This ADR makes that rule structural.

## Definitions

- **Catalog** is what the store sells: categories, item descriptive and commercial data (name, SKU, barcode, unit, prices, reorder threshold, active flag, and image), and price history.
- **Inventory** is how much the store has and why it changed: stock movements, the stock quantity cache, receiving, adjustments, damage, and reconciliation.
- `Item` is one table holding both concerns. `stock_quantity` and `reorder_threshold` are inventory-related fields on it. Everything else on `Item` is catalog data.

## Decision

### Separate modules

- Catalog lives in `src/modules/catalog/`; inventory lives in `src/modules/inventory/`.
- Neither module imports the other in either direction. They share only `PrismaService` and code under the repository's common/shared locations.
- Inventory looks up items with its own store-scoped Prisma query. Catalog never calls into inventory.
- The modules expose different Swagger tags (`Catalog`, `Inventory`) and different role rules.

### Stock is a derived cache

- `Item.stock_quantity` is a cache derived from the sum of that item's `StockMovement.quantity_change` rows.
- Only `inventory/stock.service.ts` may write `stock_quantity`. No other file may use `increment`, `decrement`, or `set` on it in Prisma or raw SQL. Reads, `select`, and `where` are allowed anywhere.
- Every stock-changing operation goes through one `StockService` method so a future stock-count lock check can be added in a single place. The method inserts the movement, updates the cache atomically, and writes the audit row in one transaction. Decrements use a guarded update and fail with `409 insufficient_stock` rather than allowing a negative cache.
- Negative stock is forbidden with no override. The database enforces this with `Item_stock_nonneg`; ADR 0007's strict-stock rule wins over any looser phase text.

### Movement contract (Slice 2b)

- `StockService.applyMovement` is the single writer. Specialized public methods (`initialize`, `receive`, `adjust`, `recordDamage`) translate DTOs into movements; future sales/refunds call `applyMovement` with `sale`/`refund` and their own audit action, so stock still has one writer.
- Each call runs `SELECT ... FOR UPDATE` on the store-scoped item, validates reason/sign/active/opening-stock rules, inserts the movement, applies a guarded atomic cache update, and writes the audit row, all in one transaction. A failed guarded decrement returns `409 insufficient_stock` and rolls back the movement and audit.
- Quantity is signed in the database and in the API: `initial`/`restock`/`refund` are positive, `sale`/`damage` negative, `adjustment` non-zero. The damage endpoint takes a positive quantity and stores the negative movement.
- `initial` is allowed once per item. A partial unique index (`StockMovement_one_initial_per_item`) backs the service check. After the first successful `initial`, any further attempt returns:
  - status `409`
  - code `initial_stock_exists`
  - message: `"Opening stock was already recorded for this item. Use receive stock to add more."`
    Subsequent deliveries must use `receive` (restock). The UI must make this distinction clear so managers do not repeatedly hit the 409.
- `initial` and `restock` reject inactive items with a clear `409 item_inactive` message; `adjustment` and `damage` stay available so leftover stock can be written off.
- Notes are optional for every reason. Receiving's `supplier_name` and `delivery_reference` are audit details, not columns.

### Stock-status endpoint (inventory)

- Determining whether opening stock is still allowed requires reading movement data. Catalog code is not permitted to read movements.
- Therefore the inventory module owns:
  - `GET /api/v1/inventory/items/:id/stock-status`
  - Manager+, read-only, store-scoped (cross-store → 404), no audit entry.
- The response supplies the data the UI needs to choose between “Set opening stock” and “Receive stock” before the user issues a mutating request (including at least `opening_stock_allowed` and related status flags).

### Reconciliation is detect-only

- `GET /inventory/reconciliation` is an Admin-only, read-only, store-scoped, paginated report of items whose `stock_quantity` differs from the sum of their movements.
- It also reports items that have stock but no movements. It never repairs drift.
- A human corrects drift with an explicit `adjustment` movement through `StockService`, which keeps the canonical history complete.

### Opening stock is a separate inventory step

- Creating an item never accepts or writes stock. Item creation is a catalog operation and always starts at `stock_quantity = 0`.
- Opening stock is a dedicated inventory call that writes an `initial` movement through `StockService`. It is allowed only when the item has no prior movements.
- This keeps the catalog module from writing stock and matches ADR 0007's dedicated opening-stock step. It is a deliberate deviation from the Phase 2 document's earlier "create with opening stock" suggestion.

### Role split

- Catalog reads are available to every authenticated role. Cashiers remain read-only on catalog mutations.
- Item create (`POST /items`, including optional image) and edit (`PATCH /items/:id`) are **Manager+**. This is a deliberate product decision so managers who handle deliveries can add a product and stock it without waiting for an admin.
- Unchanged:
  - `POST /items/:id/price` — Manager+
  - `POST /items/:id/deactivate` — Admin
  - Category create/edit/delete (`POST`/`PATCH` on categories) — Admin
  - Reconciliation — Admin
- Managers therefore cannot create categories; they can only assign existing ones. This remains an open product question: if managers should later be allowed to create categories, that decision will be recorded in a follow-up ADR or amendment.
- `cost_price` is margin data and is omitted from cashier responses at the response-shaping layer.
- Inventory mutations (receive, adjust, damage, initialize) are Manager or Admin. Cashiers have no inventory endpoints.
- POS account setup is Manager or Admin only, consistent with ADR 0004.
- Image upload, replace, and remove (see ADR 0019) are also Manager+.
- Roles are enforced through the existing roles mechanism; services that already perform a defensive role check continue to do so.

### PATCH stays JSON-only

- `PATCH /items/:id` accepts JSON only, rejects `stock_quantity` and `current_price`, and never accepts an image. Changing both descriptive fields and the image requires two separate calls (`PATCH` + the image endpoint from ADR 0019). Both are idempotent, so this is acceptable for Phase 2.

### Enforcement

- A guard test scans `src` and fails if any file other than `inventory/stock.service.ts` writes `stock_quantity`.
- A guard test fails if any file under `catalog` imports from `inventory` or the reverse.
- Database CHECK constraints enforce non-negative prices, thresholds, stock, and price-history changes; `StockMovement_sign_by_reason` enforces the sign rules; `Item_stock_nonneg` enforces strict stock; `StockMovement_one_initial_per_item` enforces one opening movement.
- Every stock movement and price change is written with its audit entry in the same transaction (ADR 0011).

## Consequences

- Catalog and inventory can evolve independently and are tested independently.
- Stock quantity is intentionally redundant. Any direct database edit can make it drift; reconciliation detects that drift but does not hide it.
- Future sale and refund finalization must call `StockService.applyMovement` with the existing `sale` and `refund` reasons and their own audit actions instead of writing stock directly.
- ADR 0007's stock-count sessions, opening-stock sessions, and store-wide count lock are not modelled in Phase 2. The single-writer service method is the extension point for the count-lock check when those models are built.
- Managers who handle deliveries can now create the item and immediately perform the opening-stock (`initial`) or subsequent receive steps without waiting for an admin (provided the category already exists).
- Clients and the UI must treat `initial` as a one-time operation and route all later deliveries through `receive`; the API returns a clear 409 message when a second `initial` is attempted. The inventory stock-status endpoint supplies the data needed to present the correct action up front.
- Creation of an item that includes an image is all-or-nothing (see ADR 0019); a storage outage cannot produce an item that the user expected to have a photo.
- Open question (recorded for product follow-up): managers cannot create categories, so a manager receiving a brand-new product that also requires a brand-new category still needs an admin for the category step.
