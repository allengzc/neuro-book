CREATE TABLE "DatabaseLock" (
    "key" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DatabaseLock_pkey" PRIMARY KEY ("key")
);
