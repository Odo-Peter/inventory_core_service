-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM ('initial', 'restock', 'sale', 'refund', 'adjustment', 'damage');

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity_change" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "sale_id" UUID,
    "refund_id" UUID,
    "staff_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_store_id_item_id_created_at_idx" ON "StockMovement"("store_id", "item_id", "created_at");

-- CreateIndex
CREATE INDEX "StockMovement_sale_id_idx" ON "StockMovement"("sale_id");

-- CreateIndex
CREATE INDEX "StockMovement_refund_id_idx" ON "StockMovement"("refund_id");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 2b raw-SQL constraints (Prisma cannot express these)

ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_sign_by_reason" CHECK (
  ("reason" IN ('initial','restock','refund') AND "quantity_change" > 0) OR
  ("reason" IN ('sale','damage')              AND "quantity_change" < 0) OR
  ("reason" = 'adjustment'                    AND "quantity_change" <> 0)
);

-- Opening stock is a one-time operation per item.
CREATE UNIQUE INDEX "StockMovement_one_initial_per_item"
  ON "StockMovement" ("item_id") WHERE "reason" = 'initial';
