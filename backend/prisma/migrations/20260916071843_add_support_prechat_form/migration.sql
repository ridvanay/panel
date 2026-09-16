-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "liveChatPreChatEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveChatRequireEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveChatRequireName" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "liveChatRequirePhone" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "support_chat_sessions" ADD COLUMN     "visitorPhone" TEXT;
