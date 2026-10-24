# ADR 0015: Explicit v1 Scope Boundaries

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
The pilot needs a controlled scope so core inventory, sales, payments, and cash accountability can be validated before adding broader workflows.

## Included in v1
- Staff PIN authentication, Admin/Manager/Cashier roles, session revocation and audited account lifecycle.
- Item catalog, SKU, optional barcode, price history, configurable tax support (once rules are resolved), low-stock thresholds, CSV catalog import/export.
- Audited opening-stock session, stock receiving, manual stock adjustments with reasons, partial/full stock counts, discrepancy review, and store-wide stock-count lock.
- Online-only checkout with strict non-negative stock, one payment method per sale, manual cash/card/bank-transfer recording, idempotent sale finalization, and print-friendly receipts/reprints.
- Configurable tills, cashier shifts, cash reconciliation, daily closing review/reopen workflow.
- Operational reports: sales by date range/payment method/cashier/till; shift reconciliation/discrepancies; current inventory/low stock/movement history; item quantity sold and sales totals; CSV export where appropriate.
- Append-only audit log, store timezone/currency configuration, basic monitoring, backups and recovery plan.
- One launch language, localization-ready UI; light theme only.

## Explicitly deferred or excluded from v1
- Offline cash queue (revisit after pilot validation).
- Payment gateway/webhooks.
- Split payments.
- Refunds, voids, reversals.
- Discounts and promotional/scheduled pricing.
- Purchase costs, margin, COGS.
- Supplier management and purchase orders.
- Customer profiles/accounts and default collection of customer contact data.
- Full multi-store switching, cross-store reporting, and multi-store admin experience.
- Dark mode and translated UI beyond the single launch language.
- Direct printer hardware/driver/automatic printing.
- Custom permission editor.
- Advanced dashboards/tracing.
- Automatic purchasing based on low-stock levels.

## Consequences
Requests outside this boundary require explicit scope review and, where architectural behavior changes, a new ADR.
