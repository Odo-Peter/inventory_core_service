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

### Who can do what

| Action                              | Cashier | Manager | Admin |
| ----------------------------------- | :-----: | :-----: | :---: |
| Start own shift                     |   Yes   |   Yes   |  No   |
| Close own shift (normal)            |   Yes   |   Yes   |  No   |
| Force-close a cashier shift         |   No    |   Yes   |  Yes  |
| Force-close a manager shift         |   No    |   No    |  Yes  |
| Force-close an admin shift (legacy) |   No    |   No    |  Yes  |

- Cashier and Manager may start and normally close their own shift. Normal close remains self-only: neither role can close another staff member's shift through it.
- Admins administer the store but do not hold shifts. Cashier and Manager shifts own the drawer cash, so an Admin holding a shift would blur cash accountability. An Admin who tries to start or normally close a shift receives `403 forbidden`; Admins use the dedicated force-close endpoint instead.
- Force-close keeps the existing tiered rule: a Manager may force-close only Cashier shifts; an Admin may force-close a shift owned by any role. A Cashier cannot force-close anything. Force-close still requires a reason, stores it in `closing_notes`, sets `close_reason = forced`, sets `closed_by_staff_id` to the caller, and is audited.
- **Legacy admin shifts:** an Admin may already have an open shift from before this rule. It is not auto-closed and no migration is performed. The Admin can force-close it.
- **Role changes with an open shift:** changing a staff member's role while they have an open shift is rejected with `409 staff_has_open_shift` ("Close the open shift before changing this role"). This prevents a Cashier or Manager with an open shift from becoming an Admin who can no longer close it normally.
- `GET /auth/me` reports `active_shift_id: null` for Admins, including an Admin with a legacy open shift.
- Roles are read from the authenticated `Staff` row on every request, never from a token claim or request body (ADR 0004). Role changes therefore take effect immediately, and `token_version` invalidates stale tokens on deactivation, PIN changes, and security revocations.

## Consequences
- Till, shift, sale, and staff identities must be consistent across every transaction.
- Open-shift resolution is needed when a staff member is deactivated or leaves.
- Shift-close and active-sale synchronization is an explicit implementation requirement.
