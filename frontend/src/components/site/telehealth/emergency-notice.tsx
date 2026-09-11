import { AlertTriangle } from "lucide-react";

/**
 * `.claude/architect-scope-telehealth-template.md` §6.6/§7.4 (compliance, ENGELLEYICI) +
 * `.claude/design-notes-telehealth.md` §9 — acil durum uyarısı. METNİN NİHAİ İÇERİĞİ
 * compliance-agent'ındır; mimari dokümanın §6.6/§7.4'te KENDİSİ verdiği tek cümle burada
 * PLACEHOLDER olarak kullanılır ("Bu metin bir yer tutucudur" ilkesiyle AYNI ruh —
 * [EPT] §4.3). compliance-agent bu sabiti nihai/hukuki metinle değiştirmelidir.
 */
export const EMERGENCY_NOTICE_TEXT = "Bu platform acil tıbbi durumlar için KULLANILAMAZ. Acil durumda 112'yi arayın.";

/** §9.1 — sitewide, kapatılamaz, ince şerit. `/doctors*` ve `/consultation/*` HER sayfasında, header'ın hemen altında. */
export function EmergencyNoticeStrip() {
  return (
    <div className="w-full border-b border-warning/25 bg-warning/10 px-4 py-2">
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 text-center text-xs font-medium text-warning sm:text-sm">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {EMERGENCY_NOTICE_TEXT}
      </p>
    </div>
  );
}

/** §9.2 — booking anında ikinci, daha belirgin tekrar (slot takviminin/formun HEMEN ÜSTÜNDE). */
export function EmergencyNoticeCard() {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-[var(--site-radius)] border border-warning/30 bg-warning/10 p-4">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="text-sm text-warning">{EMERGENCY_NOTICE_TEXT}</p>
    </div>
  );
}
