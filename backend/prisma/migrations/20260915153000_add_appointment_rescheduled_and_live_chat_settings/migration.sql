-- AlterEnum
-- NOT — 2026-09-15: feature/telehealth-reminder-emails backlog'unun BİR PARÇASI (yalnızca
-- reschedule) bu turda erken alındı. Admin randevu yeniden planlama (reschedule) akışı için
-- hastaya "Randevunuz Yeniden Planlandı" bildirimi gönderen tek şablon amacı. Hatırlatma/iptal
-- e-postaları HÂLÂ backlog'da, bu turda EKLENMEDİ.
ALTER TYPE "EmailTemplatePurpose" ADD VALUE 'APPOINTMENT_RESCHEDULED';

-- AlterTable
-- Sağ alt canlı destek widget'ı — admin panelden aç/kapa + opsiyonel harici sağlayıcı
-- (Crisp/Tawk.to) script ID'si. `liveChatEnabled` varsayılan KAPALI: `demoPaymentsEnabled`in
-- aksine, yeni bir UI özelliğinin sessizce her ortamda otomatik açık gelmesi istenmiyor — admin
-- bilinçli olarak açar. `liveChatProvider` serbest metin (enum DEĞİL): yeni bir sağlayıcı eklemek
-- enum migration'ı gerektirmemeli. `liveChatScriptId` yalnızca liveChatProvider harici bir
-- sağlayıcıysa kullanılır, "internal" iken yoksayılır.
ALTER TABLE "site_settings" ADD COLUMN     "liveChatEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "liveChatProvider" TEXT NOT NULL DEFAULT 'internal',
ADD COLUMN     "liveChatScriptId" TEXT;
