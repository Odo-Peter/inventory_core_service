# Phase 6 — Reporting and Aggregation (no new tables)

Read `00-global-conventions.md` first.

| Item | Value |
| --- | --- |
| Build phase | 6 — Shift Summary & Sales History (reporting continues in Phase 7) |
| Depends on | Phases 1–5 |
| Models introduced | **None** |
| Schema changes allowed | Indexes only, and only if missing |
| Related ADRs | 0005, 0008, 0010 (daily close), 0011, 0014, 0017 (pagination) |
| Nest modules | `shifts` (summaries), `sales` (history); a `reports` module is acceptable if the ADRs allow it |

Do not add tables, columns or materialized views in this phase. Everything is derived from `Sale`, `SaleItem`, `Payment`, `Shift`, `Item`, `StockMovement` and `AuditLog`. When Phase 7 lands, the refund-related terms below begin to apply.

## 1. Conventions for every report

- Scope every query by `store_id` from auth.
- Business-day and "today" boundaries use `Store.timezone`, never the server clock. Convert the boundaries to UTC for filtering, or group with `date_trunc('day', ts AT TIME ZONE <store tz>)`.
- Money is integer minor units. Sums over many rows can exceed 32-bit range: aggregate in SQL (`SUM` returns `bigint`) and cast to `bigint`/`BigInt` in code; serialise as strings or numbers per the API contract (ADR 0003).
- Only finalized sales count as revenue: `status IN ('paid','partially_refunded','refunded')`. Drafts and voided sales are excluded. After Phase 7, net revenue subtracts refunds.
- Use snapshot columns (`item_name_at_sale`, `sku_at_sale`, `unit_price_at_sale`) for history and top-item reports so catalog edits never change past figures.
- Paginate with `page` (default 1, maximum 10,000) and `page_size` (default 25, maximum 100) per ADR 0017. History lists order by `(paid_at DESC, id DESC)` and return `data` plus `meta: { page, page_size, total, total_pages }`.

## 2. Shift summary and reconciliation

For shift `S` (identified by `Sale.shift_id = S`):

| Figure | Definition |
| --- | --- |
| Payments by method | `Σ Payment.amount` grouped by `method`, for payments on finalized sales with `shift_id = S` |
| Sales count / value | Count and `Σ Sale.total` of finalized sales in `S` |
| Expected cash | `Shift.opening_float + cash payments − cash refunds` |
| Variance | `Shift.closing_cash_counted − expected cash` (positive = overage) |

- Voided sales are excluded from cash payments (assumes cash is returned on void; confirm with ADR 0010).
- Cash refunds exist from Phase 7; before then the term is `0`.
- Expected cash and variance are computed on read. If ADR 0010 requires a frozen close snapshot, store it in the audit log `details` for `shift.clock_out`, not in a new column.

## 3. Sales history and search

Filters: date range (store timezone), `staff_id`, payment method (via `Payment`), item (via `SaleItem.item_id`), `status`, receipt number, client_ref. Detail view loads the sale with its lines, payments, receipt and (Phase 7) refunds. Reprint calls the Phase 4–5 receipt endpoint.

## 4. Manager dashboard and low stock

- Daily/weekly revenue: `Σ total` of finalized sales grouped by store-timezone day/ISO week.
- Top-selling items: `Σ quantity` and `Σ line_total` from `SaleItem` joined to finalized sales, grouped by `item_id` (display the latest snapshot name).
- Staff performance: count and `Σ total` grouped by `Sale.staff_id`.
- Low stock (recommended default): `stock_quantity <= reorder_threshold AND reorder_threshold > 0`, so a threshold of `0` means "no alert". Confirm; the build plan only says "falls below".

## 5. Indexes to verify before adding anything

These should already exist from earlier phases; add only what is missing, in a migration that contains nothing else.

| Query path | Index |
| --- | --- |
| Sales by day/staff | `Sale(store_id, paid_at)`, `Sale(store_id, staff_id, created_at)` |
| Shift summary | `Sale(shift_id)` |
| Payments by method/day | `Payment(store_id, method, created_at)`, `Payment(sale_id)` |
| Item history | `SaleItem(item_id)` |
| Audit browsing | `AuditLog(store_id, created_at)`; served by the Admin-only `GET /api/v1/audit-logs` read API |

## 6. Acceptance checklist

- [ ] No new models or columns; any migration contains indexes only.
- [ ] "Today" and day buckets respect `Store.timezone` (test around midnight and at a UTC offset).
- [ ] Drafts and voided sales never appear in revenue or payment totals.
- [ ] Sum of per-method payment totals equals the sum of finalized sale totals for the same shift.
- [ ] Renaming an item or changing its price does not change historical reports.
