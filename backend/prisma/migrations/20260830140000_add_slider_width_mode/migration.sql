-- CreateEnum
CREATE TYPE "SliderWidthMode" AS ENUM ('FULL_WIDTH', 'BOXED');

-- AlterTable
ALTER TABLE "sliders" ADD COLUMN "widthMode" "SliderWidthMode" NOT NULL DEFAULT 'FULL_WIDTH';
