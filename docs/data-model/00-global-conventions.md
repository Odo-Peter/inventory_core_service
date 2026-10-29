# Global Data Model Conventions

Applies to every phase. OpenCode must follow these rules for schema, DTOs, and services.

## Stack

- Database: PostgreSQL
- ORM: Prisma
- API: NestJS
- Pilot: single store, multi-store-ready via `store_id`

## Vocabulary: Catalog versus Inventory

- **Catalog** = what the store sells: categories, item descriptive/commercial data (name, SKU, barcode, unit, prices, reorder threshold, active flag, image), and price history.
- **Inventory** = how much the store has and why it changed: stock movements, the stock quantity cache, receiving, adjustments, damage, and reconciliation.
- `Item` is one table holding both. `stock_quantity` and `reorder_threshold` are inventory-related fields on it; everything else is catalog data.
- Catalog and inventory are separate modules with separate services and role rules. See ADR 0018.

## IDs

- Primary keys are UUIDs:
  - `id String @id @default(uuid()) @db.Uuid`
- Safe for client-generated IDs and future multi-store merges

## Money

- Store money as **integer minor units** (e.g. kobo)
- Never use floating-point for money
- Currency is defined on `Store.currency`

## Time

- Persist timestamps in UTC (`created_at`, `updated_at`)
- Business-day boundaries use `Store.timezone`, not server local time

## Tenant scope

- Every top-level entity includes `store_id`
- Child entities inherit store scope through their parent
- Services take `store_id` from the authenticated principal/token
- **Never** trust client-supplied `store_id` for authorization
- Uniqueness is per store (example: `UNIQUE(store_id, sku)`)

## Soft delete

- Prefer `active Boolean @default(true)` for entities referenced by sales/history
- Do not hard-delete catalog or account rows once referenced

## Snapshots

- Sale lines store item name, SKU, and unit price at sale time
- Catalog changes must not rewrite historical receipts or sale lines

## Enums

- Use Prisma enums for statuses and types
- Adding a value later is a migration, not a redesign

## Transactions

- Stock movement + `Item.stock_quantity` update = one DB transaction
- Sale finalize (payments cover total + stock + receipt) = one DB transaction where applicable
- Prefer idempotent writes using `client_ref` (sales) and careful unique constraints

## Audit

- `AuditLog` is append-only
- Write audit records for money-, stock-, auth-, and permission-sensitive actions

## NestJS module mapping (guidance)

| Models                                      | Module                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| Store                                       | `stores`                                                                 |
| Staff                                       | auth/`users` aligned to Staff (do not invent parallel User+Staff tables) |
| Shift                                       | `shifts`                                                                 |
| AuditLog                                    | `audit`                                                                  |
| Category, Item, PriceHistory                | `catalog`                                                                |
| StockMovement                               | `inventory`                                                              |
| POSAccount                                  | `payments`                                                               |
| Sale, SaleItem                              | `sales`                                                                  |
| Payment, Receipt, PaymentTransaction        | `payments`                                                               |
| Refund, RefundItem                          | `sales` or `payments` (choose one consistently)                          |

## Out of scope until their phase

- Do not implement later-phase models early
- Phase 9 gateway confirmation and Phase 10 SaaS fields are explicitly deferred
