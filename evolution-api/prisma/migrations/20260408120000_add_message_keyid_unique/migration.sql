-- Step 1: Add the keyId column (nullable initially)
ALTER TABLE "Message" ADD COLUMN "keyId" VARCHAR(100);

-- Step 2: Backfill keyId from the JSONB key field
UPDATE "Message" SET "keyId" = "key"->>'id' WHERE "keyId" IS NULL;

-- Step 3: Remove duplicates — keep the row with the latest messageTimestamp per (instanceId, keyId)
DELETE FROM "Message" a
USING "Message" b
WHERE a."instanceId" = b."instanceId"
  AND a."keyId" = b."keyId"
  AND a."keyId" IS NOT NULL
  AND (
    a."messageTimestamp" < b."messageTimestamp"
    OR (a."messageTimestamp" = b."messageTimestamp" AND a."id" < b."id")
  );

-- Step 4: Create the unique index (allows NULLs to coexist for safety)
CREATE UNIQUE INDEX "Message_instanceId_keyId_key" ON "Message"("instanceId", "keyId");

-- Step 5: Additional performance indexes for message queries
CREATE INDEX "Message_instanceId_keyId_idx" ON "Message"("instanceId", "keyId");
CREATE INDEX "Message_instanceId_messageTimestamp_idx" ON "Message"("instanceId", "messageTimestamp" DESC);
