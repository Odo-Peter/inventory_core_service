-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('cashier', 'manager', 'admin');

-- CreateEnum
CREATE TYPE "ShiftCloseReason" AS ENUM ('normal', 'forced', 'handover');

-- CreateTable
CREATE TABLE "Store" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "receipt_footer" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "staff_code" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'cashier',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failed_pin_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "must_change_pin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "clock_in_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clock_out_at" TIMESTAMP(3),
    "opening_float" INTEGER NOT NULL DEFAULT 0,
    "closing_cash_counted" INTEGER,
    "opening_notes" TEXT,
    "closing_notes" TEXT,
    "closed_by_staff_id" UUID,
    "close_reason" "ShiftCloseReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "staff_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Staff_store_id_active_idx" ON "Staff"("store_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_store_id_staff_code_key" ON "Staff"("store_id", "staff_code");

-- CreateIndex
CREATE INDEX "Shift_store_id_clock_in_at_idx" ON "Shift"("store_id", "clock_in_at");

-- CreateIndex
CREATE INDEX "Shift_staff_id_clock_out_at_idx" ON "Shift"("staff_id", "clock_out_at");

-- CreateIndex
CREATE INDEX "Shift_closed_by_staff_id_idx" ON "Shift"("closed_by_staff_id");

-- CreateIndex
CREATE INDEX "AuditLog_store_id_created_at_idx" ON "AuditLog"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_store_id_entity_type_entity_id_idx" ON "AuditLog"("store_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "AuditLog_store_id_staff_id_created_at_idx" ON "AuditLog"("store_id", "staff_id", "created_at");

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closed_by_staff_id_fkey" FOREIGN KEY ("closed_by_staff_id") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 1 raw-SQL constraints (Prisma cannot express these)

-- At most one open shift per staff member.
CREATE UNIQUE INDEX "Shift_one_open_per_staff"
  ON "Shift" ("staff_id") WHERE "clock_out_at" IS NULL;

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_opening_float_nonneg" CHECK ("opening_float" >= 0);
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_closing_cash_nonneg"
  CHECK ("closing_cash_counted" IS NULL OR "closing_cash_counted" >= 0);
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_clock_order"
  CHECK ("clock_out_at" IS NULL OR "clock_out_at" >= "clock_in_at");
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_failed_attempts_nonneg" CHECK ("failed_pin_attempts" >= 0);

-- Append-only audit log.
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AuditLog is append-only'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
