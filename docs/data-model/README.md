# Data Model — Phase Index

Canonical Prisma-oriented data model for the Store Inventory & POS backend  
(NestJS + PostgreSQL + Prisma).

## How OpenCode should use these docs

1. Read `00-global-conventions.md` first.
2. Implement **only** the phase named in the task prompt.
3. Do not add later-phase tables early unless an ADR explicitly requires it.
4. Prefer service-layer `store_id` from auth context, never from untrusted input for authorization.

## Phase index

| Doc                                                                                | Phase | Models                                                  |
| ---------------------------------------------------------------------------------- | ----- | ------------------------------------------------------- |
| [00-global-conventions.md](./00-global-conventions.md)                             | —     | Cross-cutting rules                                     |
| [phase-01-store-staff-shift-audit.md](./phase-01-store-staff-shift-audit.md)       | 1     | Store, Staff, Shift, AuditLog                           |
| [phase-02-catalog-stock-pos-accounts.md](./phase-02-catalog-stock-pos-accounts.md) | 2     | Category, Item, PriceHistory, StockMovement, POSAccount |
| [phase-03-sale-cart.md](./phase-03-sale-cart.md)                                   | 3     | Sale, SaleItem                                          |
| [phase-04-05-payments-receipts.md](./phase-04-05-payments-receipts.md)             | 4–5   | Payment, Receipt                                        |
| [phase-06-reporting.md](./phase-06-reporting.md)                                   | 6     | No new tables (aggregations)                            |
| [phase-07-refunds.md](./phase-07-refunds.md)                                       | 7     | Refund, RefundItem                                      |
| [phase-09-payment-transactions.md](./phase-09-payment-transactions.md)             | 9     | PaymentTransaction                                      |
| [phase-10-multi-store-saas.md](./phase-10-multi-store-saas.md)                     | 10    | Owner/plan/billing extensions                           |

## Related ADRs

- 0004 Authentication and authorization
- 0005 Data model and store scope
- 0006 Transaction integrity and idempotency
- 0007 Inventory and stock controls
- 0008 Sales, pricing, and tax
- 0009 Payments and receipts
- 0010 Shifts, tills, and daily close
- 0011 Audit and record retention
- 0015 V1 scope boundaries
