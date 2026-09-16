-- CreateEnum
CREATE TYPE "EmailVerificationPurpose" AS ENUM ('EMAIL_VERIFICATION', 'ACCOUNT_ACTIVATION');

-- CreateTable
CREATE TABLE "email_verification_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "EmailVerificationPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_verification_codes_userId_purpose_createdAt_idx" ON "email_verification_codes"("userId", "purpose", "createdAt");

-- AddForeignKey
ALTER TABLE "email_verification_codes" ADD CONSTRAINT "email_verification_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Grandfathering backfill — bkz. .claude/architect-scope-guest-account-otp.md §2.4 (bağlayıcı
-- karar dokümanı). Bu turdan ÖNCE var olan TÜM hesaplar doğrulanmış SAYILIR (bilinçli bir
-- "grandfathering" beyanıdır, gerçek bir doğrulama kanıtı değildir); doğrulama YALNIZCA bu
-- turdan SONRA açılan hesaplar için zorunludur. Backfill sonrası `email_verified_at IS NULL`
-- TEK ve kesin bir anlam taşır: "bu hesap doğrulanmayı bekliyor".
UPDATE "users" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;
