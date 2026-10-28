import { cn } from "@/lib/utils";
import { fetchPublicContactFormServer } from "@/lib/api/server-contact";
import { ContactFormClient } from "@/components/site/contact-form";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import type { BlockChrome, ContactFormBlock } from "@/lib/page-builder/types";
import type { BlockSiteContext } from "./index";

/**
 * `app/[lang]/(site)/contact/page.tsx` ile AYNI render deseni — kendi alan/KVKK/honeypot
 * mantığını TEKRAR ETMEZ, mevcut site-geneli `ContactForm` singleton'ını (`/admin/contact`)
 * sayfanın İSTENEN noktasına gömer. Form devre dışıysa (`isEnabled: false`) veya fetch
 * başarısızsa `fetchPublicContactFormServer` `null` döner — `featured-products` ile AYNI
 * "sessizce hiçbir şey render etme" kuralı.
 */
export async function ContactFormBlockView({ block, chrome, siteContext }: { block: ContactFormBlock; chrome: BlockChrome; siteContext?: BlockSiteContext }) {
  // Paket U (B1) — form metinleri ve onay cümlesi aktif dilde; doğrulama mesajları site sözlüğünden.
  const [form, dict] = await Promise.all([fetchPublicContactFormServer(siteContext?.lang), getSiteDictionary(siteContext?.lang ?? "en")]);
  if (!form) return null;
  const c = dict.contact;
  const strings = {
    required: c.errorRequired,
    invalidEmail: c.errorInvalidEmail,
    tooLong: c.errorTooLong,
    consentRequired: c.errorConsentRequired,
    selectPlaceholder: c.selectPlaceholder,
    sending: c.sending,
  };

  return (
    <section className={cn(chrome === "page" && "px-4 py-12 sm:px-6")}>
      {block.data.showTitle && (
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-semibold text-foreground">{form.title}</h2>
          {form.description && <p className="mt-2 text-sm text-foreground/60">{form.description}</p>}
        </div>
      )}
      <div className={cn(block.data.showTitle && "mt-8")}>
        <ContactFormClient form={form} strings={strings} lang={siteContext?.lang} defaultLocaleCode={siteContext?.defaultLocaleCode} />
      </div>
    </section>
  );
}
