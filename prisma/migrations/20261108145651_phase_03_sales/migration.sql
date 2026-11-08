-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'bank_transfer');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "sale_counter" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Sale" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "receipt_number" INTEGER NOT NULL,
    "shift_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "tax_total" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "line_total" INTEGER NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" INTEGER NOT NULL,
    "pos_account_id" UUID,
    "account_label" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptPrint" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "staff_id" UUID,
    "printed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptPrint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sale_store_id_created_at_idx" ON "Sale"("store_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Sale_store_id_staff_id_created_at_idx" ON "Sale"("store_id", "staff_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "Sale_shift_id_idx" ON "Sale"("shift_id");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_store_id_receipt_number_key" ON "Sale"("store_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_store_id_idempotency_key_key" ON "Sale"("store_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "SaleItem_item_id_idx" ON "SaleItem"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_sale_id_item_id_key" ON "SaleItem"("sale_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_sale_id_key" ON "Payment"("sale_id");

-- CreateIndex
CREATE INDEX "ReceiptPrint_sale_id_printed_at_idx" ON "ReceiptPrint"("sale_id", "printed_at");

-- CreateIndex
CREATE INDEX "StockMovement_store_id_created_at_idx" ON "StockMovement"("store_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "StockMovement_store_id_reason_created_at_idx" ON "StockMovement"("store_id", "reason", "created_at" DESC);

-- Clear orphaned sale references left by pre-FK test data before enforcing the FK.
UPDATE "StockMovement" sm
SET "sale_id" = NULL
WHERE sm."sale_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "Sale" s WHERE s."id" = sm."sale_id");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_pos_account_id_fkey" FOREIGN KEY ("pos_account_id") REFERENCES "POSAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptPrint" ADD CONSTRAINT "ReceiptPrint_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptPrint" ADD CONSTRAINT "ReceiptPrint_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 3 raw-SQL constraints (Prisma cannot express these)

-- Completed sales and their financial records are immutable (ADR 0009).
CREATE FUNCTION forbid_sale_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sale_no_update_delete"
  BEFORE UPDATE OR DELETE ON "Sale"
  FOR EACH ROW EXECUTE FUNCTION forbid_sale_mutation();

CREATE TRIGGER "SaleItem_no_update_delete"
  BEFORE UPDATE OR DELETE ON "SaleItem"
  FOR EACH ROW EXECUTE FUNCTION forbid_sale_mutation();

CREATE TRIGGER "Payment_no_update_delete"
  BEFORE UPDATE OR DELETE ON "Payment"
  FOR EACH ROW EXECUTE FUNCTION forbid_sale_mutation();
