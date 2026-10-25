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

model Store {
  id             String   @id @default(uuid()) @db.Uuid
  name           String
  address        String?
  phone          String?
  currency       String   // ISO 4217, e.g. "NGN"
  timezone       String   // IANA, e.g. "Africa/Lagos"
  receipt_footer String?
  active         Boolean  @default(true)

  created_at     DateTime @default(now())
  updated_at     DateTime @updatedAt

  staff          Staff[]
  shifts         Shift[]
  audit_logs     AuditLog[]
}

model Staff {
  id                  String    @id @default(uuid()) @db.Uuid
  store_id            String    @db.Uuid
  staff_code          String
  name                String
  pin_hash            String
  role                StaffRole @default(staff)
  active              Boolean   @default(true)
  failed_pin_attempts Int       @default(0)
  locked_until        DateTime?

  created_at          DateTime  @default(now())
  updated_at          DateTime  @updatedAt

  store               Store      @relation(fields: [store_id], references: [id])
  shifts              Shift[]
  audit_logs          AuditLog[]

  @@unique([store_id, staff_code])
  @@index([store_id, active])
}

model Shift {
  id                   String    @id @default(uuid()) @db.Uuid
  store_id             String    @db.Uuid
  staff_id             String    @db.Uuid
  clock_in_at          DateTime  @default(now())
  clock_out_at         DateTime?
  opening_float        Int       @default(0) // minor units
  closing_cash_counted Int?                  // minor units
  opening_notes        String?
  closing_notes        String?

  created_at           DateTime  @default(now())
  updated_at           DateTime  @updatedAt

  store                Store     @relation(fields: [store_id], references: [id])
  staff                Staff     @relation(fields: [staff_id], references: [id])

  @@index([store_id, clock_in_at])
  @@index([staff_id, clock_out_at])
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

  store       Store    @relation(fields: [store_id], references: [id])
  staff       Staff?   @relation(fields: [staff_id], references: [id])

  @@index([store_id, created_at])
  @@index([store_id, entity_type, entity_id])
  @@index([store_id, staff_id, created_at])
}
```

### Deviations from the build plan

| Change                                                            | Reason                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Added `AuditLog.staff` relation to `Staff` (+ `Staff.audit_logs`) | Build plan lists `staff_id` but no FK; the relation gives integrity. Column stays nullable. |
| Added `@@index` entries                                           | Query paths for login, open-shift lookup and audit browsing.                                |

## 2. Field rules

**Store**

- Exactly one seeded row in the pilot. No owner, plan or billing columns (Phase 10).
- `currency` and `timezone` are validated at the service layer (ISO 4217 / IANA). All business-day maths uses `timezone`.

**Staff**

- Login = `staff_code` (or picking name) + PIN. `UNIQUE(store_id, staff_code)`; PINs are **not** unique.
- Store only `pin_hash`. Hash algorithm and work factor come from ADR 0004. Never log, return or audit-record a PIN or hash; exclude `pin_hash` from every entity/DTO/response.
- Failed attempts: increment `failed_pin_attempts`; when the ADR 0004 threshold is hit set `locked_until`; reset both on successful login. Thresholds and durations come from config, not literals.
- Deactivate with `active = false`; never hard-delete (history references staff).
- `role` changes are audited.

**Shift**

- Money fields are integer minor units.
- A shift is **open** while `clock_out_at IS NULL`. Clock-out sets `clock_out_at` and `closing_cash_counted`.
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

| Action                                                  | Entity | When                                                    |
| ------------------------------------------------------- | ------ | ------------------------------------------------------- |
| `auth.login_succeeded`                                  | Staff  | Successful PIN login                                    |
| `auth.login_failed`                                     | Staff  | Wrong PIN or unknown code (`entity_id` null if unknown) |
| `auth.account_locked`                                   | Staff  | Lockout triggered                                       |
| `staff.created` / `staff.updated` / `staff.deactivated` | Staff  | Admin staff management, incl. role change               |
| `shift.clock_in` / `shift.clock_out`                    | Shift  | Opening / closing a shift                               |

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

- `store_id` always comes from the JWT/auth context. Login resolves the single configured store in the pilot.
- Clock-in creates a `Shift` for the authenticated staff; reject if they already have an open shift.
- Clock-out is only allowed for the shift owner (or manager+ per ADR 0010) and only while open.
- Role guard order: authenticate → resolve store → check role. Roles are `cashier < manager < admin`.

## 5. Seed data

- One `Store` row (placeholder values, e.g. currency `NGN`, timezone `Africa/Lagos`; confirm real values).
- One initial `admin` Staff. The PIN comes from an environment variable at seed time, is hashed before insert, and is never committed to the repo.

## 6. Acceptance checklist

- [ ] Migration applies cleanly on an empty database and on a database with the seed.
- [ ] `UNIQUE(store_id, staff_code)` enforced; duplicate PINs across staff allowed.
- [ ] No response or log ever contains `pin_hash`.
- [ ] Lockout sets/clears `locked_until` and `failed_pin_attempts` correctly.
- [ ] Second concurrent clock-in for the same staff fails (DB-level, not just service check).
- [ ] `UPDATE`/`DELETE` on `AuditLog` raises.
- [ ] No Phase 2+ tables or columns were added.

## 7. Open items to confirm against ADRs

- Lockout threshold/duration and PIN hash algorithm (ADR 0004).
- Whether a staff member may hold more than one open shift (ADR 0010).
- `src/modules/devices` exists in the repo and ADR 0016 covers device access, but the build plan has no Device model. Do **not** invent one here; follow ADR 0016 if it defines persistence.
