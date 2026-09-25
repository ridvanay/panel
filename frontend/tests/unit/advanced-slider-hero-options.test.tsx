import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import type { Media } from "@/lib/api/types";
import type { PublicSlide, PublicSlider, SliderLayer } from "@/lib/sliders/types";
import { AdvancedSlider } from "@/components/site/advanced-slider/advanced-slider";
import { containAspectRatios, resolveSlideBackgrounds, scrimBackground } from "@/components/site/advanced-slider/background";
import { resolveLayerForDevice } from "@/components/site/advanced-slider/resolve-responsive";
import { buildLayerFloat, layerVisibilityClasses } from "@/lib/sliders/layer-render";

function media(id: string, width: number | null, height: number | null): Media {
  return { id, url: `/uploads/${id}.jpg`, filename: `${id}.jpg`, mimeType: "image/jpeg", sizeBytes: 1, altText: null, width, height, folderId: null } as Media;
}

const DESKTOP = media("desktop", 1920, 720);
const TABLET = media("tablet", 1536, 864);
const MOBILE = media("mobile", 1080, 1440);

function slide(patch: Partial<PublicSlide> = {}): PublicSlide {
  return {
    id: "s1",
    order: 0,
    bgType: "image",
    bgMedia: DESKTOP,
    bgVideoUrl: null,
    bgVideoPosterMedia: null,
    bgPositionX: 30,
    bgPositionY: 40,
    bgTabletMedia: null,
    bgMobileMedia: null,
    bgTabletPositionX: null,
    bgTabletPositionY: null,
    bgMobilePositionX: null,
    bgMobilePositionY: null,
    bgOverlayColor: null,
    bgOverlayOpacity: 0,
    bgScrimEnabled: false,
    bgScrimOpacity: 70,
    bgGradientFrom: null,
    bgGradientTo: null,
    bgGradientAngle: 180,
    bgKenBurns: false,
    durationMs: null,
    linkHref: null,
    linkNewTab: false,
    layers: [],
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...patch,
  };
}

function cardLayer(id: string, patch: Partial<SliderLayer> = {}): SliderLayer {
  return {
    id,
    type: "image",
    content: { url: `/uploads/${id}.png`, alt: `Kart ${id}` },
    position: { xPercent: 64, yPercent: 30, origin: "middle-left", widthPercent: 22 },
    style: {},
    animation: { inEffect: "fade-up", delayMs: 200, durationMs: 700, float: true },
    responsive: { mobile: { hidden: true } },
    ...patch,
  } as SliderLayer;
}

function slider(patch: Partial<PublicSlider> = {}): PublicSlider {
  return {
    id: "slider-1",
    name: "Hero",
    autoplay: false,
    intervalMs: 6000,
    loop: true,
    pauseOnHover: true,
    transitionEffect: "slide",
    transitionDurationMs: 700,
    heightMode: "aspect-ratio",
    heightPx: null,
    aspectRatioWidth: 16,
    aspectRatioHeight: 9,
    mobileHeightMode: null,
    widthMode: "full-width",
    imageFit: "cover",
    showArrows: false,
    showBullets: false,
    showProgressBar: false,
    navigationTheme: "light",
    slides: [slide()],
    ...patch,
  };
}

describe("resolveSlideBackgrounds — cihaz görseli yedek zinciri", () => {
  it("tablet yoksa masaüstü; mobil yoksa tablet, o da yoksa masaüstü", () => {
    expect(resolveSlideBackgrounds(slide()).mobile?.media.id).toBe("desktop");
    expect(resolveSlideBackgrounds(slide({ bgTabletMedia: TABLET })).mobile?.media.id).toBe("tablet");
    const all = resolveSlideBackgrounds(slide({ bgTabletMedia: TABLET, bgMobileMedia: MOBILE }));
    expect([all.desktop?.media.id, all.tablet?.media.id, all.mobile?.media.id]).toEqual(["desktop", "tablet", "mobile"]);
  });

  it("odak noktası da aynı zinciri izler (boş = bir üst cihaz)", () => {
    const bg = resolveSlideBackgrounds(slide({ bgTabletPositionX: 60, bgTabletPositionY: 10, bgMobilePositionY: 5 }));
    expect(bg.tablet).toMatchObject({ x: 60, y: 10 });
    expect(bg.mobile).toMatchObject({ x: 60, y: 5 });
    expect(bg.desktop).toMatchObject({ x: 30, y: 40 });
  });
});

describe("containAspectRatios / scrimBackground", () => {
  it("ilk slaytın cihaz görsellerinden oran; boyut bilinmiyorsa null", () => {
    expect(containAspectRatios(slide({ bgMobileMedia: MOBILE }))).toEqual({ desktop: "1920 / 720", tablet: "1920 / 720", mobile: "1080 / 1440" });
    expect(containAspectRatios(slide({ bgMedia: media("x", null, null) })).desktop).toBeNull();
    expect(containAspectRatios(slide({ bgType: "gradient" })).desktop).toBeNull();
  });

  it("gradyan eğrisi eski sabit katmanla aynı: %70 → %40 → 0", () => {
    expect(scrimBackground(70)).toBe("linear-gradient(to right, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.4) 50%, rgba(0, 0, 0, 0) 100%)");
  });
});

describe("katman görünürlüğü ve süzülme", () => {
  it("cihaz görünürlüğü CSS sınıfları — mobil ayarı yoksa tabletin değeri miras alınır", () => {
    expect(layerVisibilityClasses(cardLayer("a"))).toEqual(["max-md:hidden"]);
    expect(layerVisibilityClasses(cardLayer("b", { hiddenOnDesktop: true, responsive: { tablet: { hidden: true } } }))).toEqual([
      "lg:hidden",
      "md:max-lg:hidden",
      "max-md:hidden",
    ]);
  });

  it("masaüstünde gizli katman masaüstü çözümlemesinde hidden", () => {
    expect(resolveLayerForDevice(cardLayer("c", { hiddenOnDesktop: true }), "desktop").hidden).toBe(true);
    expect(resolveLayerForDevice(cardLayer("d"), "desktop").hidden).toBe(false);
  });

  it("süzülme giriş bittikten sonra başlar; hareket azaltmada hiç yok", () => {
    const layer = cardLayer("e");
    expect(buildLayerFloat(layer.animation, false)?.transition.delay).toBe(0.9);
    expect(buildLayerFloat(layer.animation, true)).toBeNull();
    expect(buildLayerFloat({ ...layer.animation, float: false }, false)).toBeNull();
  });
});

describe("AdvancedSlider — SSR HTML", () => {
  it("'görselin tamamını göster': oran satır içi + mobil oranı medya sorgusunda; <picture> mobil kaynağı; sabit gradyan yok", () => {
    const html = renderToString(
      <AdvancedSlider slider={slider({ imageFit: "contain", slides: [slide({ bgMobileMedia: MOBILE, layers: [cardLayer("k1")] })] })} />
    );
    expect(html).toContain("aspect-ratio:1920 / 720");
    expect(html).toMatch(/@media \(max-width: 767px\) \{ #adv-slider-\w+ \{ aspect-ratio: 1080 \/ 1440 !important; height: auto !important; \} \}/);
    expect(html).toContain('<source media="(max-width: 767px)"');
    expect(html).toContain("object-contain");
    expect(html).toContain('fetchPriority="high"');
    expect(html).not.toContain("bg-gradient-to-r");
    expect(html).not.toContain("linear-gradient(to right");
    // Mobilde gizli katman SSR'da da işaretli — JS beklemeden gizlenir.
    expect(html).toMatch(/class="absolute max-md:hidden"/);
  });

  it("gradyan yalnızca slaytta açıkken; 'kırp' modunda object-cover", () => {
    const html = renderToString(<AdvancedSlider slider={slider({ slides: [slide({ bgScrimEnabled: true, bgScrimOpacity: 70 })] })} />);
    expect(html).toContain("linear-gradient(to right, rgba(0, 0, 0, 0.7) 0%");
    expect(html).toContain("object-cover");
    expect(html).toContain("aspect-ratio:16 / 9");
  });

  it("iki renkli başlık tek h1 içinde render edilir", () => {
    const heading = {
      id: "h",
      type: "heading",
      content: { text: "Online Doktor", level: 1, accentText: "Görüşmesi", accentColor: "#008c96", accentOnNewLine: true },
      position: { xPercent: 8, yPercent: 40, origin: "middle-left" },
      style: {},
      animation: { inEffect: "fade-up", delayMs: 0, durationMs: 600 },
    } as SliderLayer;
    const html = renderToString(<AdvancedSlider slider={slider({ slides: [slide({ layers: [heading] })] })} />);
    expect(html).toMatch(/<h1 class="m-0">Online Doktor<br\/><span style="color:#008c96">Görüşmesi<\/span><\/h1>/);
  });
});
