-- Add workspaceSlug to Novel and bind the current project workspace.
ALTER TABLE "Novel" ADD COLUMN "workspaceSlug" TEXT;

UPDATE "Novel"
SET "workspaceSlug" = CASE
    WHEN "id" = 1 THEN 'silver-dragon-hime'
    ELSE 'novel-' || "id"::TEXT
END;

ALTER TABLE "Novel" ALTER COLUMN "workspaceSlug" SET NOT NULL;

CREATE UNIQUE INDEX "Novel_workspaceSlug_key" ON "Novel"("workspaceSlug");
