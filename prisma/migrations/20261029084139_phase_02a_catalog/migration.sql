-- CreateTable
CREATE TABLE "Category" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "unit" TEXT NOT NULL,
    "current_price" INTEGER NOT NULL,
    "cost_price" INTEGER,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "reorder_threshold" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "old_price" INTEGER NOT NULL,
    "new_price" INTEGER NOT NULL,
    "changed_by_staff_id" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Category_store_id_active_idx" ON "Category"("store_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Category_store_id_name_key" ON "Category"("store_id", "name");

-- CreateIndex
CREATE INDEX "Item_store_id_category_id_idx" ON "Item"("store_id", "category_id");

-- CreateIndex
CREATE INDEX "Item_store_id_active_idx" ON "Item"("store_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Item_store_id_sku_key" ON "Item"("store_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "Item_store_id_barcode_key" ON "Item"("store_id", "barcode");

-- CreateIndex
CREATE INDEX "PriceHistory_item_id_changed_at_idx" ON "PriceHistory"("item_id", "changed_at");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_changed_by_staff_id_fkey" FOREIGN KEY ("changed_by_staff_id") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 2a raw-SQL constraints (Prisma cannot express these)

-- Category names are normalized (trimmed and whitespace-collapsed) in the
-- service; uniqueness is case-insensitive per store.
CREATE UNIQUE INDEX "Category_store_id_lower_name_key"
  ON "Category" ("store_id", lower("name"));

ALTER TABLE "Item" ADD CONSTRAINT "Item_prices_nonneg"
  CHECK ("current_price" >= 0 AND ("cost_price" IS NULL OR "cost_price" >= 0));
ALTER TABLE "Item" ADD CONSTRAINT "Item_reorder_nonneg"
  CHECK ("reorder_threshold" >= 0);
ALTER TABLE "Item" ADD CONSTRAINT "Item_stock_nonneg"
  CHECK ("stock_quantity" >= 0);

ALTER TABLE "PriceHistory" ADD CONSTRAINT "PriceHistory_nonneg_changed"
  CHECK ("old_price" >= 0 AND "new_price" >= 0 AND "old_price" <> "new_price");
