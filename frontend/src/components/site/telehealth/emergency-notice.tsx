"use client";

import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Acil durum uyarısı — `.claude/architect-scope-telehealth-template.md` §6.6/§7.4 +
 * `.claude/design-notes-telehealth.md` §9. Metinler çağıran sunucu bileşeninden prop olarak gelir
 * (`lib/emergency-notice.ts::resolveEmergencyNotice` — admin metni, yoksa sözlük varsayılanı); bu
 * dosya sözlüğü/API'yi ÇAĞIRMAZ (saf sunum).
 *
 * Görünüm: zemin primary'nin çok açık tonu, metin `--site-text` (koyu), uyarı niteliğini amber ikon
 * (`--warning`) taşır — zemin değil. `role="note"`: sayfa her açıldığında ekran okuyucuyu KESMEZ
 * (`role="alert"` DEĞİL). Renkler `--site-*` token'larından türetilir, sabit renk yok.
 */
const NOTICE_SURFACE =
  "bg-[color-mix(in_oklch,var(--site-primary)_6%,var(--site-surface))] text-[var(--site-text)]";
const NOTICE_BORDER = "border-[color-mix(in_oklch,var(--site-primary)_18%,var(--site-surface))]";

/**
 * §9.1 — header'ın hemen altında ince şerit (`/doctors*`, `/specialties*`, `/consultation/*`).
 * Ziyaretçi tamamen gizleyemez; yalnızca özet ↔ tam metin arasında geçiş yapar. Durum hatırlanmaz,
 * her sayfada KAPALI (özet) başlar. Admin anahtarı kapalıysa `/doctors*` ve `/specialties*`
 * layout'ları bunu render etmez; `/consultation/*` anahtardan bağımsız her zaman render eder.
 */
export function EmergencyNoticeStrip({
  summary,
  full,
  showDetailsLabel,
  hideDetailsLabel,
}: {
  summary: string;
  full: string;
  showDetailsLabel: string;
  hideDetailsLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();

  return (
    <div role="note" className={`w-full border-b ${NOTICE_BORDER} ${NOTICE_SURFACE}`}>
      <div className="mx-auto flex max-w-7xl items-start gap-2 px-3 sm:px-6">
        <p id={textId} className="min-w-0 flex-1 py-[11px] text-[13px] leading-[1.45] xl:text-sm">
          <AlertTriangle className="mr-1.5 inline-block h-4 w-4 -translate-y-px align-middle text-warning" aria-hidden="true" />
          {expanded ? full : summary}
        </p>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((prev) => !prev)}
          className="inline-flex min-h-11 shrink-0 items-center rounded-md px-2 text-[13px] font-semibold underline underline-offset-2 hover:bg-[color-mix(in_oklch,var(--site-primary)_10%,var(--site-surface))] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--site-primary)] xl:text-sm"
        >
          {expanded ? hideDetailsLabel : showDetailsLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * §9.2 — randevu formunun HEMEN ÜSTÜNDE ikinci tekrar. Admin anahtarından BAĞIMSIZ, her zaman
 * TAM metinle ve açık hâlde gösterilir.
 */
export function EmergencyNoticeCard({ text }: { text: string }) {
  return (
    <div role="note" className={`mb-4 flex items-start gap-3 rounded-[var(--site-radius)] border p-4 ${NOTICE_BORDER} ${NOTICE_SURFACE}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}
