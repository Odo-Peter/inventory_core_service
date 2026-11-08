# ADR 0009: Manual Payments and Print-Friendly Receipts

- **Status:** Accepted; implemented 2026-11-08
- **Date:** 2026-10-24 (accepted); 2026-11-08 (implemented)

## Context
The pilot needs reliable recording of payments without introducing payment-provider integration or hardware dependencies.

## Decision
- v1 records payments manually; no payment gateway integration.
- Each sale has exactly one payment method. Split payments are out of scope.
- Cash is always available. Admin can enable/disable card and bank transfer and configure relevant POS terminal/bank-account display details.
- A payment record must match the sale total before the sale is marked paid. Payment method/account must be valid for the store configuration.
- Receipts are generated from server-confirmed sale data and rendered in a print-friendly frontend view.
- Staff print through the browser print dialog. No direct printer hardware/driver/automatic printing integration.
- Authorized staff can retrieve/reprint completed receipts. Reprints are clearly marked as copies and preserve original sale details.
- Refund, void, and reversal workflows are deferred. Completed sales are immutable; no silent edits or deletion.

## Consequences
- Staff must manually confirm that card/transfer payments were received using the configured terminal/account.
- Payment configuration and receipt display need validation and permission controls.
- Future gateway support will require a separate ADR and provider-specific transaction/reconciliation design.

## Implementation notes (2026-11-08)

The sales transaction and receipt flow shipped in `src/modules/sales`:

- One `Payment` row per sale (`sale_id` is unique); split payments remain out of
  scope. The payment amount always equals the server-computed sale total.
- Methods are `cash`, `card`, and `bank_transfer` (the original sketch's
  `transfer` was renamed to match the POS-account type names).
- Cash must not carry a POS account. Card requires an active `pos_terminal`;
  bank transfer requires an active `bank_account`. The account label is copied
  onto the payment so later renames do not rewrite history.
- Receipts are not persisted as a separate `Receipt` row. Receipt content is
  assembled from the immutable sale snapshots plus current store details. Each
  print/reprint inserts a `ReceiptPrint` row; the first print is not an audit
  event, while every reprint writes `sale.receipt_reprinted`.
- Reprints are marked as copies and keep the original sale details. Store name,
  address, phone, currency, and footer are read at print time, so reprints
  reflect current store settings as allowed by this ADR.
- Completed sales, sale items, and payments are immutable. `BEFORE UPDATE OR
  DELETE` triggers reject raw SQL mutations in addition to the service having no
  edit/delete routes.
- Refunds, voids, tendered cash/change, and payment references remain deferred.
