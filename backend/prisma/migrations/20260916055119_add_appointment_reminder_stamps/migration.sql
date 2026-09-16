-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "reminded30mAt" TIMESTAMP(3),
ADD COLUMN     "reminded60mAt" TIMESTAMP(3);
