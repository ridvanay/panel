import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { fetchSiteAppearanceServer } from "@/lib/api/server-appearance";

export const metadata: Metadata = { title: "Sayfa bulunamadı" };

// §10.12.7 404 sayfası — sabit Türkçe varsayılanlar (backend `null` dönerse burada kullanılır,
// admin panelindeki placeholder metinleriyle BİREBİR aynı — design-notes-appearance-panel.md §10).
const DEFAULT_TITLE = "Sayfa Bulunamadı";
const DEFAULT_MESSAGE = "Aradığınız sayfa taşınmış veya kaldırılmış olabilir.";
const DEFAULT_BUTTON_LABEL = "Ana Sayfaya Dön";
const DEFAULT_BUTTON_HREF = "/";

/**
 * Mevcut `frontend/src/app/not-found.tsx` KÖK not-found'dur ve admin 404'lerini de yakalar.
 * Özelleştirilmiş 404 burada, `(site)` segmentinin KENDİ `not-found.tsx`'inde yaşar — admin genel
 * olanı kullanmaya devam eder (§10.12.7, bağlayıcı).
 *
 * Ayar çağrısı ASLA hata fırlatmamalıdır — bir 404 bileşeninde fırlatılan hata 500'e dönüşür.
 * `fetchSiteAppearanceServer` zaten try/catch → varsayılan deseni izliyor (bkz. server-appearance.ts).
 */
export default async function SiteNotFound() {
  const appearance = await fetchSiteAppearanceServer();

  const title = appearance.notFoundTitle?.trim() || DEFAULT_TITLE;
  const message = appearance.notFoundMessage?.trim() || DEFAULT_MESSAGE;
  // `headerCta*` ile AYNI kural: buton yalnızca etiket VE href'in ikisi de doluysa gösterilir.
  const hasCustomButton = Boolean(appearance.notFoundButtonLabel?.trim() && appearance.notFoundButtonHref?.trim());
  const buttonLabel = hasCustomButton ? (appearance.notFoundButtonLabel as string) : DEFAULT_BUTTON_LABEL;
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
