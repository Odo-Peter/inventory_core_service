# ADR 0005: Data Conventions and Store Isolation

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
Business data must remain consistent, auditable, and scoped to the correct store.

## Decision
- Use UUID identifiers.
- Store monetary values as integer minor units, with one configured currency per store.
- Store timestamps in UTC. Use the store's configured IANA timezone for business-day boundaries, shift/daily reporting, and display.
- Every top-level business table includes `store_id` where applicable. Derive store scope from authenticated server context; never trust a client-supplied `store_id`.
- Use database constraints and indexes to reinforce business invariants.
- Deactivate/archive referenced staff and items instead of hard-deleting them. Preserve historical sales, receipts, stock movements, and audit events.
- Suggested deactivation fields are `is_active` and nullable `deactivated_at`; reactivation clears the deactivation timestamp and is audited.
- A deactivated item is unavailable for checkout. Items with remaining stock require an explicit inventory workflow before retirement.
- The schema is store-aware, but v1 is a single-store-focused experience with no store switching or cross-store reports.

## Initial core entities
Store, Staff, Shift, Till, Category, Item, PriceHistory, StockMovement, StockReceivingSession/records as needed, StockCountSession/records as needed, POSAccount, Sale, SaleItem, Payment, Receipt, AuditLog, and device registration/identity records as needed by the device design.

## Consequences
- Store isolation is a backend authorization invariant, not a frontend filter.
- Currency and timezone are store configuration, not device preferences.
- Schema should support future multi-store operation without exposing cross-store UI in v1.
