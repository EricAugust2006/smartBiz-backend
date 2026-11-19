ALTER TABLE "products"
  ALTER COLUMN "quantity" TYPE DECIMAL(12, 3) USING "quantity"::DECIMAL(12, 3),
  ALTER COLUMN "minQuantity" TYPE DECIMAL(12, 3) USING "minQuantity"::DECIMAL(12, 3),
  ALTER COLUMN "costPrice" TYPE DECIMAL(10, 2) USING ROUND("costPrice"::numeric, 2);

ALTER TABLE "products"
  RENAME COLUMN "expirationDate" TO "expiresAt";
  
ALTER TABLE "products"
  ADD COLUMN "trackStock" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "transaction_items"
  ALTER COLUMN "productId" DROP NOT NULL,
  ALTER COLUMN "quantity" TYPE DECIMAL(12, 3) USING "quantity"::DECIMAL(12, 3);
