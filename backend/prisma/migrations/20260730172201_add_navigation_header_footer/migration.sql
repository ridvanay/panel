-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('TWITTER', 'GITHUB', 'LINKEDIN', 'INSTAGRAM', 'FACEBOOK', 'YOUTUBE', 'OTHER');

-- AlterTable
ALTER TABLE "site_settings" ADD COLUMN     "footerCopyrightText" TEXT,
ADD COLUMN     "headerCtaHref" TEXT,
ADD COLUMN     "headerCtaLabel" TEXT;

-- CreateTable
CREATE TABLE "navigation_items" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "navigation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_links" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "order" INTEGER NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "footer_columns" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "footer_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "footer_links" (
    "id" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "href" TEXT NOT NULL,

    CONSTRAINT "footer_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "navigation_items_seq_key" ON "navigation_items"("seq");

-- CreateIndex
CREATE INDEX "navigation_items_order_idx" ON "navigation_items"("order");

-- CreateIndex
CREATE UNIQUE INDEX "social_links_seq_key" ON "social_links"("seq");

-- CreateIndex
CREATE INDEX "social_links_order_idx" ON "social_links"("order");

-- CreateIndex
CREATE UNIQUE INDEX "footer_columns_seq_key" ON "footer_columns"("seq");

-- CreateIndex
CREATE INDEX "footer_columns_order_idx" ON "footer_columns"("order");

-- CreateIndex
CREATE INDEX "footer_links_columnId_idx" ON "footer_links"("columnId");

-- AddForeignKey
ALTER TABLE "footer_links" ADD CONSTRAINT "footer_links_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "footer_columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
