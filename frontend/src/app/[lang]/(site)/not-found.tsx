import type { Metadata } from "next";
import { headers } from "next/headers";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";

const DEFAULT_BUTTON_HREF = "/";

/** `x-active-locale` — bkz. aşağıdaki `SiteNotFound` içindeki AYNI gerekçe. */
async function resolveActiveLocale(): Promise<string> {
  const headersList = await headers();
  return headersList.get("x-active-locale") ?? "";
}

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getSiteDictionary(await resolveActiveLocale());
  return { title: dict.errors.notFoundTitle };
}

/**
 * Mevcut `frontend/src/app/not-found.tsx` KÖK not-found'dur ve admin 404'lerini de yakalar.
 * Özelleştirilmiş 404 burada, `(site)` segmentinin KENDİ `not-found.tsx`'inde yaşar — admin genel
 * olanı kullanmaya devam eder (§10.12.7, bağlayıcı).
 *
 * Ayar çağrısı ASLA hata fırlatmamalıdır — bir 404 bileşeninde fırlatılan hata 500'e dönüşür.
 * `fetchSiteAppearanceServer` zaten try/catch → varsayılan deseni izliyor (bkz. server-appearance.ts).
 *
 * `.claude/architect-scope-i18n.md` §14.5 madde 12 — `not-found.js`/`global-not-found.js`
 * bileşenleri HİÇBİR prop ALMAZ (bkz. `node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/not-found.md`), dolayısıyla `lang` route param'ından OKUNAMAZ. `app/layout.tsx`
 * İLE AYNI çözüm: `proxy.ts`'in her site isteğine yazdığı `x-active-locale` header'ı okunur.
 */
export default async function SiteNotFound() {
  const [appearance, dict] = await Promise.all([fetchSiteAppearanceServer(), getSiteDictionary(await resolveActiveLocale())]);

  const title = appearance.notFoundTitle?.trim() || dict.errors.notFoundTitle;
  const message = appearance.notFoundMessage?.trim() || dict.errors.notFoundMessage;
  // `headerCta*` ile AYNI kural: buton yalnızca etiket VE href'in ikisi de doluysa gösterilir.
  const hasCustomButton = Boolean(appearance.notFoundButtonLabel?.trim() && appearance.notFoundButtonHref?.trim());
  const buttonLabel = hasCustomButton ? (appearance.notFoundButtonLabel as string) : dict.errors.notFoundButtonLabel;
  const buttonHref = hasCustomButton ? (appearance.notFoundButtonHref as string) : DEFAULT_BUTTON_HREF;

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-muted px-4 py-12">
      <Card className="w-full max-w-sm text-center">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-foreground/60">{message}</p>
        <LinkButton href={buttonHref} className="mt-6 justify-center">
          {buttonLabel}
        </LinkButton>
      </Card>
    </main>
  );
}
