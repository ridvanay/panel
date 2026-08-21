import { cn } from "@/lib/utils";
import { fetchPublicContactFormServer } from "@/lib/api/server-contact";
import { ContactFormClient } from "@/components/site/contact-form";
import type { BlockChrome, ContactFormBlock } from "@/lib/page-builder/types";

/**
 * `app/[lang]/(site)/contact/page.tsx` ile AYNI render deseni — kendi alan/KVKK/honeypot
 * mantığını TEKRAR ETMEZ, mevcut site-geneli `ContactForm` singleton'ını (`/admin/contact`)
 * sayfanın İSTENEN noktasına gömer. Form devre dışıysa (`isEnabled: false`) veya fetch
 * başarısızsa `fetchPublicContactFormServer` `null` döner — `featured-products` ile AYNI
 * "sessizce hiçbir şey render etme" kuralı.
 */
export async function ContactFormBlockView({ block, chrome }: { block: ContactFormBlock; chrome: BlockChrome }) {
  const form = await fetchPublicContactFormServer();
  if (!form) return null;

  return (
    <section className={cn(chrome === "page" && "px-4 py-12 sm:px-6")}>
      {block.data.showTitle && (
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-2xl font-semibold text-foreground">{form.title}</h2>
          {form.description && <p className="mt-2 text-sm text-foreground/60">{form.description}</p>}
        </div>
      )}
      <div className={cn(block.data.showTitle && "mt-8")}>
        <ContactFormClient form={form} />
      </div>
    </section>
  );
}
