-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "consultationNoteCiphertext" TEXT,
ADD COLUMN     "consultationNoteUpdatedAt" TIMESTAMP(3);
