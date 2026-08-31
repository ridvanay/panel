/**
 * Sayfa-seviyesi JSON-LD `<script>` yerleştiricisi — `lib/page-builder/structured-data.ts`'in
 * (`safeJsonLdString` ile ZATEN `</` kaçışlanmış) çıktısını basar. `json` `null` ise HİÇBİR ŞEY
 * render EDİLMEZ (örn. `noIndex` sayfası veya toplayacak veri yoksa) — bkz.
 * `.claude/architect-scope-google-map-corporate-blocks.md` §7.5 Boşluk 1/2.
 */
export function JsonLdScript({ json }: { json: string | null }) {
  if (!json) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
