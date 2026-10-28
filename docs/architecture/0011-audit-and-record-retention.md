# ADR 0011: Audit Trail and Business Record Retention

- **Status:** Accepted; compliance retention period TBD
- **Date:** 2026-10-24

## Context
Inventory, cash, staff, and sales actions need to be reviewable and should not be silently rewritten.

## Decision
- Create an append-only audit log from Phase 1.
- Record actor, action, affected record, timestamp, and relevant before/after values. Include reason and reviewer/decision details for workflows that require them.
- Audit log read access is restricted to Admins. Managers and Cashiers cannot read audit entries.
- Application users cannot edit or delete audit entries. Enforce append-only behavior with application permissions and database controls where practical; do not rely on frontend hiding controls alone.
- Preserve completed sales, receipts, stock movements, shift reconciliations, and audit events in normal operation; do not automatically delete them.
- Define legal/accounting retention and privacy obligations before launch. Any required archival/deletion must be controlled and auditable and aligned with backup retention.
- Minimize customer data: no customer accounts/profiles or names, phone numbers, or email by default in v1.

## Reading audit logs

- `GET /api/v1/audit-logs` is Admin-only and always scoped to the authenticated store. `GET /api/v1/audit-logs/actions` returns the known action values for filter UIs and is also Admin-only.
- Filters: `action`, `entity_type`, `entity_id`, `staff_id`, `from` (inclusive ISO 8601 timestamp), `to` (exclusive ISO 8601 timestamp), `limit` (default 25, maximum 100), and `cursor`.
- Results are newest first using `(created_at DESC, id DESC)`. The cursor is opaque URL-safe base64 JSON containing the last row's `created_at` and `id`; malformed cursors return `400 invalid_cursor`.
- The response is `{ data, next_cursor }`. Each entry exposes `id`, `created_at`, `action`, `entity_type`, `entity_id`, an optional `actor` summary (`id`, `name`, `staff_code`, `role`), and redacted `details`. It never exposes `store_id` or raw staff relations.
- An unknown actor is represented as `actor: null`; an inactive actor still resolves by id so history remains readable.
- `details` are defensively redacted again on read: forbidden keys are dropped recursively (including inside arrays), only masked phone values are retained, and missing or non-object details become `null`.
- Reads do not create audit rows. There are no public create, update, or delete routes for audit entries.

## Consequences
- Audit events should be written in the same transaction as the business operation where appropriate.
- Access to logs and before/after values needs protection against exposing PINs, secrets, or unnecessary personal data. Read-time redaction is required even if write-time guards are bypassed by historical or directly inserted rows.
- Retention and privacy policy remain launch prerequisites.
