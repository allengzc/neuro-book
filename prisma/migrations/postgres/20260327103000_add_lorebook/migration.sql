-- CreateEnum
CREATE TYPE "LorebookType" AS ENUM ('location', 'item', 'character', 'rule', 'note');

-- CreateEnum
CREATE TYPE "LorebookStatus" AS ENUM ('active', 'draft', 'deprecated', 'archived');

-- CreateEnum
CREATE TYPE "LorebookSource" AS ENUM ('user', 'agent', 'imported');

-- CreateEnum
CREATE TYPE "LorebookReview" AS ENUM ('approved', 'proposed', 'rejected');

-- CreateTable
CREATE TABLE "LorebookEntry" (
    "id" SERIAL NOT NULL,
    "novelId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "type" "LorebookType" NOT NULL,
    "subtype" TEXT,
    "status" "LorebookStatus" NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retrievalKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "retrievalTip" TEXT,
    "source" "LorebookSource" NOT NULL DEFAULT 'user',
    "review" "LorebookReview" NOT NULL DEFAULT 'approved',
    "writingTip" TEXT,
    "ext" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LorebookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LorebookRef" (
    "id" SERIAL NOT NULL,
    "entryId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "rawTarget" TEXT NOT NULL,
    "targetEntryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LorebookRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LorebookEntry_novelId_path_key" ON "LorebookEntry"("novelId", "path");

-- CreateIndex
CREATE INDEX "LorebookEntry_novelId_parentId_sortOrder_idx" ON "LorebookEntry"("novelId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "LorebookEntry_novelId_type_status_idx" ON "LorebookEntry"("novelId", "type", "status");

-- CreateIndex
CREATE INDEX "LorebookEntry_novelId_updatedAt_idx" ON "LorebookEntry"("novelId", "updatedAt");

-- CreateIndex
CREATE INDEX "LorebookRef_entryId_sortOrder_idx" ON "LorebookRef"("entryId", "sortOrder");

-- CreateIndex
CREATE INDEX "LorebookRef_targetEntryId_idx" ON "LorebookRef"("targetEntryId");

-- AddForeignKey
ALTER TABLE "LorebookEntry" ADD CONSTRAINT "LorebookEntry_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LorebookEntry" ADD CONSTRAINT "LorebookEntry_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "LorebookEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LorebookRef" ADD CONSTRAINT "LorebookRef_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "LorebookEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LorebookRef" ADD CONSTRAINT "LorebookRef_targetEntryId_fkey" FOREIGN KEY ("targetEntryId") REFERENCES "LorebookEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTrigger
CREATE TRIGGER "LorebookEntry_set_updated_at"
BEFORE UPDATE ON "LorebookEntry"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- CreateTrigger
CREATE TRIGGER "LorebookRef_set_updated_at"
BEFORE UPDATE ON "LorebookRef"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
