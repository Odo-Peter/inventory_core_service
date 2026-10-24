# ADR 0010: Tills, Cashier Shifts, and Daily Closing

- **Status:** Accepted
- **Date:** 2026-10-24

## Context
Cash accountability requires explicit ownership of a till and a record of opening and closing cash.

## Decision
- Stores may configure multiple tills, for example “Front Counter” and “Checkout 2”.
- Each shift belongs to one till. Only one active shift is allowed per till; separate tills may operate concurrently.
- A shift opens with an opening cash float. Sales and relevant actions are linked to the authenticated staff member, active shift, and till.
- Shift closure records counted cash. Expected cash is calculated from opening float and cash transactions; card and bank transfer are not physical cash.
- A shift cannot close while sale finalization is in progress. The exact concurrency/locking workflow must be designed and tested.
- Staff switching requires the outgoing cashier to close the shift and record the cash count, then the incoming cashier opens a new shift and records opening cash.
- Allow shift closure despite a cash discrepancy, but require an explanation. Preserve counted cash, expected cash, difference, explanation, cashier, and timestamps. Flag for Manager review; no approval is required before close.
- Manager/Admin may review discrepancies. No silent adjustment of sales, payments, or inventory is permitted.
- Provide daily sales closing review. Manager/Admin reviews totals by payment method, cashier, and till, shift closures/discrepancies, and inventory exceptions; record reviewer and signoff time.
- Daily close does not shut down the system or block the next business day. Store timezone defines the business day.
- Reopening a daily close requires Admin/Manager authority and a mandatory reason. Preserve the original signoff and reopening event; sign off again after review. Any corrections are separately audited.

## Consequences
- Till, shift, sale, and staff identities must be consistent across every transaction.
- Open-shift resolution is needed when a staff member is deactivated or leaves.
- Shift-close and active-sale synchronization is an explicit implementation requirement.
