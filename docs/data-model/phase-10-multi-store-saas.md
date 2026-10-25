# Phase 10 — Multi-Store / SaaS Conversion (deferred)

Read `00-global-conventions.md` first. **Do not implement or pre-build any of this** until the pilot shop has run successfully for a meaningful period and an ADR explicitly starts the phase.

| Item | Value |
| --- | --- |
| Build phase | 10 (future) |
| Depends on | Pilot in production; Phases 1–8 stable |
| Models introduced | Likely `Subscription` (name and shape to be decided) |
| Related ADRs | 0005 (store scope), 0004, 0011, 0015 (scope boundaries); a new ADR is required |

This document is **indicative, not canonical**. The build plan only says: extend `Store` with owner, plan/tier and status; add email/password login for store owners; add per-store subscriptions; resolve the store at login; add a super-admin view. The fields below are a starting sketch to be settled by an ADR.

## 1. Principle: additive only

`store_id` already exists on every tenant table, so conversion is additive: nullable columns and new tables, no rewrites of existing models.

## 2. Indicative schema sketch

```prisma
// Store: new nullable/defaulted columns (names indicative)
//   slug            String?  @unique   // store code or subdomain used to resolve the store at login
//   status          <enum>             // e.g. trial / active / suspended / closed
//   plan            <enum or FK>
//   trial_ends_at   DateTime?
//   owner_staff_id  String?  @db.Uuid  // or an owner role on Staff; decide in the ADR

// Staff: new nullable columns for owner login
//   email           String?
//   password_hash   String?
//   @@unique([store_id, email]) or global unique email (decide)

// Subscription (new): store_id, plan, status, period start/end, provider ids
```

Rules to preserve:
- PIN login for counter staff stays as is; email/password is only for owners.
- Billing for the SaaS is separate from in-store `Payment`/`PaymentTransaction`. Do not reuse those tables.
- `Store.currency` and `Store.timezone` remain per store.

## 3. Tenancy hardening (the real work of this phase)

- Resolve the store at login (store code or subdomain), replacing the single configured store.
- Every query already filters by `store_id` from auth; add automated tests that attempt to read and write another store's rows through every endpoint.
- Consider Postgres row-level security as a second safety net (e.g. a per-request `SET LOCAL app.store_id`), keeping the service-layer filter as the primary control.
- Add a super-admin surface across stores with its own audited role, not a bypass flag on normal staff.
- Review uniqueness that is currently global by accident (e.g. any index lacking `store_id`).

## 4. Reserved extension points (reference only, from the build plan)

None of these are in scope until separately requested. Each is designed to plug in without reworking existing tables.

| Future need | What gets added | Existing tables touched |
| --- | --- | --- |
| Customer records / loyalty | `Customer` (name, phone, points) | `Sale.customer_id` (nullable) |
| Multiple tills | `Register` | `Shift.register_id` (nullable) |
| Several branches per owner | `Location` | `location_id` on `Shift`, `Sale`, `StockMovement`; per-location stock table replaces `Item.stock_quantity` |
| Product variants | `ItemVariant` | `SaleItem.variant_id`; stock per variant |
| Tax / VAT rules | `TaxRate` | `SaleItem.tax_amount` (`Sale.tax_total` already exists) |
| Suppliers / purchase orders | `Supplier`, `PurchaseOrder` | `StockMovement.purchase_order_id` |
| Webhook payments | `PaymentTransaction` | none (Phase 9) |
| Owner login, plans, billing | `Subscription`, email/password fields | `Store`, `Staff` nullable columns |

ADR 0010 mentions tills; the build plan defers `Register`. Do not add it ahead of this table.

## 5. Migration approach

- Backfill the single pilot store as tenant #1; no data moves.
- Ship new columns as nullable, backfill, then tighten constraints in a later migration.
- Keep the pilot store's behaviour identical throughout.

## 6. Acceptance checklist (when the phase is started)

- [ ] An ADR defines owner model, plan/status enums and store resolution.
- [ ] Cross-tenant access tests pass for every module.
- [ ] Existing single-store flows are unchanged for the pilot store.
- [ ] No speculative tables from §4 were added unless separately requested.
