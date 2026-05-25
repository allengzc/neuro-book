/*
  Warnings:

  - You are about to drop the `AgentMessage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AgentThread` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `_AgentThreadSubagents` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AgentMessage" DROP CONSTRAINT "AgentMessage_parentId_fkey";

-- DropForeignKey
ALTER TABLE "AgentMessage" DROP CONSTRAINT "AgentMessage_threadId_fkey";

-- DropForeignKey
ALTER TABLE "_AgentThreadSubagents" DROP CONSTRAINT "_AgentThreadSubagents_A_fkey";

-- DropForeignKey
ALTER TABLE "_AgentThreadSubagents" DROP CONSTRAINT "_AgentThreadSubagents_B_fkey";

-- DropTable
DROP TABLE "AgentMessage";

-- DropTable
DROP TABLE "AgentThread";

-- DropTable
DROP TABLE "_AgentThreadSubagents";

-- DropEnum
DROP TYPE "AgentThreadKind";

-- DropEnum
DROP TYPE "AgentThreadRunStatus";
