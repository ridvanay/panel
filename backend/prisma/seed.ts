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

  // §10.3 / §10.16 E-posta & Bildirim Şablonu Yöneticisi — varsayılan şablonlar
  // (bkz. ARCHITECTURE.md §10.3, §10.16.2). Bu 5 sistem şablonu editorMode=RAW kalır
  // (mevcut bodyHtml'leri korunur); purpose = key ile birebir, isSystem/isActive = true
  // (§10.16.2 backfill kuralıyla aynı sonucu upsert idempotency'siyle üretir).
  await prisma.emailTemplate.upsert({
    where: { key: "WELCOME" },
    update: {},
    create: {
      key: "WELCOME",
      name: "Hoş Geldin E-postası",
      purpose: "WELCOME",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
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
      purpose: "PASSWORD_RESET",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
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
      purpose: "SYSTEM_ANNOUNCEMENT",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
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
      purpose: "ORDER_CONFIRMATION",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
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
      purpose: "ORG_INVITATION",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
      subject: "{{inviter_name}} seni {{organization_name}} organizasyonuna davet etti",
      bodyHtml:
        "<p>Merhaba,</p><p>{{inviter_name}}, seni <strong>{{organization_name}}</strong> organizasyonuna davet etti. Daveti kabul etmek için aşağıdaki bağlantıya tıkla:</p><p><a href=\"{{accept_url}}\">Daveti Kabul Et</a></p><p>Bu daveti sen talep etmediysen bu e-postayı yok sayabilirsin.</p>",
      availableVariables: ["inviter_name", "organization_name", "accept_url"],
    },
  });

  // §10.16.7 İletişim formu — CONTACT_FORM_NOTIFICATION amaçlı, BLOCKS modlu sistem
  // şablonu. Blok editörünün canlı bir örneği olarak kasıtlı seçildi (mimar kararı).
  const contactNotificationTemplate = await prisma.emailTemplate.upsert({
    where: { key: "CONTACT_FORM_NOTIFICATION" },
    update: {},
    create: {
      key: "CONTACT_FORM_NOTIFICATION",
      name: "İletişim Formu Bildirimi",
      purpose: "CONTACT_FORM_NOTIFICATION",
      editorMode: "BLOCKS",
      isSystem: true,
      isActive: true,
      subject: "Yeni iletişim formu mesajı — {{form_title}}",
      bodyHtml: "",
      availableVariables: ["form_title", "submitted_at", "submission_url"],
      blocks: [
        {
          id: "block-logo-header",
          type: "logo-header",
          style: { align: "center", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
          data: { useSiteLogo: true, logoUrl: null, height: 48 },
        },
        {
          id: "block-heading",
          type: "heading",
          style: { align: "left", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
          data: { text: "Yeni bir iletişim formu mesajı aldınız", level: 2 },
        },
        {
          id: "block-text",
          type: "text",
          style: { align: "left", backgroundColor: null, textColor: null, paddingY: "sm", paddingX: "md" },
          data: {
            html:
              "<p><strong>Ad Soyad:</strong> {{name}}</p><p><strong>E-posta:</strong> {{email}}</p><p><strong>Mesaj:</strong> {{message}}</p><p><strong>Form:</strong> {{form_title}} — {{submitted_at}}</p>",
          },
        },
        {
          id: "block-button",
          type: "button",
          style: { align: "left", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
          data: {
            label: "Yönetim Panelinde Görüntüle",
            href: "{{submission_url}}",
            backgroundColor: null,
            textColor: null,
            radius: "sm",
          },
        },
      ],
    },
  });

  // §10.16.7 İletişim formu — TEK (singleton) form, id="singleton" + lazy-upsert deseni.
  const contactForm = await prisma.contactForm.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      title: "İletişim",
      isEnabled: true,
      notificationTemplateId: contactNotificationTemplate.id,
    },
  });

  // Üç sistem alanı — SİLİNEMEZ, key/type DEĞİŞTİRİLEMEZ (§10.16.7).
  await prisma.contactFormField.upsert({
    where: { formId_key: { formId: contactForm.id, key: "name" } },
    update: {},
    create: {
      formId: contactForm.id,
      order: 0,
      key: "name",
      label: "Ad Soyad",
      type: "TEXT",
      required: true,
      isSystem: true,
    },
  });

  await prisma.contactFormField.upsert({
    where: { formId_key: { formId: contactForm.id, key: "email" } },
    update: {},
    create: {
      formId: contactForm.id,
      order: 1,
      key: "email",
      label: "E-posta",
      type: "EMAIL",
      required: true,
      isSystem: true,
    },
  });

  await prisma.contactFormField.upsert({
    where: { formId_key: { formId: contactForm.id, key: "message" } },
    update: {},
    create: {
      formId: contactForm.id,
      order: 2,
      key: "message",
      label: "Mesajınız",
      type: "TEXTAREA",
      required: true,
      isSystem: true,
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
