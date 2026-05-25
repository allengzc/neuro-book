CREATE TYPE "UserRole" AS ENUM ('admin', 'user');
CREATE TYPE "UserStatus" AS ENUM ('active', 'disabled');

CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "sessionVersion" INTEGER NOT NULL DEFAULT 1,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");
CREATE INDEX "User_updatedAt_idx" ON "User"("updatedAt");
