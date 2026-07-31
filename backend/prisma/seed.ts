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

  // §10.3 E-posta & Bildirim Şablonu Yöneticisi — varsayılan şablonlar (bkz. ARCHITECTURE.md §10.3).
  await prisma.emailTemplate.upsert({
    where: { key: "WELCOME" },
    update: {},
    create: {
      key: "WELCOME",
      name: "Hoş Geldin E-postası",
      subject: "Aramıza hoş geldin, {{user_name}}!",
      bodyHtml:
        "<p>Merhaba {{user_name}},</p><p>Hesabın başarıyla oluşturuldu. Giriş yapmak için aşağıdaki bağlantıyı kullanabilirsin:</p><p><a href=\"{{login_url}}\">Giriş Yap</a></p>",
      availableVariables: ["user_name", "login_url"],
    },
  });

  await prisma.emailTemplate.upsert({
    where: { key: "PASSWORD_RESET" },
    update: {},
    create: {
      key: "PASSWORD_RESET",
      name: "Şifre Sıfırlama E-postası",
      subject: "Şifre sıfırlama talebiniz",
      bodyHtml:
        "<p>Merhaba {{user_name}},</p><p>Şifreni sıfırlamak için aşağıdaki bağlantıya tıkla. Bu bağlantı kısa süre içinde geçersiz olacaktır:</p><p><a href=\"{{reset_link}}\">Şifremi Sıfırla</a></p><p>Bu talebi sen oluşturmadıysan bu e-postayı yok sayabilirsin.</p>",
      availableVariables: ["user_name", "reset_link"],
    },
  });

  await prisma.emailTemplate.upsert({
    where: { key: "SYSTEM_ANNOUNCEMENT" },
    update: {},
    create: {
      key: "SYSTEM_ANNOUNCEMENT",
      name: "Sistem Duyurusu",
      subject: "{{announcement_title}}",
      bodyHtml:
        "<p>Merhaba {{user_name}},</p><p>{{announcement_body}}</p>",
      availableVariables: ["user_name", "announcement_title", "announcement_body"],
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
