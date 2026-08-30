/**
 * Kısa Kod / Embed mekanizması (`[slider id="<uuid>"]`) — bkz.
 * `.claude/architect-scope-advanced-slider.md` §9.2 (bağlayıcı). Üretim ve ayrıştırma TEK bu
 * dosyada toplanır — iki kopyalama düğmesi (Hero Studio üst çubuğu, `/admin/sliders` satır
 * dropdown'ı) string'i elle kurmaz, `buildSliderShortcode(id)` çağırır.
 *
 * Saf/senkron fonksiyonlar — React importu YOK (hem sunucu hem istemci tarafında, hem de
 * birim testlerinde import edilir).
 */

/** Kanonik kısa kod biçimi. `slug` DEĞİL `id` kullanılır — `advanced-slider` bloğunun
 *  `data.sliderId` kararıyla AYNI gerekçe (slug yeniden adlandırıldığında bağ kopmaz). */
export function buildSliderShortcode(id: string): string {
  return `[slider id="${id}"]`;
}

/**
 * §9.2.3 architect — DoS/aşırı çağrı tavanı. Bu sayıyı aşan kısa kodlar `{kind:"slider"}`
 * yerine sessizce `{kind:"html"}` (ham metin) olarak bırakılır — tek bir zengin metin alanına
 * onlarca kısa kod yapıştıran bir editör paralel `GET /sliders/{id}` isteği üretmesin diye.
 */
export const MAX_SHORTCODE_SLIDERS_PER_FIELD = 5;

const QUOTE = `"|'|&quot;|&#39;`;
const UUID = `[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`;
/** Açılış ve kapanış tırnağı AYNI olmak ZORUNDA (`\1` geri referansı). */
export const SLIDER_SHORTCODE_RE = new RegExp(`\\[slider\\s+id\\s*=\\s*(${QUOTE})(${UUID})\\1\\s*\\]`, "g");

/** HTML'i etiket/metin parçalarına ayırır — kısa kod regex'i YALNIZCA metin parçalarında aranır. */
const TAG_OR_TEXT_RE = /(<[^>]*>)/;

export type RichContentSegment = { kind: "html"; html: string } | { kind: "slider"; sliderId: string };

/**
 * `html`'i kısa kod deseninde parçalara böler. Bölme noktası ASLA bir etiketin/özniteliğin
 * İÇİNE düşmez: önce `/(<[^>]*>)/` ile etiket/metin parçalarına ayrılır, kısa kod regex'i
 * yalnızca metin parçalarında aranır (etiket parçaları HER ZAMAN `{kind:"html"}` olarak
 * aynen kalır). Ardışık html parçaları birleştirilir (gereksiz segment patlaması olmasın).
 * Toplam kısa kod eşleşmesi `MAX_SHORTCODE_SLIDERS_PER_FIELD`'i AŞARSA fazlalıklar
 * `{kind:"slider"}` yerine yine `{kind:"html"}` (kısa kodun kendi metni AYNEN, render
 * EDİLMEDEN) olarak bırakılır.
 */
export function splitSliderShortcodes(html: string): RichContentSegment[] {
  const parts = html.split(TAG_OR_TEXT_RE).filter((p) => p.length > 0);
  const raw: RichContentSegment[] = [];
  let sliderCount = 0;

  for (const part of parts) {
    const isTag = part.startsWith("<") && part.endsWith(">");
    if (isTag) {
      raw.push({ kind: "html", html: part });
      continue;
    }

    let lastIndex = 0;
    SLIDER_SHORTCODE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SLIDER_SHORTCODE_RE.exec(part)) !== null) {
      const [full, , sliderId] = match;
      const matchStart = match.index;
      if (matchStart > lastIndex) {
        raw.push({ kind: "html", html: part.slice(lastIndex, matchStart) });
      }
      if (sliderCount < MAX_SHORTCODE_SLIDERS_PER_FIELD) {
        raw.push({ kind: "slider", sliderId: sliderId! });
        sliderCount += 1;
      } else {
        raw.push({ kind: "html", html: full });
      }
      lastIndex = matchStart + full.length;
    }
    if (lastIndex < part.length) {
      raw.push({ kind: "html", html: part.slice(lastIndex) });
    }
  }

  if (raw.length === 0) return [{ kind: "html", html: "" }];

  // Ardışık html parçalarını birleştir.
  const merged: RichContentSegment[] = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (seg.kind === "html" && prev && prev.kind === "html") {
      prev.html += seg.html;
    } else {
      merged.push(seg.kind === "html" ? { kind: "html", html: seg.html } : seg);
    }
  }

  return merged;
}
