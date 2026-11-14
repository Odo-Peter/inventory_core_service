# ADR 0008: Sales, Catalog Pricing, Tax, and Currency

- **Status:** Accepted; implemented 2026-11-08 with tax calculation deferred
- **Date:** 2026-10-24 (accepted); 2026-11-08 (implemented)

## Context
Receipts and historical reporting must remain stable after catalog settings change.

## Decision
- Each sellable item has its own SKU, name, selling price, stock tracking, and optional barcode. Variants are separate inventory items; no parent/child variant system in v1.
- Every price change records old price, new price, actor, and timestamp in price history.
- Completed sale items snapshot unit price and tax details so later changes cannot alter past receipts/reports.
- Tax support is configurable per store. The store chooses tax-inclusive or tax-exclusive pricing. A completed sale snapshots pricing mode, applicable rate, and calculated amounts.
- Do not hardcode a tax rate or assume a jurisdiction. Exact tax rules, calculation method, rounding, and receipt presentation must be agreed before implementing tax calculations.
- One currency per store. All prices, taxes, payments, and receipts use it; multi-currency is out of scope.
- No discounts or scheduled/promotional pricing in v1.
- Item cost, profit margin, and COGS are deferred.
- Per-item low-stock threshold is configurable; items at or below the threshold appear in low-stock reporting. Items without a threshold are excluded.

## Consequences
- Tax jurisdiction and rounding are launch-blocking decisions for correct financial records.
- Sale snapshots are required even when a catalog item is deactivated or repriced.
- Currency-aware formatting must be centralized and use the configured store currency.

## Implementation notes (2026-11-08)

Phase 3 shipped the completed-sale path in `src/modules/sales`. The implemented
shape is deliberately smaller than the draft-cart data model originally sketched
for this phase:

- A sale is created complete, in one transaction, from `POST /api/v1/sales`. There
  is no draft/cart table, no `SaleStatus`, and no sale/line editing endpoints.
- The server snapshots `sku`, `name`, `unit`, `unit_price`, `quantity`,
  `tax_amount`, and `line_total` onto each `SaleItem`. Catalog changes after the
  sale cannot alter receipt or reporting data.
- Totals are always computed on the server. The client sends `expected_total`
  only as a stale-cart sanity check; a mismatch is rejected with
  `total_mismatch`.
- `Store.sale_counter` allocates the per-store `Sale.receipt_number` inside the
  sale transaction. There is no separate receipt table; receipt content is
  derived at read time.
- `tax_total` remains in the model but is always `0` until tax rules are agreed.
  No tax-inclusive/exclusive setting was invented.
- Discounts, promotions, COGS, and refunds/voids remain out of scope.
- Money stays integer minor units (kobo) as agreed.
- The seven-day dashboard aggregate (`GET /api/v1/sales/overview`) groups
  completed sales by business day in the store's configured timezone, not UTC.

See `docs/data-model/phase-03-sale-cart.md` and
`docs/data-model/phase-04-05-payments-receipts.md` for the field-level
deviations from the original phase documents.
