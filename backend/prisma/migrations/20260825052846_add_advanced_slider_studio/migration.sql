-- CreateEnum
CREATE TYPE "SliderTransitionEffect" AS ENUM ('SLIDE', 'FADE', 'CUBE', 'ZOOM');

-- CreateEnum
CREATE TYPE "SliderHeightMode" AS ENUM ('FULL_SCREEN', 'CUSTOM_PX', 'ASPECT_RATIO');

-- CreateEnum
CREATE TYPE "SlideBackgroundType" AS ENUM ('IMAGE', 'VIDEO', 'GRADIENT');

-- CreateEnum
CREATE TYPE "SliderNavigationTheme" AS ENUM ('LIGHT', 'DARK');

-- CreateTable
CREATE TABLE "sliders" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "autoplay" BOOLEAN NOT NULL DEFAULT true,
    "intervalMs" INTEGER NOT NULL DEFAULT 6000,
    "loop" BOOLEAN NOT NULL DEFAULT true,
    "pauseOnHover" BOOLEAN NOT NULL DEFAULT true,
    "transitionEffect" "SliderTransitionEffect" NOT NULL DEFAULT 'SLIDE',
    "transitionDurationMs" INTEGER NOT NULL DEFAULT 700,
    "heightMode" "SliderHeightMode" NOT NULL DEFAULT 'ASPECT_RATIO',
    "heightPx" INTEGER,
    "aspectRatioWidth" INTEGER NOT NULL DEFAULT 16,
    "aspectRatioHeight" INTEGER NOT NULL DEFAULT 9,
    "mobileHeightMode" "SliderHeightMode",
    "mobileHeightPx" INTEGER,
    "mobileAspectRatioWidth" INTEGER,
    "mobileAspectRatioHeight" INTEGER,
    "showArrows" BOOLEAN NOT NULL DEFAULT true,
    "showBullets" BOOLEAN NOT NULL DEFAULT true,
    "showProgressBar" BOOLEAN NOT NULL DEFAULT false,
    "navigationTheme" "SliderNavigationTheme" NOT NULL DEFAULT 'LIGHT',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sliders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slides" (
    "id" TEXT NOT NULL,
    "sliderId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "bgType" "SlideBackgroundType" NOT NULL DEFAULT 'GRADIENT',
    "bgMediaId" TEXT,
    "bgVideoUrl" TEXT,
    "bgVideoPosterMediaId" TEXT,
    "bgPositionX" INTEGER NOT NULL DEFAULT 50,
    "bgPositionY" INTEGER NOT NULL DEFAULT 50,
    "bgOverlayColor" TEXT,
    "bgOverlayOpacity" INTEGER NOT NULL DEFAULT 0,
    "bgGradientFrom" TEXT,
    "bgGradientTo" TEXT,
    "bgGradientAngle" INTEGER NOT NULL DEFAULT 180,
    "bgKenBurns" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "linkHref" TEXT,
    "linkNewTab" BOOLEAN NOT NULL DEFAULT false,
    "layers" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sliders_seq_key" ON "sliders"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "sliders_slug_key" ON "sliders"("slug");

-- CreateIndex
CREATE INDEX "sliders_deletedAt_idx" ON "sliders"("deletedAt");

-- CreateIndex
CREATE INDEX "slides_sliderId_idx" ON "slides"("sliderId");

-- CreateIndex
CREATE INDEX "slides_bgMediaId_idx" ON "slides"("bgMediaId");

-- CreateIndex
CREATE INDEX "slides_bgVideoPosterMediaId_idx" ON "slides"("bgVideoPosterMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "slides_sliderId_order_key" ON "slides"("sliderId", "order");

-- AddForeignKey
ALTER TABLE "slides" ADD CONSTRAINT "slides_sliderId_fkey" FOREIGN KEY ("sliderId") REFERENCES "sliders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slides" ADD CONSTRAINT "slides_bgMediaId_fkey" FOREIGN KEY ("bgMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slides" ADD CONSTRAINT "slides_bgVideoPosterMediaId_fkey" FOREIGN KEY ("bgVideoPosterMediaId") REFERENCES "media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
