import { describe, expect, it } from "vitest";
import { CreatePageRequestSchema } from "../../src/modules/pages/pages.schemas";

/**
 * `google-map` (YENİ blok) + 5 mevcut kurumsal bloğun (accordion/before-after-slider/
 * pricing-table/logo-marquee/video) opsiyonel alan genişletmesi. Kaynaklar (bağlayıcı):
 *  - `.claude/architect-scope-google-map-corporate-blocks.md` §2, §5 (mimar)
 *  - `.claude/security-review-google-map-corporate-blocks.md` §2, §3, §7 (security-agent —
 *    çakışmada bu doküman kazanır)
 *
 * En kritik test bu dosyada `PageNodeSchema dispatch — google-map dalı gerçekten çalışıyor`
 * describe bloğudur: dispatch dalı unutulsaydı `google-map` tipi `z.record(z.unknown())`
 * olarak SESSİZCE geçerdi ve bu test grubu SESSİZCE (yanlışlıkla) YEŞİL kalırdı — bu yüzden
 * assertion açıkça `success === false` bekler (mimar §9 R2, security-review §7/5).
 */

function pageWithBlock(block: Record<string, unknown>) {
  return { title: "x", blocks: [block] };
}

function googleMapBlock(data: Record<string, unknown> = {}, id = "map-1") {
  return { id, type: "google-map", data };
}

describe("google-map — embedUrl beyaz listesi (mimar §2/§3.2, security-review §2 NİHAİ regex)", () => {
  it.each([
    ["bare pb= query (mimarın kanonik örneği)", "https://www.google.com/maps/embed?pb=!1m18!2m0"],
    ["apex host, /v1/place modu", "https://google.com/maps/embed/v1/place?q=Istanbul"],
    ["www host, /v1/view modu", "https://www.google.com/maps/embed/v1/view?center=41,29&zoom=10"],
    ["/v1/directions modu", "https://www.google.com/maps/embed/v1/directions?origin=a&destination=b"],
    ["/v1/search modu", "https://www.google.com/maps/embed/v1/search?q=cafe"],
    ["/v1/streetview modu", "https://www.google.com/maps/embed/v1/streetview?location=41,29"],
  ])("kabul edilir: %s", (_label, embedUrl) => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ embedUrl })));
    expect(result.success).toBe(true);
  });

  it.each([
    ["bölgesel domain (google.com.tr)", "https://www.google.com.tr/maps/embed?x=1"],
    ["maps.google.com alt-alan adı", "https://maps.google.com/maps/embed?x=1"],
    ["kısaltılmış goo.gl linki", "https://goo.gl/maps/AbCdEf"],
    ["http:// (https değil)", "http://www.google.com/maps/embed?x=1"],
    ["javascript: şeması", "javascript:alert(1)"],
    ["userinfo-trick (gerçek host evil.com)", "https://google.com@evil.com/maps/embed?x=1"],
    ["port enjeksiyonu", "https://google.com:8080/maps/embed?x=1"],
    ["query içinde <script>", "https://www.google.com/maps/embed?x=1<script>"],
    ["query içinde backtick", "https://www.google.com/maps/embed?x=`1`"],
    ["query içinde backslash", "https://www.google.com/maps/embed?x=1\\evil"],
    ["enum-prefix bypass (/v1/placeholder)", "https://www.google.com/maps/embed/v1/placeholder?x=1"],
    ["case bypass (HTTPS://WWW.GOOGLE.COM)", "HTTPS://WWW.GOOGLE.COM/maps/embed?x=1"],
    ["backslash normalizasyon denemesi", "https:/\\google.com\\maps\\embed?x=1"],
  ])("422 ile reddedilir: %s", (_label, embedUrl) => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ embedUrl })));
    expect(result.success).toBe(false);
  });
});

describe("google-map — embedUrl iframe snippet çıkarımı (extractGoogleMapEmbedUrlFromInput ~L913-923, z.preprocess ile şemaya bağlı)", () => {
  it("tam Google 'Haritayı yerleştir' iframe snippet'i kabul edilir, normalize edilmiş embedUrl ham HTML DEĞİL, çıkarılmış çıplak URL'dir", () => {
    const iframeSnippet =
      '<iframe src="https://www.google.com/maps/embed?pb=!1m18!2m0" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>';
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ embedUrl: iframeSnippet })));
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: Record<string, unknown> };
      expect(block.data.embedUrl).toBe("https://www.google.com/maps/embed?pb=!1m18!2m0");
    }
  });

  it("tek tırnaklı src='...' varyantı kabul edilir", () => {
    const iframeSnippet = "<iframe src='https://www.google.com/maps/embed?pb=!1m18!2m0' width=\"600\" height=\"450\"></iframe>";
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ embedUrl: iframeSnippet })));
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: Record<string, unknown> };
      expect(block.data.embedUrl).toBe("https://www.google.com/maps/embed?pb=!1m18!2m0");
    }
  });

  it("&amp; ile kaçırılmış çoklu query param'lı /v1/place URL'i kabul edilir, çıkarılan embedUrl'de GERÇEK & karakterleri vardır (&amp; DEĞİL)", () => {
    const iframeSnippet =
      '<iframe src="https://www.google.com/maps/embed/v1/place?key=x&amp;q=Istanbul&amp;zoom=12" width="600" height="450"></iframe>';
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ embedUrl: iframeSnippet })));
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: Record<string, unknown> };
      expect(block.data.embedUrl).toBe("https://www.google.com/maps/embed/v1/place?key=x&q=Istanbul&zoom=12");
    }
  });

  it("KRİTİK regresyon: iframe içine sarılmış beyaz liste DIŞI bir URL çıkarımdan SONRA da reddedilir (extraction whitelist'i BYPASS ETMEZ)", () => {
    const iframeSnippet = '<iframe src="https://evil.com/maps/embed?x=1"></iframe>';
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ embedUrl: iframeSnippet })));
    expect(result.success).toBe(false);
  });

  it("src niteliği olmayan bir <iframe> etiketi reddedilir (orijinal çöp metin regex'i geçemez)", () => {
    const iframeSnippet = '<iframe width="600" height="450" allowfullscreen=""></iframe>';
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ embedUrl: iframeSnippet })));
    expect(result.success).toBe(false);
  });

  it("yalnızca '<iframe' alt dizisini içeren ama geçerli src= taşımayan bozuk metin reddedilir", () => {
    const brokenSnippet = "<iframe this is not real html no src attribute at all";
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ embedUrl: brokenSnippet })));
    expect(result.success).toBe(false);
  });

  it("regresyon: iframe sarmalayıcısı OLMADAN çıplak URL hâlâ eskisi gibi davranır — kabul", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ embedUrl: "https://www.google.com/maps/embed?pb=!1m18!2m0" }))
    );
    expect(result.success).toBe(true);
  });

  it("regresyon: iframe sarmalayıcısı OLMADAN çıplak URL hâlâ eskisi gibi davranır — ret", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ embedUrl: "https://evil.com/maps/embed?x=1" }))
    );
    expect(result.success).toBe(false);
  });
});

describe("google-map — zoom (security-review §3: aralık dışı → 422, CLAMP YOK)", () => {
  it("zoom = 1 (alt sınır) kabul edilir", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ zoom: 1 })));
    expect(result.success).toBe(true);
  });

  it("zoom = 20 (üst sınır) kabul edilir", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ zoom: 20 })));
    expect(result.success).toBe(true);
  });

  it("zoom = 0 → 422 (clamp edilmez, sessizce 1'e düzeltilmez)", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ zoom: 0 })));
    expect(result.success).toBe(false);
  });

  it("zoom = 21 → 422 (clamp edilmez, sessizce 20'ye düzeltilmez)", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ zoom: 21 })));
    expect(result.success).toBe(false);
  });
});

describe("google-map — height (mimar §5/3, superRefine ile vh çapraz-alan kısıtı)", () => {
  it("{ value: 400, unit: 'px' } kabul edilir", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ height: { value: 400, unit: "px" } }))
    );
    expect(result.success).toBe(true);
  });

  it("{ value: 100, unit: 'vh' } (üst sınır) kabul edilir", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ height: { value: 100, unit: "vh" } }))
    );
    expect(result.success).toBe(true);
  });

  it("{ value: 101, unit: 'vh' } → 422 (vh > 100 yasak)", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ height: { value: 101, unit: "vh" } }))
    );
    expect(result.success).toBe(false);
  });

  it("{ value: 1800, unit: 'px' } kabul edilir (vh tavanı px birimini etkilemez)", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ height: { value: 1800, unit: "px" } }))
    );
    expect(result.success).toBe(true);
  });

  it("{ value: 2001, unit: 'px' } → 422 (MAX_HEIGHT_PX aşıldı)", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ height: { value: 2001, unit: "px" } }))
    );
    expect(result.success).toBe(false);
  });
});

describe("google-map — apiKey alanı reddi (mimar §3.1, security-review §1 ONAYLANDI)", () => {
  it("data.apiKey gönderilirse strip edilir, şema bunu bilinmeyen bir alan olarak kabul ETMEZ bir sır sızıntısına yol AÇMAZ", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ apiKey: "AIzaSyD-should-not-be-stored", address: "Istanbul" }))
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: Record<string, unknown> };
      expect(block.data.apiKey).toBeUndefined();
    }
  });
});

describe("google-map — boş blok autosave edilebilir (mimar §5/4: .superRefine YOK)", () => {
  it("hiçbir alanı olmayan boş data kabul edilir (422 üretilmez)", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({})));
    expect(result.success).toBe(true);
  });

  it("yalnızca address dolu (Mod B) kabul edilir", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ address: "Levent, İstanbul", zoom: 14 }))
    );
    expect(result.success).toBe(true);
  });

  it("address 300 karakteri aşarsa 422", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ address: "a".repeat(301) }))
    );
    expect(result.success).toBe(false);
  });

  it("markerTitle 120 karakteri aşarsa 422", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ markerTitle: "a".repeat(121) }))
    );
    expect(result.success).toBe(false);
  });

  it("mapStyle kapalı enum dışı bir değer için 422", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ mapStyle: "neon" })));
    expect(result.success).toBe(false);
  });

  it.each(["standard", "dark", "silver", "retro"] as const)("mapStyle: %s kabul edilir", (mapStyle) => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ mapStyle })));
    expect(result.success).toBe(true);
  });
});

describe("google-map — widthMode (frontend `types.ts::GoogleMapBlock.data.widthMode` ile BİREBİR aynı alan, `ContainerLayout` ile AYNI isimlendirme kalıbı)", () => {
  it("widthMode olmadan (eski kayıt şekli) hâlâ geçerli — regresyon", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({})));
    expect(result.success).toBe(true);
  });

  it.each(["boxed", "full-width"] as const)("widthMode: %s kabul edilir", (widthMode) => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ widthMode })));
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { data: Record<string, unknown> };
      expect(block.data.widthMode).toBe(widthMode);
    }
  });

  it("widthMode kapalı enum dışı bir değer (örn. 'center') için 422", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ widthMode: "center" })));
    expect(result.success).toBe(false);
  });
});

describe("PageNodeSchema dispatch — google-map dalı gerçekten doğruluyor (mimar §9 R2, KRİTİK regresyon testi)", () => {
  it("geçersiz google-map verisi (kötü embedUrl) 422 ÜRETİR — dispatch dalı unutulsaydı bu SESSİZCE geçerdi", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ embedUrl: "https://evil.com/maps/embed?x=1" }))
    );
    expect(result.success).toBe(false);
  });

  it("geçersiz google-map verisi (zoom aralık dışı) 422 ÜRETİR", () => {
    const result = CreatePageRequestSchema.safeParse(pageWithBlock(googleMapBlock({ zoom: 999 })));
    expect(result.success).toBe(false);
  });

  it("geçersiz google-map verisi (unknown type ile karşılaştırma kontrolü — record(unknown) fallback'i kanıtlama): tamamen serbest bir tip (örn. 'hero') AYNI kötü zoom değerini taşırsa BİLE geçerli kalır (bu, google-map'in dar şemadan geçtiğinin negatif kanıtıdır)", () => {
    const freeform = CreatePageRequestSchema.safeParse(
      pageWithBlock({ id: "hero-1", type: "hero", data: { zoom: 999, embedUrl: "https://evil.com/x" } })
    );
    expect(freeform.success).toBe(true);

    const mapVersion = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ zoom: 999, embedUrl: "https://evil.com/x" }))
    );
    expect(mapVersion.success).toBe(false);
  });

  it("geçerli bir google-map bloğu başarıyla doğrulanır ve normalize edilmiş veri döner", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock(googleMapBlock({ address: "Kadıköy, İstanbul", zoom: 16, mapStyle: "dark" }))
    );
    expect(result.success).toBe(true);
    if (result.success) {
      const block = result.data.blocks?.[0] as unknown as { type: string; data: Record<string, unknown> };
      expect(block.type).toBe("google-map");
      expect(block.data.address).toBe("Kadıköy, İstanbul");
      expect(block.data.zoom).toBe(16);
      expect(block.data.mapStyle).toBe("dark");
    }
  });
});

describe("accordion — layoutStyle + items[].isOpenDefault (mimar §2.2/§5/7)", () => {
  const baseItems = [{ id: "q1", question: "Soru?", answer: "Cevap." }];

  it("layoutStyle olmadan (eski kayıt şekli) hâlâ geçerli — regresyon", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock({ id: "acc-1", type: "accordion", data: { items: baseItems, allowMultipleOpen: false } })
    );
    expect(result.success).toBe(true);
  });

  it.each(["bordered", "card", "minimal"] as const)("layoutStyle: %s kabul edilir", (layoutStyle) => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock({
        id: "acc-1",
        type: "accordion",
        data: { items: baseItems, allowMultipleOpen: false, layoutStyle },
      })
    );
    expect(result.success).toBe(true);
  });

  it("layoutStyle kapalı enum dışı bir değer için 422", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock({
        id: "acc-1",
        type: "accordion",
        data: { items: baseItems, allowMultipleOpen: false, layoutStyle: "fancy" },
      })
    );
    expect(result.success).toBe(false);
  });

  it("items[].isOpenDefault kabul edilir", () => {
    const result = CreatePageRequestSchema.safeParse(
      pageWithBlock({
        id: "acc-1",
        type: "accordion",
        data: {
          items: [{ id: "q1", question: "Soru?", answer: "Cevap.", isOpenDefault: true }],
          allowMultipleOpen: false,
        },
      })
    );
    expect(result.success).toBe(true);
  });
});

describe("before-after-slider — initialSliderPosition (mimar §2.3)", () => {
  const base = { beforeUrl: "/a.jpg", afterUrl: "/b.jpg", beforeLabel: "Önce", afterLabel: "Sonra" };

  it("initialSliderPosition olmadan (eski kayıt şekli) hâlâ geçerli — regresyon", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "bas-1", type: "before-after-slider", data: base }],
    });
    expect(result.success).toBe(true);
  });

  it("initialSliderPosition: 0..100 tam sayı aralığında kabul edilir", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "bas-1", type: "before-after-slider", data: { ...base, initialSliderPosition: 30 } }],
    });
    expect(result.success).toBe(true);
  });

  it("initialSliderPosition: 101 → 422", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "bas-1", type: "before-after-slider", data: { ...base, initialSliderPosition: 101 } }],
    });
    expect(result.success).toBe(false);
  });

  it("initialSliderPosition: -1 → 422", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "bas-1", type: "before-after-slider", data: { ...base, initialSliderPosition: -1 } }],
    });
    expect(result.success).toBe(false);
  });
});

describe("pricing-table — billingInterval (mimar §2.4)", () => {
  const basePlan = {
    id: "p1",
    name: "Başlangıç",
    price: "₺100",
    features: ["Özellik 1"],
    buttonLabel: "Seç",
    buttonHref: "/iletisim",
  };

  it("billingInterval olmadan (eski kayıt şekli) hâlâ geçerli — regresyon", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "pt-1", type: "pricing-table", data: { plans: [basePlan] } }],
    });
    expect(result.success).toBe(true);
  });

  it.each(["monthly", "yearly"] as const)("billingInterval: %s kabul edilir", (billingInterval) => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "pt-1", type: "pricing-table", data: { plans: [basePlan], billingInterval } }],
    });
    expect(result.success).toBe(true);
  });

  it("billingInterval kapalı enum dışı bir değer için 422", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "pt-1", type: "pricing-table", data: { plans: [basePlan], billingInterval: "weekly" } }],
    });
    expect(result.success).toBe(false);
  });
});

describe("logo-marquee — displayMode + grayscale (mimar §2.5, R1: grayscale ?? true zorunlu davranış)", () => {
  const baseItems = [{ id: "l1", url: "/logo.png", alt: "Logo" }];

  it("displayMode/grayscale olmadan (eski kayıt şekli) hâlâ geçerli — regresyon", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "lm-1", type: "logo-marquee", data: { items: baseItems } }],
    });
    expect(result.success).toBe(true);
  });

  it.each(["marquee", "grid"] as const)("displayMode: %s kabul edilir", (displayMode) => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "lm-1", type: "logo-marquee", data: { items: baseItems, displayMode } }],
    });
    expect(result.success).toBe(true);
  });

  it("grayscale: false açıkça gönderilebilir (varsayılan DEĞİL, kullanıcı seçimi)", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "lm-1", type: "logo-marquee", data: { items: baseItems, grayscale: false } }],
    });
    expect(result.success).toBe(true);
  });

  it("displayMode kapalı enum dışı bir değer için 422", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "lm-1", type: "logo-marquee", data: { items: baseItems, displayMode: "carousel" } }],
    });
    expect(result.success).toBe(false);
  });
});

describe("video — coverUrl/playStyle/loop (mimar §2.6, security-review §5 ONAYLANDI)", () => {
  const base = { provider: "youtube" as const, url: "https://youtube.com/watch?v=abc" };

  it("coverUrl/playStyle/loop olmadan (eski kayıt şekli) hâlâ geçerli — regresyon", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "vid-1", type: "video", data: base }],
    });
    expect(result.success).toBe(true);
  });

  it("coverUrl SafeHrefSchema OLMADAN (relative/serbest) kabul edilir — beforeUrl/afterUrl ile aynı serbestlik", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "vid-1", type: "video", data: { ...base, coverUrl: "/uploads/cover.jpg" } }],
    });
    expect(result.success).toBe(true);
  });

  it.each(["inline", "lightbox"] as const)("playStyle: %s kabul edilir", (playStyle) => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "vid-1", type: "video", data: { ...base, playStyle } }],
    });
    expect(result.success).toBe(true);
  });

  it("loop: true kabul edilir", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "vid-1", type: "video", data: { ...base, loop: true } }],
    });
    expect(result.success).toBe(true);
  });

  it("playStyle kapalı enum dışı bir değer için 422", () => {
    const result = CreatePageRequestSchema.safeParse({
      title: "x",
      blocks: [{ id: "vid-1", type: "video", data: { ...base, playStyle: "modal" } }],
    });
    expect(result.success).toBe(false);
  });
});
