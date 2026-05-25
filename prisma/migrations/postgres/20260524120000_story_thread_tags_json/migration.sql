ALTER TABLE "StoryThread" ADD COLUMN "tags_json" TEXT NOT NULL DEFAULT '[]';

UPDATE "StoryThread"
SET "tags_json" = COALESCE(to_jsonb(COALESCE("tags", ARRAY[]::TEXT[]))::TEXT, '[]');

ALTER TABLE "StoryThread" DROP COLUMN "tags";
ALTER TABLE "StoryThread" RENAME COLUMN "tags_json" TO "tags";
