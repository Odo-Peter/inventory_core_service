# ADR 0011: Audit Trail and Business Record Retention

- **Status:** Accepted; compliance retention period TBD
- **Date:** 2026-10-24

## Context
Inventory, cash, staff, and sales actions need to be reviewable and should not be silently rewritten.

## Decision
- Create an append-only audit log from Phase 1.
- Record actor, action, affected record, timestamp, and relevant before/after values. Include reason and reviewer/decision details for workflows that require them.
- Audit log is accessible to Admins and Managers.
- Application users cannot edit or delete audit entries. Enforce append-only behavior with application permissions and database controls where practical; do not rely on frontend hiding controls alone.
- Preserve completed sales, receipts, stock movements, shift reconciliations, and audit events in normal operation; do not automatically delete them.
- Define legal/accounting retention and privacy obligations before launch. Any required archival/deletion must be controlled and auditable and aligned with backup retention.
- Minimize customer data: no customer accounts/profiles or names, phone numbers, or email by default in v1.

## Consequences
- Audit events should be written in the same transaction as the business operation where appropriate.
- Access to logs and before/after values needs protection against exposing PINs, secrets, or unnecessary personal data.
- Retention and privacy policy remain launch prerequisites.
