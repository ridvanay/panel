import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.plan.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Starter",
      priceMonthlyCents: 0,
      priceYearlyCents: 0,
      currency: "TRY",
      limits: { maxMembers: 3, maxProjects: 3 },
    },
  });

  await prisma.plan.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Pro",
      priceMonthlyCents: 49900,
      priceYearlyCents: 499000,
      currency: "TRY",
      limits: { maxMembers: 20, maxProjects: 50 },
      stripePriceIdMonthly: "price_replace_me_monthly",
      stripePriceIdYearly: "price_replace_me_yearly",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
