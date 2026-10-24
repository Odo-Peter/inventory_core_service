# ADR 0008: Sales, Catalog Pricing, Tax, and Currency

- **Status:** Accepted; tax rules are an implementation prerequisite
- **Date:** 2026-10-24

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
