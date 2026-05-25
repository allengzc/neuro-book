ALTER TABLE "StoryScene" ADD COLUMN IF NOT EXISTS "chapterPath" TEXT;

DROP INDEX IF EXISTS "StoryScene_chapterId_chapterSortOrder_idx";
ALTER TABLE "StoryScene" DROP CONSTRAINT IF EXISTS "StoryScene_chapterId_fkey";
ALTER TABLE "StoryScene" DROP COLUMN IF EXISTS "chapterId";

DROP TABLE IF EXISTS "Chapter";
DROP TABLE IF EXISTS "Volume";
DROP TYPE IF EXISTS "ChapterStatus";

CREATE INDEX IF NOT EXISTS "StoryScene_chapterPath_chapterSortOrder_idx" ON "StoryScene"("chapterPath", "chapterSortOrder");
