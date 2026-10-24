# ADR 0016: Dedicated POS Device and Remote Admin Access

- **Status:** Accepted intent; enrollment details to be designed
- **Date:** 2026-10-24

## Context
The pilot has one designated device for processing sales and inventory records, while an Admin may use a separate device to review store state, reconcile, and manage inventory remotely.

## Decision
- Sales checkout is restricted to the designated POS device.
- Admins may use a separate device to view store state, reconcile, receive stock, adjust inventory, manage opening stock, and initiate/confirm stock counts, subject to role authorization and audit logging.
- The stock-count lock applies across all devices in the store.
- Support controlled POS device replacement. An Admin revokes the old device and registers a replacement, assigns its till, and records reason/time and old/new device identities.
- The old device loses authority immediately after revocation.
- Checkout resumes only after the active shift has been safely reconciled and any uncertain sale request has been resolved using its idempotency key.
- Device identity and authority must be enforced by the backend, not merely by hiding frontend controls.

## Consequences
- Device registration/identity and how checkout authorization is verified must be designed before implementation.
- Device replacement is an audited operational workflow and must not erase business history.
- A remote Admin device must not accidentally gain checkout authority just because the user has an Admin role.
