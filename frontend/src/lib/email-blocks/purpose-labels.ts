import type { EmailTemplatePurpose } from "@/lib/api/types";

/** design-notes §Ek — `purpose` → Türkçe etiket (yeni terminoloji İCAT EDİLMEZ, backend `email-variables.ts` ile birebir aynı sözlük). */
export const EMAIL_PURPOSE_LABEL: Record<EmailTemplatePurpose, string> = {
  WELCOME: "Hoş Geldin",
  PASSWORD_RESET: "Şifre Sıfırlama",
  SYSTEM_ANNOUNCEMENT: "Sistem Duyurusu",
  ORDER_CONFIRMATION: "Sipariş Onayı",
  ORG_INVITATION: "Organizasyon Daveti",
  CONTACT_FORM_NOTIFICATION: "İletişim Formu Bildirimi",
  CUSTOM: "Özel",
};

export const EMAIL_PURPOSES: EmailTemplatePurpose[] = [
  "WELCOME",
  "PASSWORD_RESET",
  "SYSTEM_ANNOUNCEMENT",
  "ORDER_CONFIRMATION",
  "ORG_INVITATION",
  "CONTACT_FORM_NOTIFICATION",
  "CUSTOM",
];
