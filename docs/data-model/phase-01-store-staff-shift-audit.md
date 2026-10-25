# Phase 1 — Store, Staff, Shift, AuditLog

Read `00-global-conventions.md` first. Implement **only** the models in this document.

| Item                     | Value                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- |
| Build phase              | 1 — Staff & Auth                                                                |
| Depends on               | Phase 0 scaffolding (Prisma + Postgres wired, `PrismaModule` exists)            |
| Models introduced        | `Store`, `Staff`, `Shift`, `AuditLog`                                           |
| Suggested migration name | `phase_01_store_staff_shift_audit`                                              |
| Related ADRs             | 0004 auth/authorization, 0005 data model & store scope, 0010 shifts, 0011 audit |
| Nest modules             | `stores`, `auth` + `users` (aligned to `Staff`), `shifts`, `audit`              |

> Compare with the existing `prisma/schema.prisma` before editing. Extend what is there; never create a parallel `User` table (`users` module wraps `Staff`).

## 1. Prisma schema

```prisma
enum StaffRole {
  cashier
  manager
  admin
}

enum ShiftCloseReason {
  normal
  forced
  handover
}

model Store {
  id             String  @id @default(uuid()) @db.Uuid
  name           String
  address        String?
  phone          String?
  currency       String
  timezone       String
  receipt_footer String?
  active         Boolean @default(true)

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  staff      Staff[]
  shifts     Shift[]
  audit_logs AuditLog[]
}

model Staff {
  id                  String    @id @default(uuid()) @db.Uuid
  store_id            String    @db.Uuid
  staff_code          String
  name                String
  pin_hash            String
  role                StaffRole @default(cashier)
  active              Boolean   @default(true)
  failed_pin_attempts Int       @default(0)
  locked_until        DateTime?
  token_version       Int       @default(0)
  must_change_pin     Boolean   @default(false)

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  store         Store      @relation(fields: [store_id], references: [id])
  shifts        Shift[]    @relation("ShiftStaff")
  shifts_closed Shift[]    @relation("ShiftClosedBy")
  audit_logs    AuditLog[]

  @@unique([store_id, staff_code])
  @@index([store_id, active])
}

model Shift {
  id                   String            @id @default(uuid()) @db.Uuid
  store_id             String            @db.Uuid
  staff_id             String            @db.Uuid
  clock_in_at          DateTime          @default(now())
  clock_out_at         DateTime?
  opening_float        Int               @default(0) // minor units
  closing_cash_counted Int? // minor units
  opening_notes        String?
  closing_notes        String?
  closed_by_staff_id   String?           @db.Uuid
  close_reason         ShiftCloseReason?

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  store     Store  @relation(fields: [store_id], references: [id])
  staff     Staff  @relation("ShiftStaff", fields: [staff_id], references: [id])
  closed_by Staff? @relation("ShiftClosedBy", fields: [closed_by_staff_id], references: [id])

  @@index([store_id, clock_in_at])
  @@index([staff_id, clock_out_at])
  @@index([closed_by_staff_id])
}

model AuditLog {
  id          String   @id @default(uuid()) @db.Uuid
  store_id    String   @db.Uuid
  staff_id    String?  @db.Uuid
  action      String
  entity_type String
  entity_id   String?  @db.Uuid
  details     Json?
  created_at  DateTime @default(now())

  store Store  @relation(fields: [store_id], references: [id])
  staff Staff? @relation(fields: [staff_id], references: [id])

  @@index([store_id, created_at])
  @@index([store_id, entity_type, entity_id])
  @@index([store_id, staff_id, created_at])
}
```
### Deviations from the build plan

| Change                                                                       | Reason                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Added `AuditLog.staff` relation to `Staff` (+ `Staff.audit_logs`)            | Build plan lists `staff_id` but no FK; the relation gives integrity. Column stays nullable. |
| Added `@@index` entries                                                      | Query paths for login, open-shift lookup and audit browsing.                                |
| Added `Staff.token_version` and `Staff.must_change_pin`                      | ADR 0004 token revocation and forced PIN change.                                            |
| Added `Shift.closed_by_staff_id` (+ `closed_by`/`shifts_closed` relations)    | Force-close must record which manager/admin closed another staff member's shift.            |
| Added `Shift.close_reason` / `ShiftCloseReason` (`normal`, `forced`, `handover`) | Distinguish normal clock-out from manager/admin resolution.                                |
| Renamed the default role from `staff` to `cashier`                            | ADR 0004 role rename; `cashier` is the lowest role and default.                             |

## 2. Field rules

**Store**

- Exactly one seeded row in the pilot. No owner, plan or billing columns (Phase 10).
- `currency` and `timezone` are validated at the service layer (ISO 4217 / IANA). All business-day maths uses `timezone`.

**Staff**

- Login = `staff_code` + PIN. `UNIQUE(store_id, staff_code)`; PINs are **not** unique.
- Store only an argon2id `pin_hash` combined with the server-side `PIN_PEPPER`. Never log, return or audit-record a PIN or hash; exclude `pin_hash`, `token_version` and `failed_pin_attempts` from every entity/DTO/response.
- PIN policy: 4–6 digits for Cashier, exactly 6 for Manager/Admin; reject all-same and ascending/descending runs. Temporary PINs are generated with `crypto.randomInt`, shown once, and set `must_change_pin = true`.
- Failed attempts: `failed_pin_attempts` is incremented atomically with one `UPDATE ... RETURNING`, so parallel guesses cannot exceed the threshold. Lock duration escalates by attempt tier (`5, 15, 60` minutes by default). A successful login clears both fields.
- While `locked_until` is in the future, login returns `423 account_locked` with `Retry-After`; the PIN is not checked.
- `must_change_pin` blocks every authenticated route except change-PIN and logout (`403 pin_change_required`).
- `token_version` is embedded in each JWT as `tv` and checked against the database on every request. Increment it on logout, PIN change/reset, deactivation, unlock and security revocation. Roles are read from the database on every request, so role changes and deactivation take effect immediately.
- Deactivate with `active = false`; never hard-delete (history references staff). A staff member with an open shift cannot be deactivated (`409 staff_has_open_shift`).
- `role`, name, deactivation and reactivation changes are audited. Promoting a Cashier to Manager or Admin sets `must_change_pin = true` so the new 6-digit PIN rule is enforced. The last active Admin cannot be demoted (`409 last_admin`); self-deactivation is forbidden (`403 forbidden`) and is audited for every other target.
- Manager/Admin reset/unlock requires the caller's own PIN as `acting_pin`; a Manager may only reset/unlock Cashiers.

**Shift**

- Money fields are integer minor units.
- A shift is **open** while `clock_out_at IS NULL`. At most one open shift exists per staff member (DB partial unique index).
- Normal clock-out sets `clock_out_at`, `closing_cash_counted`, `closed_by_staff_id = staff_id` and `close_reason = normal`.
- Manager/Admin force-close sets `closed_by_staff_id` to the caller, `close_reason = forced`, stores the reason in `closing_notes`, and is audited. A Manager may force-close only Cashier shifts; an Admin may force-close any role. Closed shifts are immutable through this endpoint (`409 shift_not_open`).
- Expected cash and variance are **computed, never stored**:
  - `expected_cash = opening_float + cash payments − cash refunds` (payments/refunds arrive in Phases 4–7)
  - `variance = closing_cash_counted − expected_cash` (positive = overage)
- In Phase 1 only open/close and the stored fields exist; do not implement the formula yet.

**AuditLog**

- Append-only: no update or delete code paths, and enforced in the DB (below).
- `action` is a free string (not an enum) so later phases add actions without a migration. Convention: lowercase `entity.verb`.
- `details` holds before/after JSON. Never include PINs, hashes, tokens or raw provider payloads.
- `staff_id` is null for events with no known staff (e.g. login attempt with an unknown staff code).
- Write the audit row **in the same transaction** as the change it describes. Failed-login events are written outside any rolled-back transaction.

Audit actions introduced in this phase:

| Action                                                                                              | Entity | When                                                    |
| --------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `auth.login_succeeded`                                                                              | Staff  | Successful PIN login                                    |
| `auth.login_failed`                                                                                 | Staff  | Wrong PIN, wrong acting PIN, or unknown code (`entity_id` null if unknown) |
| `auth.account_locked`                                                                               | Staff  | Lockout triggered (includes tier)                       |
| `auth.unlocked` / `auth.pin_reset`                                                                  | Staff  | Manager/Admin unlock or PIN reset                       |
| `auth.logout` / `auth.pin_changed` / `auth.tokens_revoked`                                          | Staff  | Session revocation / self-service PIN change             |
| `staff.created` / `staff.updated` / `staff.role_changed` / `staff.deactivated` / `staff.reactivated` | Staff  | Admin staff management                                  |
| `shift.clock_in` / `shift.clock_out` / `shift.force_closed`                                         | Shift  | Opening, normal closing or force-closing a shift        |

## 3. DB constraints and raw SQL

Prisma cannot express these. Generate with `prisma migrate dev --create-only`, append the SQL, then apply. Do not use `db push`. Table names assume no `@@map`; adapt if the repo uses one.

```sql
-- At most one open shift per staff member (relax only if ADR 0010 allows concurrent shifts)
CREATE UNIQUE INDEX "Shift_one_open_per_staff"
  ON "Shift" ("staff_id") WHERE "clock_out_at" IS NULL;

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_opening_float_nonneg" CHECK ("opening_float" >= 0);
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closing_cash_nonneg"
  CHECK ("closing_cash_counted" IS NULL OR "closing_cash_counted" >= 0);
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_clock_order"
  CHECK ("clock_out_at" IS NULL OR "clock_out_at" >= "clock_in_at");
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_failed_attempts_nonneg" CHECK ("failed_pin_attempts" >= 0);

-- Append-only audit log
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AuditLog is append-only'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
```

E2E test cleanup must use `TRUNCATE` (row triggers do not fire on it) rather than `DELETE`.

## 4. Service-layer rules

- `store_id` always comes from the JWT/auth context. Login resolves exactly one active store in the pilot; zero or multiple active stores return `500 configuration_error`.
- Login/change-PIN run through the `ip` and `code` throttlers (defaults 10/min per IP, 5/min per `staff_code`). Unknown codes verify against a dummy hash so timing matches a wrong PIN.
- Clock-in creates a `Shift` for the authenticated staff; reject if they already have an open shift. Concurrent attempts are caught by the partial unique index and mapped to `409 staff_has_open_shift`.
- Clock-out is only allowed for the shift owner. With no own open shift, a caller gets `403 not_shift_owner` if any store shift is open, otherwise `409 no_open_shift`.
- Manager+ list shifts with keyset pagination (`limit`, `cursor`), optional `staff_id`, and inclusive `from`/`to` dates interpreted in the store timezone.
- Manager+ force-close is subject to the Manager/Cashier role rule; missing or cross-store shifts return `404 shift_not_found`.
- Role guard order: authenticate → resolve store → check role. Roles are `cashier < manager < admin`; `@Roles('manager')` means manager or above, and every route must be `@Public()` or carry `@Roles`.
- Login response contains only `access_token`, `token_type`, `expires_in` and a small staff object (`id`, `name`, `role`, `store_id`, `must_change_pin`). PIN hashes, attempt counters and token versions never leave the server.

## 5. Seed data

- One `Store` row from `SEED_STORE_NAME`, `SEED_STORE_CURRENCY` and `SEED_STORE_TIMEZONE` (placeholder values, e.g. currency `NGN`, timezone `Africa/Lagos`; confirm real values).
- One initial `admin` Staff from `SEED_ADMIN_CODE`, `SEED_ADMIN_NAME` and `SEED_ADMIN_PIN`. The PIN is hashed with argon2id + `PIN_PEPPER` before insert and is never committed to the repo.
- The seed is idempotent: it updates the existing pilot store/admin metadata but never rewrites an existing PIN hash or `token_version`. It fails fast if the PIN is weak or the secrets are missing.
- `prisma.config.ts` wires the seed command, so `npm run db:seed` is the supported entry point.

## 6. Acceptance checklist

- [x] Migration applies cleanly on an empty database and on a database with the seed.
- [x] `UNIQUE(store_id, staff_code)` enforced; duplicate PINs across staff allowed.
- [x] No response or log ever contains `pin_hash`, `token_version` or `failed_pin_attempts` (deep-scan e2e assertion).
- [x] Lockout sets/clears `locked_until` and `failed_pin_attempts` correctly, including parallel attempts and tier escalation.
- [x] Second concurrent clock-in for the same staff fails at the DB level.
- [x] Second concurrent wrong PIN cannot over-increment the attempt counter.
- [x] `UPDATE`/`DELETE` on `AuditLog` raises.
- [x] Manager/Admin reset/unlock, token invalidation and last-admin protection are covered by e2e tests.
- [x] No Phase 2+ tables or columns were added.

Run with `npm test` and `npm run test:e2e`. E2E tests require the migrated development database; they truncate `AuditLog`, `Shift`, `Staff` and `Store` between tests.

## 7. Resolved / remaining items

- Lockout threshold, durations and PIN hashing are resolved by ADR 0004 (`argon2id` + pepper; defaults 5 failures, 5/15/60 minutes).
- ADR 0010 permits only one open shift per staff member for Phase 1; the partial unique index enforces it.
- `src/modules/devices` exists in the repo and ADR 0016 covers device access, but the build plan has no Device model. Do **not** invent one here; follow ADR 0016 if it defines persistence.
