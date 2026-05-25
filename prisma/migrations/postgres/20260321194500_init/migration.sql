-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ChapterStatus" AS ENUM ('NOT_STARTED', 'DRAFT', 'REVISING', 'DONE');

-- CreateTable
CREATE TABLE "Novel" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Novel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Volume" (
    "id" SERIAL NOT NULL,
    "novelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Volume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" SERIAL NOT NULL,
    "novelId" INTEGER NOT NULL,
    "volumeId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ChapterStatus" NOT NULL DEFAULT 'DRAFT',
    "summary" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "characters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "todos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentThread" (
    "id" SERIAL NOT NULL,
    "novelId" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "lastSelectedChapterId" INTEGER,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentThread_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Volume_novelId_sortOrder_idx" ON "Volume"("novelId", "sortOrder");

-- CreateIndex
CREATE INDEX "Chapter_novelId_volumeId_sortOrder_idx" ON "Chapter"("novelId", "volumeId", "sortOrder");

-- CreateIndex
CREATE INDEX "Chapter_volumeId_sortOrder_idx" ON "Chapter"("volumeId", "sortOrder");

-- CreateIndex
CREATE INDEX "AgentThread_novelId_updatedAt_idx" ON "AgentThread"("novelId", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentThread_novelId_lastMessageAt_idx" ON "AgentThread"("novelId", "lastMessageAt");

-- AddForeignKey
ALTER TABLE "Volume" ADD CONSTRAINT "Volume_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_volumeId_fkey" FOREIGN KEY ("volumeId") REFERENCES "Volume"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentThread" ADD CONSTRAINT "AgentThread_novelId_fkey" FOREIGN KEY ("novelId") REFERENCES "Novel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
