import { fetchSliderServer } from "@/lib/api/server-sliders";
import { splitSliderShortcodes } from "@/lib/sliders/shortcode";
import { AdvancedSlider } from "@/components/site/advanced-slider/advanced-slider";

/**
 * §9.2.2 architect — `TextBlockView`/`CustomHtmlBlockView` (ve blog/portfolyo/ürün detay
 * sayfaları) bugün `dangerouslySetInnerHTML` ile düz string basıyor; `AdvancedSlider` ise
 * `"use client"` + framer-motion'dır ve sunucuda `fetchSliderServer` ile beslenmek zorundadır
 * (sıfır-CLS: dış kutu yüksekliği SSR HTML'inde belirli olmalı). Bir React ağacı bir string'in
 * İÇİNE gömülemez — bu yüzden `html` kısa kod deseninde parçalara bölünür, metin parçaları
 * `dangerouslySetInnerHTML` ile, slider parçaları gerçek React düğümü olarak araya serpiştirilir.
 *
 * **Asenkronluk tuzağı (bağlayıcı):** dış bileşen `RichContentWithShortcodes` SENKRON kalır;
 * yalnızca `ShortcodeSliderView` alt bileşeni `async`'tir. React, senkron bir sunucu
 * bileşeninin döndürdüğü ağaçtaki async çocuğu kendisi bekler — böylece bu bileşeni çağıran
 * `TextBlockView`/`CustomHtmlBlockView` de senkron kalır ve mevcut `BlockRenderer` sözleşmesi
 * bozulmaz. `"use client"` YOKTUR — sunucu bileşenidir.
 */
async function ShortcodeSliderView({ sliderId }: { sliderId: string }) {
  const slider = await fetchSliderServer(sliderId);
  // §6.2 ile BİREBİR AYNI davranış: yok/çöpte/slaytsız → SESSİZCE null, hata YOK.
  if (!slider || slider.slides.length === 0) return null;
  // Kısa kod her zaman bir metin akışının İÇİNDEDİR → ev sahibi kap gutter'ı zaten var.
  return <AdvancedSlider slider={slider} chrome="bare" />;
}

export function RichContentWithShortcodes({ html, className }: { html: string; className?: string }) {
  const segments = splitSliderShortcodes(html);

  // HIZLI YOL (bağlayıcı): kısa kod YOKSA bugünkü DOM'un BİREBİR aynısı üretilir — tek bir div +
  // dangerouslySetInnerHTML. Sıfır regresyon garantisi budur.
  if (segments.length === 1 && segments[0]!.kind === "html") {
    return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return (
    <div className={className}>
      {segments.map((seg, i) =>
        seg.kind === "html" ? (
          <div key={i} dangerouslySetInnerHTML={{ __html: seg.html }} />
        ) : (
          <ShortcodeSliderView key={i} sliderId={seg.sliderId} />
        )
      )}
    </div>
  );
}
