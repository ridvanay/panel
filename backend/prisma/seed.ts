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

  // §10.9.3 Sepet + Stripe Checkout — sipariş ödemesi onaylandığında gönderilen e-posta
  // (bkz. modules/webhooks/stripe.routes.ts::handleOrderPaid).
  await prisma.emailTemplate.upsert({
    where: { key: "ORDER_CONFIRMATION" },
    update: {},
    create: {
      key: "ORDER_CONFIRMATION",
      name: "Sipariş Onay E-postası",
      subject: "Siparişiniz alındı — {{order_number}}",
      bodyHtml:
        "<p>Merhaba {{customer_name}},</p><p><strong>{{order_number}}</strong> numaralı siparişiniz için ödemeniz alındı.</p><p>Sipariş içeriği: {{items_summary}}</p><p>Toplam: {{total_formatted}}</p><p>Bizi tercih ettiğiniz için teşekkür ederiz.</p>",
      availableVariables: ["order_number", "customer_name", "items_summary", "total_formatted"],
    },
  });

  // Organizasyon daveti — bkz. modules/invitations/invitations.routes.ts::orgInvitationsRoutes.
  // Ham davet bağlantısı artık ne response'ta ne de log'da düz metin dönmez (bkz. security-agent
  // kararı — token sızıntısı temizliği); bunun yerine bu şablon üzerinden gerçekten gönderilir.
  await prisma.emailTemplate.upsert({
    where: { key: "ORG_INVITATION" },
    update: {},
    create: {
      key: "ORG_INVITATION",
      name: "Organizasyon Daveti",
      subject: "{{inviter_name}} seni {{organization_name}} organizasyonuna davet etti",
      bodyHtml:
        "<p>Merhaba,</p><p>{{inviter_name}}, seni <strong>{{organization_name}}</strong> organizasyonuna davet etti. Daveti kabul etmek için aşağıdaki bağlantıya tıkla:</p><p><a href=\"{{accept_url}}\">Daveti Kabul Et</a></p><p>Bu daveti sen talep etmediysen bu e-postayı yok sayabilirsin.</p>",
      availableVariables: ["inviter_name", "organization_name", "accept_url"],
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
