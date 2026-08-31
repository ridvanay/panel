-- CreateTable
CREATE TABLE "demo_template_imports" (
    "id" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "importedById" TEXT,
    "pageId" TEXT,

    CONSTRAINT "demo_template_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "demo_template_imports_templateKey_key" ON "demo_template_imports"("templateKey");

-- CreateIndex
CREATE INDEX "demo_template_imports_importedById_idx" ON "demo_template_imports"("importedById");

-- CreateIndex
CREATE INDEX "demo_template_imports_pageId_idx" ON "demo_template_imports"("pageId");

-- AddForeignKey
ALTER TABLE "demo_template_imports" ADD CONSTRAINT "demo_template_imports_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_template_imports" ADD CONSTRAINT "demo_template_imports_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
