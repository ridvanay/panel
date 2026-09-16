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

  // Sipariş iptali — ORDER_CONFIRMATION ile aynı akışın karşıt yönü (bkz. backend-agent'ın
  // modules/orders/orders.routes.ts içinden tetikleyeceği sendTemplateEmail çağrısı).
  await prisma.emailTemplate.upsert({
    where: { key: "ORDER_CANCELLATION" },
    update: {},
    create: {
      key: "ORDER_CANCELLATION",
      name: "Sipariş İptal E-postası",
      purpose: "ORDER_CANCELLATION",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
      subject: "Siparişiniz iptal edildi — {{order_number}}",
      bodyHtml:
        "<p>Merhaba {{customer_name}},</p><p><strong>{{order_number}}</strong> numaralı siparişiniz iptal edilmiştir.</p><p>Sipariş içeriği: {{items_summary}}</p><p>Toplam: {{total_formatted}}</p><p>İptal nedeni: {{cancellation_reason}}</p><p>Herhangi bir tahsilat yapılmışsa iadesi ilgili ödeme yönteminize yapılacaktır. Sorularınız için bizimle iletişime geçebilirsiniz.</p>",
      availableVariables: ["order_number", "customer_name", "items_summary", "total_formatted", "cancellation_reason"],
    },
  });

  // [TCT] §9.7.8 (bağlayıcı) — randevu ödemesi onaylandığında hastaya gönderilen TEK şablon
  // (bkz. modules/telehealth/lib/notifications.ts::triggerAppointmentConfirmationEmail). Konu
  // satırı BİLİNÇLİ OLARAK NÖTR: doktorun uzmanlık adı çıkarımsal sağlık verisidir (§7.1) ve
  // ne konuda ne gövdede yer alır; şikâyet notu/belge adı da AYNI şekilde ASLA yer almaz.
  // backend-agent görev notu (2026-09-16, "varsayılan dili İngilizce yap") — içerik EN'e
  // çevrildi. `EmailTemplate` modelinde locale/translations alanı YOKTUR (tek dilli içerik,
  // bkz. `.claude/architect-scope-i18n.md`); bu yüzden `buildEmailRenderContext`'in okuduğu
  // `localeSet.default.code` yalnızca KVKK footer linklerinin (`/{locale}/{slug}`) dilini
  // belirler, gövde/konu metnini DEĞİL — o yüzden gövde/konu burada ELLE İngilizceye çevrildi.
  // NOT: `upsert.update: {}` (idempotency) zaten SEED EDİLMİŞ bir DB satırını GÜNCELLEMEZ —
  // mevcut ortamlarda `scripts/translate-appointment-email-templates-en.ts` ile AYRICA uygulandı.
  await prisma.emailTemplate.upsert({
    where: { key: "APPOINTMENT_CONFIRMATION" },
    update: {},
    create: {
      key: "APPOINTMENT_CONFIRMATION",
      name: "Appointment Confirmation Email",
      purpose: "APPOINTMENT_CONFIRMATION",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
      subject: "Your appointment is confirmed",
      bodyHtml:
        "<p>Hello {{patient_name}},</p><p>We have received your payment for booking <strong>{{booking_number}}</strong> and your appointment is confirmed.</p><p>Appointment time(s): {{slots_summary}}</p><p>Total: {{total_formatted}}</p><p>You can use the link below to view your booking details and join the consultation:</p><p><a href=\"{{magic_link}}\">View My Booking</a></p>",
      availableVariables: ["booking_number", "patient_name", "slots_summary", "total_formatted", "magic_link"],
    },
  });

  // NOT — 2026-09-15: Admin randevu yeniden planlama (reschedule) akışı — hastaya VE doktora
  // (AYNI şablon, İKİ ayrı gönderim: hastaya giderken {{recipient_name}}=hasta adı, doktora
  // giderken {{recipient_name}}=doktor adı) "Randevunuz Yeniden Planlandı" bildirimi için tek
  // şablon (bkz. modules/telehealth/lib/notifications.ts, backend-agent tetikleyicisi). Konu
  // satırı BİLİNÇLİ OLARAK NÖTR — APPOINTMENT_CONFIRMATION ile AYNI PII/sızma disiplini: doktorun
  // uzmanlık adı, şikâyet notu, belge adı BU E-POSTADA ASLA yer almaz (bkz. §9.7.5 madde 8,
  // §9.7.8). {{reason}} admin'in girdiği değişiklik nedenidir, BOŞ olabilir; lib/template-render.ts
  // koşullu blok DESTEKLEMEDİĞİ için boşken paragraf doğal olarak boş görünür (kabul edilebilir).
  await prisma.emailTemplate.upsert({
    where: { key: "APPOINTMENT_RESCHEDULED" },
    update: {},
    create: {
      key: "APPOINTMENT_RESCHEDULED",
      name: "Appointment Rescheduled",
      purpose: "APPOINTMENT_RESCHEDULED",
      editorMode: "RAW",
      isSystem: true,
      isActive: true,
      subject: "Your Appointment Has Been Rescheduled",
      bodyHtml:
        "<p>Dear {{recipient_name}},</p><p>Your appointment <strong>{{booking_number}}</strong> has been rescheduled.</p><p><strong>Previous Date/Time:</strong> {{old_slot_summary}}</p><p><strong>New Date/Time:</strong> {{new_slot_summary}}</p><p>{{reason}}</p><p>If you have any questions, please feel free to contact us.</p>",
      availableVariables: ["recipient_name", "booking_number", "old_slot_summary", "new_slot_summary", "reason"],
    },
  });

  // [ASD] §2.4/§4.3 (bağlayıcı) — randevu hatırlatma e-postaları. Süpürücü tetikleyicisi:
  // modules/telehealth/lib/notifications.ts::triggerAppointmentReminderEmail. APPOINTMENT_RESCHEDULED
  // İLE AYNI desen: hasta VE doktora AYNI şablon, İKİ ayrı gönderim ({{recipient_name}} alıcıya
  // göre hasta ya da doktor adı olur). BLOCKS modu (mimar kararı). Sızma yasağı APPOINTMENT_CONFIRMATION
  // İLE AYNI: uzmanlık adı, şikâyet/intake notu, belge adı bu e-postalarda ASLA yer almaz
  // (§9.7.5 madde 8). `join_link` BİLİNÇLİ OLARAK YOK — yalnızca 30 dk şablonunda vardır.
  await prisma.emailTemplate.upsert({
    where: { key: "APPOINTMENT_REMINDER_60M" },
    update: {},
    create: {
      key: "APPOINTMENT_REMINDER_60M",
      name: "Appointment Reminder Email (1 Hour Before)",
      purpose: "APPOINTMENT_REMINDER_60M",
      editorMode: "BLOCKS",
      isSystem: true,
      isActive: true,
      subject: "Your Appointment Is in 1 Hour",
      bodyHtml: "",
      availableVariables: ["recipient_name", "booking_number", "doctor_name", "slot_summary"],
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
          data: { text: "Your Appointment Is in 1 Hour", level: 2 },
        },
        {
          id: "block-text",
          type: "text",
          style: { align: "left", backgroundColor: null, textColor: null, paddingY: "sm", paddingX: "md" },
          data: {
            html:
              "<p>Dear {{recipient_name}},</p><p>Your appointment <strong>{{booking_number}}</strong> is starting in about 1 hour.</p><p><strong>Participant:</strong> {{doctor_name}}</p><p><strong>Appointment Time:</strong> {{slot_summary}}</p><p>Please be ready shortly before your appointment time. If you would like to join early, you can use the link from your confirmation email.</p>",
          },
        },
      ],
    },
  });

  // [ASD] §2.4/§2.5/§4.3 (bağlayıcı) — APPOINTMENT_REMINDER_60M İLE AYNI sızma yasağı + AYNI
  // hasta/doktor gönderim deseni. EK olarak `join_link`: token ROTATE EDİLMEYEN, token'sız derin
  // bağlantı (hastaya `/patient/bookings/{bookingId}` veya `/patient/appointments`, doktora
  // `/doctor`) — bkz. modules/telehealth/lib/notifications.ts::triggerAppointmentReminderEmail.
  await prisma.emailTemplate.upsert({
    where: { key: "APPOINTMENT_REMINDER_30M" },
    update: {},
    create: {
      key: "APPOINTMENT_REMINDER_30M",
      name: "Appointment Reminder Email (30 Minutes Before)",
      purpose: "APPOINTMENT_REMINDER_30M",
      editorMode: "BLOCKS",
      isSystem: true,
      isActive: true,
      subject: "Your Appointment Is in 30 Minutes",
      bodyHtml: "",
      availableVariables: ["recipient_name", "booking_number", "doctor_name", "slot_summary", "join_link"],
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
          data: { text: "Your Appointment Is in 30 Minutes", level: 2 },
        },
        {
          id: "block-text",
          type: "text",
          style: { align: "left", backgroundColor: null, textColor: null, paddingY: "sm", paddingX: "md" },
          data: {
            html:
              "<p>Dear {{recipient_name}},</p><p>Your appointment <strong>{{booking_number}}</strong> is starting in about 30 minutes.</p><p><strong>Participant:</strong> {{doctor_name}}</p><p><strong>Appointment Time:</strong> {{slot_summary}}</p><p>You can join the room directly using the link below.</p>",
          },
        },
        {
          id: "block-button",
          type: "button",
          style: { align: "left", backgroundColor: null, textColor: null, paddingY: "md", paddingX: "md" },
          data: {
            label: "Join Room",
            href: "{{join_link}}",
            backgroundColor: null,
            textColor: null,
            radius: "sm",
          },
        },
      ],
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
