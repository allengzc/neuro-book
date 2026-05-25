ALTER TABLE "LorebookRef"
ADD COLUMN "targetKind" "StoryRefTargetKind",
ADD COLUMN "visibility" "StoryRefVisibility" NOT NULL DEFAULT 'author',
ADD COLUMN "note" TEXT;

UPDATE "LorebookRef"
SET "targetKind" = CASE
    WHEN "targetEntryId" IS NOT NULL THEN 'lorebook'::"StoryRefTargetKind"
    ELSE 'pending'::"StoryRefTargetKind"
END
WHERE "targetKind" IS NULL;

ALTER TABLE "LorebookRef"
ALTER COLUMN "targetKind" SET NOT NULL;
