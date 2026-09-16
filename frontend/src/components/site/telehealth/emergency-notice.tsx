import { AlertTriangle } from "lucide-react";

/**
 * `.claude/architect-scope-telehealth-template.md` §6.6/§7.4 (compliance, ENGELLEYICI) +
 * `.claude/design-notes-telehealth.md` §9 — acil durum uyarısı. `.claude/architect-scope-i18n.md`
 * §14.5 madde 3 — metin ARTIK sabit bir modül sabiti DEĞİL, `dict.telehealth.emergencyNotice`
 * (compliance-agent onaylı, locale başına farklı — §14.7) çağıran sunucu bileşeninden `text`
 * prop'u olarak akar. Bu bileşenin KENDİSİ sözlüğü ÇAĞIRMAZ (Client-agnostic, saf sunum bileşeni).
 */

/** §9.1 — sitewide, kapatılamaz, ince şerit. `/doctors*` ve `/consultation/*` HER sayfasında, header'ın hemen altında. */
export function EmergencyNoticeStrip({ text }: { text: string }) {
  return (
    <div className="w-full border-b border-warning/25 bg-warning/10 px-4 py-2">
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 text-center text-xs font-medium text-warning sm:text-sm">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {text}
      </p>
    </div>
  );
}

/** §9.2 — booking anında ikinci, daha belirgin tekrar (slot takviminin/formun HEMEN ÜSTÜNDE). */
export function EmergencyNoticeCard({ text }: { text: string }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-[var(--site-radius)] border border-warning/30 bg-warning/10 p-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-sm text-warning">{text}</p>
    </div>
  );
}
