-- Paket W — YALNIZCA EKLEME: hekim eşleştirme sihirbazı (katalog, konu→uzmanlık ağırlığı, talep
-- ayrıntısı, anonim sayaçlar) + `matcher.new_lead` sistem e-posta şablonu. Mevcut tablo/kolonlara dokunulmaz.

-- CreateTable
CREATE TABLE "care_topics" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "bodyArea" TEXT NOT NULL,
    "translations" JSONB NOT NULL DEFAULT '{}',
    "isRedFlag" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_topic_specialties" (
    "topicId" TEXT NOT NULL,
    "specialtyId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,

    CONSTRAINT "care_topic_specialties_pkey" PRIMARY KEY ("topicId","specialtyId")
);

-- CreateTable
CREATE TABLE "matcher_submissions" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "leadId" TEXT NOT NULL,
    "topicIds" TEXT[],
    "freeText" TEXT,
    "ageBand" TEXT,
    "birthYear" INTEGER,
    "guardianName" TEXT,
    "forWhom" TEXT NOT NULL,
    "duration" TEXT,
    "priorDiagnosis" TEXT,
    "preference" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL,
    "country" TEXT,
    "timeZone" TEXT,
    "recommendedSpecialtyIds" TEXT[],
    "recommendedDoctorIds" TEXT[],
    "redFlagAcknowledgedAt" TIMESTAMP(3),
    "consentHealthAt" TIMESTAMP(3),
    "consentContactAt" TIMESTAMP(3),
    "callbackRequestedAt" TIMESTAMP(3),
    "accessTokenHash" TEXT,
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matcher_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matcher_stats" (
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "matcher_stats_pkey" PRIMARY KEY ("day","kind","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "care_topics_slug_key" ON "care_topics"("slug");

-- CreateIndex
CREATE INDEX "care_topics_isActive_bodyArea_sortOrder_idx" ON "care_topics"("isActive", "bodyArea", "sortOrder");

-- CreateIndex
CREATE INDEX "care_topic_specialties_specialtyId_idx" ON "care_topic_specialties"("specialtyId");

-- CreateIndex
CREATE UNIQUE INDEX "matcher_submissions_seq_key" ON "matcher_submissions"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "matcher_submissions_leadId_key" ON "matcher_submissions"("leadId");

-- CreateIndex
CREATE INDEX "matcher_submissions_createdAt_idx" ON "matcher_submissions"("createdAt");

-- CreateIndex
CREATE INDEX "matcher_submissions_anonymizedAt_idx" ON "matcher_submissions"("anonymizedAt");

-- CreateIndex
CREATE INDEX "matcher_stats_kind_day_idx" ON "matcher_stats"("kind", "day");

-- AddForeignKey
ALTER TABLE "care_topic_specialties" ADD CONSTRAINT "care_topic_specialties_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "care_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_topic_specialties" ADD CONSTRAINT "care_topic_specialties_specialtyId_fkey" FOREIGN KEY ("specialtyId") REFERENCES "specialties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matcher_submissions" ADD CONSTRAINT "matcher_submissions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sistem şablonu: admin/koordinatöre "Yeni eşleştirme talebi #<numara>" (şikayet/sağlık bilgisi YOK).
-- Aynı anahtar varsa dokunulmaz (admin düzenlemiş olabilir).
INSERT INTO "email_templates" ("id", "key", "name", "purpose", "editorMode", "isSystem", "isActive", "subject", "bodyHtml", "blocks", "availableVariables", "customVariables", "updatedAt", "createdAt")
VALUES (
  gen_random_uuid()::text,
  'matcher.new_lead',
  'Eşleştirme Sihirbazı — Yeni Talep',
  'MATCHER_NEW_LEAD',
  'RAW',
  true,
  true,
  'Yeni eşleştirme talebi #{{submission_number}}',
  '<p>Hekim eşleştirme sihirbazından yeni bir talep geldi: <strong>#{{submission_number}}</strong>.</p><p>Ayrıntılar yalnızca CRM yetkisi olan kullanıcılara panelde gösterilir:</p><p><a href="{{admin_url}}">Talebi panelde aç</a></p>',
  '[]'::jsonb,
  '["submission_number", "admin_url"]'::jsonb,
  '[]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
