-- CreateEnum
CREATE TYPE "SupportSessionStatus" AS ENUM ('PENDING', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportMessageSenderType" AS ENUM ('VISITOR', 'AGENT');

-- CreateTable
CREATE TABLE "support_chat_sessions" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "status" "SupportSessionStatus" NOT NULL DEFAULT 'PENDING',
    "visitorName" TEXT,
    "visitorEmail" TEXT,
    "visitorUserId" TEXT,
    "accessTokenHash" TEXT NOT NULL,
    "assignedAgentId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastVisitorMessageAt" TIMESTAMP(3),
    "lastAgentMessageAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "pageUrl" TEXT,
    "locale" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "piiRedactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_chat_messages" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "senderType" "SupportMessageSenderType" NOT NULL,
    "senderUserId" TEXT,
    "senderDisplayName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_reply_templates" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_reply_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_chat_sessions_seq_key" ON "support_chat_sessions"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "support_chat_sessions_accessTokenHash_key" ON "support_chat_sessions"("accessTokenHash");

-- CreateIndex
CREATE INDEX "support_chat_sessions_status_seq_idx" ON "support_chat_sessions"("status", "seq");

-- CreateIndex
CREATE INDEX "support_chat_sessions_assignedAgentId_idx" ON "support_chat_sessions"("assignedAgentId");

-- CreateIndex
CREATE INDEX "support_chat_sessions_createdAt_idx" ON "support_chat_sessions"("createdAt");

-- CreateIndex
CREATE INDEX "support_chat_sessions_closedAt_idx" ON "support_chat_sessions"("closedAt");

-- CreateIndex
CREATE INDEX "support_chat_sessions_lastMessageAt_idx" ON "support_chat_sessions"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_chat_messages_seq_key" ON "support_chat_messages"("seq");

-- CreateIndex
CREATE INDEX "support_chat_messages_sessionId_seq_idx" ON "support_chat_messages"("sessionId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "support_reply_templates_seq_key" ON "support_reply_templates"("seq");

-- CreateIndex
CREATE INDEX "support_reply_templates_isActive_sortOrder_idx" ON "support_reply_templates"("isActive", "sortOrder");

-- AddForeignKey
ALTER TABLE "support_chat_sessions" ADD CONSTRAINT "support_chat_sessions_visitorUserId_fkey" FOREIGN KEY ("visitorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_sessions" ADD CONSTRAINT "support_chat_sessions_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_sessions" ADD CONSTRAINT "support_chat_sessions_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_messages" ADD CONSTRAINT "support_chat_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "support_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_chat_messages" ADD CONSTRAINT "support_chat_messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
