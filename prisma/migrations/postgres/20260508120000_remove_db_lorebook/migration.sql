-- Move Plot refs from database LorebookEntry targets to workspace content-node paths.
UPDATE "StoryThreadRef" AS ref
SET
    "rawTarget" = entry."path"
FROM "LorebookEntry" AS entry
WHERE ref."targetLorebookEntryId" = entry."id";

UPDATE "StorySceneRef" AS ref
SET
    "rawTarget" = entry."path"
FROM "LorebookEntry" AS entry
WHERE ref."targetLorebookEntryId" = entry."id";

ALTER TABLE "StoryThreadRef" DROP CONSTRAINT IF EXISTS "StoryThreadRef_targetLorebookEntryId_fkey";
ALTER TABLE "StorySceneRef" DROP CONSTRAINT IF EXISTS "StorySceneRef_targetLorebookEntryId_fkey";

DROP INDEX IF EXISTS "StoryThreadRef_targetLorebookEntryId_idx";
DROP INDEX IF EXISTS "StorySceneRef_targetLorebookEntryId_idx";

ALTER TABLE "StoryThreadRef" DROP COLUMN IF EXISTS "targetLorebookEntryId";
ALTER TABLE "StorySceneRef" DROP COLUMN IF EXISTS "targetLorebookEntryId";

-- pending refs are obsolete and cannot be represented as content-node refs.
DELETE FROM "StoryThreadRef" WHERE "targetKind"::text = 'pending';
DELETE FROM "StorySceneRef" WHERE "targetKind"::text = 'pending';

DROP TRIGGER IF EXISTS "LorebookRef_set_updated_at" ON "LorebookRef";
DROP TRIGGER IF EXISTS "LorebookEntry_set_updated_at" ON "LorebookEntry";

DROP TABLE IF EXISTS "LorebookRef";
DROP TABLE IF EXISTS "LorebookEntry";

ALTER TYPE "StoryRefTargetKind" RENAME TO "StoryRefTargetKind_old";
CREATE TYPE "StoryRefTargetKind" AS ENUM ('content', 'thread', 'scene', 'plot');

ALTER TABLE "StoryThreadRef"
ALTER COLUMN "targetKind" TYPE "StoryRefTargetKind"
USING CASE
    WHEN "targetKind"::text = 'lorebook' THEN 'content'::"StoryRefTargetKind"
    ELSE "targetKind"::text::"StoryRefTargetKind"
END;

ALTER TABLE "StorySceneRef"
ALTER COLUMN "targetKind" TYPE "StoryRefTargetKind"
USING CASE
    WHEN "targetKind"::text = 'lorebook' THEN 'content'::"StoryRefTargetKind"
    ELSE "targetKind"::text::"StoryRefTargetKind"
END;

DROP TYPE "StoryRefTargetKind_old";
DROP TYPE IF EXISTS "LorebookReview";
DROP TYPE IF EXISTS "LorebookSource";
DROP TYPE IF EXISTS "LorebookStatus";
DROP TYPE IF EXISTS "LorebookType";
