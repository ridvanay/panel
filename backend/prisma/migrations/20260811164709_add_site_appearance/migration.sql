-- CreateEnum
CREATE TYPE "PageHeaderStyle" AS ENUM ('PLAIN', 'BANNER', 'HIDDEN');

-- CreateEnum
CREATE TYPE "SiteFont" AS ENUM ('SYSTEM', 'INTER', 'ROBOTO', 'OPEN_SANS', 'MONTSERRAT', 'POPPINS', 'LORA', 'PLAYFAIR_DISPLAY', 'SOURCE_SERIF_4');

-- CreateEnum
CREATE TYPE "SocialShareNetwork" AS ENUM ('TWITTER', 'FACEBOOK', 'LINKEDIN', 'WHATSAPP', 'EMAIL', 'COPY_LINK');

-- CreateTable
CREATE TABLE "site_appearance" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "presetKey" TEXT,
    "pageHeaderStyle" "PageHeaderStyle" NOT NULL DEFAULT 'PLAIN',
    "pageHeaderBackgroundColor" TEXT,
    "pageHeaderBackgroundMediaId" TEXT,
    "pageHeaderOverlayOpacity" INTEGER NOT NULL DEFAULT 40,
    "primaryColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "secondaryColor" TEXT NOT NULL DEFAULT '#111827',
    "buttonColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "buttonTextColor" TEXT NOT NULL DEFAULT '#ffffff',
    "linkColor" TEXT NOT NULL DEFAULT '#4f46e5',
    "headingFont" "SiteFont" NOT NULL DEFAULT 'SYSTEM',
    "bodyFont" "SiteFont" NOT NULL DEFAULT 'SYSTEM',
    "baseFontSize" INTEGER NOT NULL DEFAULT 16,
    "socialShareEnabled" BOOLEAN NOT NULL DEFAULT false,
    "socialShareNetworks" "SocialShareNetwork"[] DEFAULT ARRAY[]::"SocialShareNetwork"[],
    "backToTopEnabled" BOOLEAN NOT NULL DEFAULT true,
    "stickyHeaderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cookieBannerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cookieBannerText" TEXT,
    "cookieBannerPolicyHref" TEXT,
    "maintenanceModeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT,
    "notFoundTitle" TEXT,
    "notFoundMessage" TEXT,
    "notFoundButtonLabel" TEXT,
    "notFoundButtonHref" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_appearance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_custom_code" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "customCss" TEXT,
    "customJs" TEXT,
    "cssUpdatedById" TEXT,
    "cssUpdatedAt" TIMESTAMP(3),
    "jsUpdatedById" TEXT,
    "jsUpdatedAt" TIMESTAMP(3),

    CONSTRAINT "site_custom_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_appearance_pageHeaderBackgroundMediaId_idx" ON "site_appearance"("pageHeaderBackgroundMediaId");

-- CreateIndex
CREATE INDEX "site_custom_code_cssUpdatedById_idx" ON "site_custom_code"("cssUpdatedById");

-- CreateIndex
CREATE INDEX "site_custom_code_jsUpdatedById_idx" ON "site_custom_code"("jsUpdatedById");

-- AddForeignKey
ALTER TABLE "site_appearance" ADD CONSTRAINT "site_appearance_pageHeaderBackgroundMediaId_fkey" FOREIGN KEY ("pageHeaderBackgroundMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_custom_code" ADD CONSTRAINT "site_custom_code_cssUpdatedById_fkey" FOREIGN KEY ("cssUpdatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_custom_code" ADD CONSTRAINT "site_custom_code_jsUpdatedById_fkey" FOREIGN KEY ("jsUpdatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
