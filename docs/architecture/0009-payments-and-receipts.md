# ADR 0009: Manual Payments and Print-Friendly Receipts

- **Status:** Accepted
- **Date:** 2026-10-24

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
