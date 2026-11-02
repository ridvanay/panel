import { Info } from "lucide-react";
import { formatSiteString } from "@/lib/i18n/site-dictionaries";
import type { IntermediaryStrings } from "@/lib/i18n/site-dictionaries/types";

/**
 * Paket AH — kurumsal kimlik ibaresi bilgi kutusu: WM Health bir sağlık kuruluşu değil, uluslararası
 * sağlık turizmi aracı kuruluşudur. Hizmet/bölüm, talep formu, VIP, paket sayfaları ve blog yazısı
 * altında kullanılır. Belge satırı yalnızca admin ayarında numara girildiyse görünür.
 */
export function IntermediaryNotice({
  strings,
  certificateNo,
  className,
}: {
  strings: IntermediaryStrings;
  certificateNo?: string | null;
  className?: string;
}) {
  const certificate = certificateNo?.trim();
  return (
    <aside
      aria-label={strings.noticeAria}
      data-testid="intermediary-notice"
      className={`rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4 text-sm text-foreground/70 sm:p-5 ${className ?? ""}`}
    >
      <p className="flex items-center gap-2 font-semibold text-foreground">
        <Info aria-hidden="true" className="size-4 shrink-0 text-[var(--site-primary)]" />
        {strings.shortLabel}
      </p>
      <p className="mt-1.5 leading-relaxed">{strings.description}</p>
      {certificate && (
        <p className="mt-1.5 font-medium text-foreground/80" data-testid="intermediary-certificate">
          {formatSiteString(strings.certificateLine, { no: certificate })}
        </p>
      )}
    </aside>
  );
}
