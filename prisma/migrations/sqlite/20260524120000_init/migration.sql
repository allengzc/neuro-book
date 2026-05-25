CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" DATETIME,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Novel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "workspaceSlug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Story" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "novelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Story_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StoryPhase" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPhase_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StoryThread" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "storyPhaseId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isMainThread" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "tags" TEXT NOT NULL DEFAULT '[]',
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryThread_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryThread_storyPhaseId_fkey" FOREIGN KEY ("storyPhaseId") REFERENCES "StoryPhase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "StoryScene" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "storyId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "chapterPath" TEXT,
    "threadSortOrder" INTEGER NOT NULL,
    "chapterSortOrder" INTEGER,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryScene_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoryScene_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StoryThread" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StoryPlot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "effect" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StoryPlot_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "StorySceneRef" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "rawTarget" TEXT NOT NULL,
    "targetKind" TEXT NOT NULL,
    "targetThreadId" INTEGER,
    "targetSceneId" INTEGER,
    "targetPlotId" INTEGER,
    "visibility" TEXT NOT NULL DEFAULT 'author',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorySceneRef_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetThreadId_fkey" FOREIGN KEY ("targetThreadId") REFERENCES "StoryThread" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetSceneId_fkey" FOREIGN KEY ("targetSceneId") REFERENCES "StoryScene" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "StorySceneRef_targetPlotId_fkey" FOREIGN KEY ("targetPlotId") REFERENCES "StoryPlot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");
CREATE INDEX "User_lastSeenAt_idx" ON "User"("lastSeenAt");
CREATE INDEX "User_updatedAt_idx" ON "User"("updatedAt");

CREATE UNIQUE INDEX "Novel_workspaceSlug_key" ON "Novel"("workspaceSlug");

CREATE UNIQUE INDEX "Story_novelId_key" ON "Story"("novelId");

CREATE INDEX "StoryPhase_storyId_sortOrder_idx" ON "StoryPhase"("storyId", "sortOrder");
CREATE UNIQUE INDEX "StoryPhase_storyId_name_key" ON "StoryPhase"("storyId", "name");

CREATE INDEX "StoryThread_storyId_storyPhaseId_sortOrder_idx" ON "StoryThread"("storyId", "storyPhaseId", "sortOrder");
CREATE INDEX "StoryThread_storyId_isMainThread_status_idx" ON "StoryThread"("storyId", "isMainThread", "status");
CREATE UNIQUE INDEX "StoryThread_storyId_name_key" ON "StoryThread"("storyId", "name");

CREATE INDEX "StoryScene_threadId_threadSortOrder_idx" ON "StoryScene"("threadId", "threadSortOrder");
CREATE INDEX "StoryScene_chapterPath_chapterSortOrder_idx" ON "StoryScene"("chapterPath", "chapterSortOrder");
CREATE INDEX "StoryScene_storyId_status_idx" ON "StoryScene"("storyId", "status");
CREATE UNIQUE INDEX "StoryScene_threadId_threadSortOrder_key" ON "StoryScene"("threadId", "threadSortOrder");

CREATE INDEX "StoryPlot_sceneId_sortOrder_idx" ON "StoryPlot"("sceneId", "sortOrder");
CREATE UNIQUE INDEX "StoryPlot_sceneId_sortOrder_key" ON "StoryPlot"("sceneId", "sortOrder");

CREATE INDEX "StorySceneRef_sceneId_sortOrder_idx" ON "StorySceneRef"("sceneId", "sortOrder");
CREATE INDEX "StorySceneRef_targetThreadId_idx" ON "StorySceneRef"("targetThreadId");
CREATE INDEX "StorySceneRef_targetSceneId_idx" ON "StorySceneRef"("targetSceneId");
CREATE INDEX "StorySceneRef_targetPlotId_idx" ON "StorySceneRef"("targetPlotId");
