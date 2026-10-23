import Link from "next/link";
import { FileWarning, Scale } from "lucide-react";

/**
 * §5.1 hukuki belge istisnası (bağlayıcı, KVKK m.10 / GDPR m.12) — `isLegalDocument: true`
 * bir sayfa, çevrilmediği bir dilde SESSİZCE varsayılan dile DÜŞMEZ. Backend gövdeyi (`blocks`)
 * zaten sunucu tarafında boşaltmıştır (fail-safe, bkz. `.claude/architect-scope-i18n.md` §5.1);
 * bu bileşen yalnızca durumu bildirir ve varsayılan dildeki sürüme bağlantı verir. 404 DEĞİLDİR.
 *
 * Metin `site` (ziyaretçi) sözlüğüne aittir, admin sözlüğüne DEĞİL — bunu gören kişi ziyaretçidir.
 * Bu sayfa `noindex` alır (bkz. `generateMetadata` — içeriksiz bir sayfayı indekslemenin anlamı yok).
 */
export function LegalDocumentNotice({
  title,
  defaultLocaleHref,
  noticeText,
  viewInDefaultLocaleLabel,
}: {
  title: string;
  defaultLocaleHref: string;
  /** `dict.legal.notAvailableInLocale` — compliance-agent onaylı NİHAİ metin, çağıran sayfa geçirir. */
  noticeText: string;
  /** `formatSiteString(dict.legal.viewInDefaultLocale, { defaultLocaleLabel })` — çağıran sayfa doldurur (bkz. çağıranlar). */
  viewInDefaultLocaleLabel: string;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--site-primary)]/10 text-[var(--site-primary)]">
        <FileWarning className="h-6 w-6" aria-hidden="true" />
      </span>
      <h1 className="mt-4 text-xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-foreground/60">{noticeText}</p>
      <Link
        href={defaultLocaleHref}
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-[var(--site-button)] px-4 py-2 text-sm font-medium text-[var(--site-button-text)] transition-all hover:opacity-85"
      >
        {viewInDefaultLocaleLabel}
      </Link>
    </div>
  );
}

/**
 * Paket L (2026-10-23) — TR/EN dışındaki dillerde çevrilmemiş yasal sayfa kanonik metne düşer; sayfanın
 * başında bağlayıcı sürümlerin Türkçe ve İngilizce olduğu, ziyaretçinin dilinde belirtilir
 * (`dict.legal.bindingVersionsNote`).
 */
export function LegalBindingVersionsNote({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-8 sm:px-6">
      <p
        role="note"
        className="flex items-start gap-2 rounded-[var(--site-radius)] border border-[var(--site-primary)]/25 bg-[var(--site-primary)]/5 px-4 py-3 text-sm text-foreground/80"
      >
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
        {text}
      </p>
    </div>
  );
}
