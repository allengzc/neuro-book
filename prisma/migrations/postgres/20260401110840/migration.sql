/*
  Warnings:

  - You are about to drop the column `lastSelectedChapterId` on the `AgentThread` table. All the data in the column will be lost.
  - You are about to drop the column `novelId` on the `AgentThread` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "AgentThreadKind" AS ENUM ('leader', 'subagent');

-- CreateEnum
CREATE TYPE "AgentThreadRunStatus" AS ENUM ('idle', 'running', 'waiting_user', 'completed', 'stopped', 'failed');

-- DropForeignKey
ALTER TABLE "AgentThread" DROP CONSTRAINT "AgentThread_novelId_fkey";

-- DropIndex
DROP INDEX "AgentThread_novelId_lastMessageAt_idx";

-- DropIndex
DROP INDEX "AgentThread_novelId_updatedAt_idx";

-- AlterTable
ALTER TABLE "AgentThread" DROP COLUMN "lastSelectedChapterId",
DROP COLUMN "novelId",
ADD COLUMN     "kind" "AgentThreadKind" NOT NULL DEFAULT 'leader',
ADD COLUMN     "profileKey" TEXT NOT NULL DEFAULT 'leader.default',
ADD COLUMN     "runStatus" "AgentThreadRunStatus" NOT NULL DEFAULT 'idle';

-- CreateTable
CREATE TABLE "_AgentThreadSubagents" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_AgentThreadSubagents_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_AgentThreadSubagents_B_index" ON "_AgentThreadSubagents"("B");

-- CreateIndex
CREATE INDEX "AgentThread_updatedAt_idx" ON "AgentThread"("updatedAt");

-- CreateIndex
CREATE INDEX "AgentThread_lastMessageAt_idx" ON "AgentThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX "AgentThread_kind_idx" ON "AgentThread"("kind");

-- CreateIndex
CREATE INDEX "AgentThread_runStatus_idx" ON "AgentThread"("runStatus");

-- CreateIndex
CREATE INDEX "AgentThread_profileKey_idx" ON "AgentThread"("profileKey");

-- AddForeignKey
ALTER TABLE "_AgentThreadSubagents" ADD CONSTRAINT "_AgentThreadSubagents_A_fkey" FOREIGN KEY ("A") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AgentThreadSubagents" ADD CONSTRAINT "_AgentThreadSubagents_B_fkey" FOREIGN KEY ("B") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
