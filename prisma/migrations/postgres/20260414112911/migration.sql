-- CreateEnum
CREATE TYPE "StoryThreadStatus" AS ENUM ('active', 'draft', 'paused', 'done', 'archived');

-- CreateEnum
CREATE TYPE "StorySceneStatus" AS ENUM ('draft', 'active', 'written', 'revised', 'archived');

-- CreateEnum
CREATE TYPE "StoryPlotKind" AS ENUM ('setup', 'action', 'conflict', 'reward', 'mystery', 'reveal', 'twist', 'payoff', 'result');

-- CreateEnum
CREATE TYPE "StoryRefTargetKind" AS ENUM ('lorebook', 'thread', 'scene', 'plot', 'pending');

-- CreateEnum
CREATE TYPE "StoryRefVisibility" AS ENUM ('author', 'reader');

-- CreateTable
CREATE TABLE "Story" (
    "id" SERIAL NOT NULL,
    "novelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryPhase" (
    "id" SERIAL NOT NULL,
    "storyId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryThread" (
    "id" SERIAL NOT NULL,
    "storyId" INTEGER NOT NULL,
    "storyPhaseId" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isMainThread" BOOLEAN NOT NULL DEFAULT false,
    "status" "StoryThreadStatus" NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryScene" (
    "id" SERIAL NOT NULL,
    "storyId" INTEGER NOT NULL,
    "threadId" INTEGER NOT NULL,
    "chapterId" INTEGER,
    "threadSortOrder" INTEGER NOT NULL,
    "chapterSortOrder" INTEGER,
    "title" TEXT NOT NULL,
    "status" "StorySceneStatus" NOT NULL DEFAULT 'draft',
    "summary" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryPlot" (
    "id" SERIAL NOT NULL,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "kind" "StoryPlotKind" NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "effect" TEXT,
    "writingTip" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryPlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryThreadRef" (
    "id" SERIAL NOT NULL,
    "threadId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "rawTarget" TEXT NOT NULL,
    "targetKind" "StoryRefTargetKind" NOT NULL,
    "targetLorebookEntryId" INTEGER,
    "targetThreadId" INTEGER,
    "targetSceneId" INTEGER,
    "targetPlotId" INTEGER,
    "visibility" "StoryRefVisibility" NOT NULL DEFAULT 'author',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryThreadRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorySceneRef" (
    "id" SERIAL NOT NULL,
    "sceneId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "relation" TEXT NOT NULL,
    "rawTarget" TEXT NOT NULL,
    "targetKind" "StoryRefTargetKind" NOT NULL,
    "targetLorebookEntryId" INTEGER,
    "targetThreadId" INTEGER,
    "targetSceneId" INTEGER,
    "targetPlotId" INTEGER,
    "visibility" "StoryRefVisibility" NOT NULL DEFAULT 'author',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorySceneRef_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Story_novelId_key" ON "Story"("novelId");

-- CreateIndex
CREATE INDEX "StoryPhase_storyId_sortOrder_idx" ON "StoryPhase"("storyId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "StoryPhase_storyId_name_key" ON "StoryPhase"("storyId", "name");

-- CreateIndex
CREATE INDEX "StoryThread_storyId_storyPhaseId_sortOrder_idx" ON "StoryThread"("storyId", "storyPhaseId", "sortOrder");

-- CreateIndex
CREATE INDEX "StoryThread_storyId_isMainThread_status_idx" ON "StoryThread"("storyId", "isMainThread", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StoryThread_storyId_name_key" ON "StoryThread"("storyId", "name");

-- CreateIndex
CREATE INDEX "StoryScene_threadId_threadSortOrder_idx" ON "StoryScene"("threadId", "threadSortOrder");

-- CreateIndex
CREATE INDEX "StoryScene_chapterId_chapterSortOrder_idx" ON "StoryScene"("chapterId", "chapterSortOrder");

-- CreateIndex
CREATE INDEX "StoryScene_storyId_status_idx" ON "StoryScene"("storyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StoryScene_threadId_threadSortOrder_key" ON "StoryScene"("threadId", "threadSortOrder");

-- CreateIndex
CREATE INDEX "StoryPlot_sceneId_sortOrder_idx" ON "StoryPlot"("sceneId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "StoryPlot_sceneId_sortOrder_key" ON "StoryPlot"("sceneId", "sortOrder");

-- CreateIndex
CREATE INDEX "StoryThreadRef_threadId_sortOrder_idx" ON "StoryThreadRef"("threadId", "sortOrder");

-- CreateIndex
CREATE INDEX "StoryThreadRef_targetLorebookEntryId_idx" ON "StoryThreadRef"("targetLorebookEntryId");

-- CreateIndex
CREATE INDEX "StoryThreadRef_targetThreadId_idx" ON "StoryThreadRef"("targetThreadId");

-- CreateIndex
CREATE INDEX "StoryThreadRef_targetSceneId_idx" ON "StoryThreadRef"("targetSceneId");

-- CreateIndex
CREATE INDEX "StoryThreadRef_targetPlotId_idx" ON "StoryThreadRef"("targetPlotId");

-- CreateIndex
CREATE INDEX "StorySceneRef_sceneId_sortOrder_idx" ON "StorySceneRef"("sceneId", "sortOrder");

-- CreateIndex
CREATE INDEX "StorySceneRef_targetLorebookEntryId_idx" ON "StorySceneRef"("targetLorebookEntryId");

-- CreateIndex
CREATE INDEX "StorySceneRef_targetThreadId_idx" ON "StorySceneRef"("targetThreadId");

-- CreateIndex
CREATE INDEX "StorySceneRef_targetSceneId_idx" ON "StorySceneRef"("targetSceneId");

-- CreateIndex
CREATE INDEX "StorySceneRef_targetPlotId_idx" ON "StorySceneRef"("targetPlotId");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryPhase" ADD CONSTRAINT "StoryPhase_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryThread" ADD CONSTRAINT "StoryThread_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryThread" ADD CONSTRAINT "StoryThread_storyPhaseId_fkey" FOREIGN KEY ("storyPhaseId") REFERENCES "StoryPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryScene" ADD CONSTRAINT "StoryScene_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryScene" ADD CONSTRAINT "StoryScene_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StoryThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryScene" ADD CONSTRAINT "StoryScene_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryPlot" ADD CONSTRAINT "StoryPlot_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryThreadRef" ADD CONSTRAINT "StoryThreadRef_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "StoryThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryThreadRef" ADD CONSTRAINT "StoryThreadRef_targetLorebookEntryId_fkey" FOREIGN KEY ("targetLorebookEntryId") REFERENCES "LorebookEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryThreadRef" ADD CONSTRAINT "StoryThreadRef_targetThreadId_fkey" FOREIGN KEY ("targetThreadId") REFERENCES "StoryThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryThreadRef" ADD CONSTRAINT "StoryThreadRef_targetSceneId_fkey" FOREIGN KEY ("targetSceneId") REFERENCES "StoryScene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryThreadRef" ADD CONSTRAINT "StoryThreadRef_targetPlotId_fkey" FOREIGN KEY ("targetPlotId") REFERENCES "StoryPlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorySceneRef" ADD CONSTRAINT "StorySceneRef_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryScene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorySceneRef" ADD CONSTRAINT "StorySceneRef_targetLorebookEntryId_fkey" FOREIGN KEY ("targetLorebookEntryId") REFERENCES "LorebookEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorySceneRef" ADD CONSTRAINT "StorySceneRef_targetThreadId_fkey" FOREIGN KEY ("targetThreadId") REFERENCES "StoryThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorySceneRef" ADD CONSTRAINT "StorySceneRef_targetSceneId_fkey" FOREIGN KEY ("targetSceneId") REFERENCES "StoryScene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorySceneRef" ADD CONSTRAINT "StorySceneRef_targetPlotId_fkey" FOREIGN KEY ("targetPlotId") REFERENCES "StoryPlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
