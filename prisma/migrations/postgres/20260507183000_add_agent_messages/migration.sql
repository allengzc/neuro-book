ALTER TABLE "AgentThread" ADD COLUMN "activeCursorMessageId" TEXT;

CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "threadId" INTEGER NOT NULL,
    "parentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'done',
    "storedMessage" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentMessage_threadId_idx" ON "AgentMessage"("threadId");
CREATE INDEX "AgentMessage_threadId_parentId_idx" ON "AgentMessage"("threadId", "parentId");
CREATE INDEX "AgentMessage_threadId_createdAt_idx" ON "AgentMessage"("threadId", "createdAt");
CREATE INDEX "AgentMessage_parentId_idx" ON "AgentMessage"("parentId");

ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AgentThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AgentMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP TABLE IF EXISTS "checkpoint_writes";
DROP TABLE IF EXISTS "checkpoint_blobs";
DROP TABLE IF EXISTS "checkpoints";
DROP TABLE IF EXISTS "checkpoint_migrations";
