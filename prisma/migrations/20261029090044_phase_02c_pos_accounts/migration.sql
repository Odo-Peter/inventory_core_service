-- CreateEnum
CREATE TYPE "POSAccountType" AS ENUM ('pos_terminal', 'bank_account');

-- CreateTable
CREATE TABLE "POSAccount" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "type" "POSAccountType" NOT NULL,
    "details" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_staff_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "POSAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "POSAccount_store_id_active_idx" ON "POSAccount"("store_id", "active");

-- AddForeignKey
ALTER TABLE "POSAccount" ADD CONSTRAINT "POSAccount_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POSAccount" ADD CONSTRAINT "POSAccount_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
