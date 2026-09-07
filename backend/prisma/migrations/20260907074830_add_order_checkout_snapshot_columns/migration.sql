-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "billingAddressCity" TEXT,
ADD COLUMN     "billingAddressCountry" TEXT,
ADD COLUMN     "billingAddressDistrict" TEXT,
ADD COLUMN     "billingAddressFullName" TEXT,
ADD COLUMN     "billingAddressLine1" TEXT,
ADD COLUMN     "billingAddressLine2" TEXT,
ADD COLUMN     "billingAddressNeighborhood" TEXT,
ADD COLUMN     "billingAddressPhone" TEXT,
ADD COLUMN     "billingAddressPostalCode" TEXT,
ADD COLUMN     "billingCompanyName" TEXT,
ADD COLUMN     "billingNationalId" TEXT,
ADD COLUMN     "billingTaxNumber" TEXT,
ADD COLUMN     "billingTaxOffice" TEXT,
ADD COLUMN     "billingType" "BillingType",
ADD COLUMN     "distanceSalesApprovedAt" TIMESTAMP(3),
ADD COLUMN     "preliminaryInfoApprovedAt" TIMESTAMP(3),
ADD COLUMN     "shippingAddressCity" TEXT,
ADD COLUMN     "shippingAddressCountry" TEXT,
ADD COLUMN     "shippingAddressDistrict" TEXT,
ADD COLUMN     "shippingAddressFullName" TEXT,
ADD COLUMN     "shippingAddressLine1" TEXT,
ADD COLUMN     "shippingAddressLine2" TEXT,
ADD COLUMN     "shippingAddressNeighborhood" TEXT,
ADD COLUMN     "shippingAddressPhone" TEXT,
ADD COLUMN     "shippingAddressPostalCode" TEXT;
