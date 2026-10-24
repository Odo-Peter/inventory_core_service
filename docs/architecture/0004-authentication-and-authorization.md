# ADR 0004: Staff Authentication, Sessions, and Authorization

- **Status:** Accepted; security configuration values remain prerequisites
- **Date:** 2026-10-24

## Context
The app is used in a shared-store environment with staff PIN login, multiple roles, and separate POS/admin devices.

## Decision
- Staff authenticate with a staff code/name and a 4–6 digit PIN.
- Store only a secure hash of each PIN; never retrieve or display an existing PIN.
- Use short-lived access JWTs held in frontend memory.
- Use rotating refresh tokens in a `Secure`, `HttpOnly` cookie. Refresh tokens must be revocable on logout/session termination.
- Add server-side rate limiting, configurable temporary lockout after repeated failed PIN attempts, and security audit events. Authorized Manager/Admin can unlock after identity verification.
- Refresh-token rotation must include reuse detection and session/family revocation.
- Configure CORS, cookie attributes, and CSRF protections deliberately.
- Enforce permissions in the backend, not only in the UI.
- Roles are Admin, Manager, and Cashier. Admin manages store settings, staff, catalog, pricing, permissions, and reports. Manager manages inventory, receiving, adjustments, and reviews sales/shifts. Cashier creates sales, records payments, and views permitted sales/receipts.
- PIN reset is controlled by Manager/Admin, audited, and revokes the affected staff member's active sessions.
- Deactivation immediately blocks authentication and revokes sessions. Reactivation requires new authentication; old sessions stay revoked.
- Staff leaving must not have an active shift silently discarded; a Manager/Admin resolves it through an audited workflow.

## Consequences
- Shared-till workflows need explicit staff switching and shift handover.
- Token expiry, lockout threshold/duration, rate limits, and session expiry values must be configured before implementation/launch.
- Sensitive actions and account lifecycle changes must be auditable.
