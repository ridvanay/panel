import type { SocialPlatform } from "@/lib/api/types";

// ============================================================================
// Page-builder hiyerarşik konteyner (container) veri modeli — v3.
// Kaynak: `.claude/design-notes-page-builder-containers.md` §3 (BİREBİR uygulama).
// Backend karşılığı: `backend/src/modules/pages/pages.schemas.ts` — sayısal sabitler
// (bkz. §5 aşağıda) ARALARINDA SAYISAL OLARAK BİREBİR AYNI olmak zorundadır.
// ============================================================================

// ============================================================================
// 1) İÇERİK BLOKLARI — data şekilleri BİREBİR DEĞİŞMEZ (geriye dönük uyumluluk)
// ============================================================================

export type ContentBlockType =
  | "hero"
  | "text"
  | "image"
  | "gallery"
  | "cta"
  | "featured-products"
  | "featured-portfolio"
  | "heading"
  | "button"
  | "icon-box"
  | "divider"
  | "video"
  | "accordion"
  | "tabs"
  | "counter"
  | "testimonial"
  | "pricing-table"
  | "latest-posts"
  | "contact-form"
  | "custom-html"
  | "before-after-slider"
  | "logo-marquee"
  | "skill-bar"
  | "team"
  | "advanced-slider"
  | "google-map";

/** Kanonik konteyner düğümü. */
export type ContainerNodeType = "container";

/** v1/v2'de üretilmiş, ARTIK ÜRETİLMEYEN şekil — yalnızca `normalize.ts` tanır. */
export type LegacyBlockType = "columns";

export type BlockType = ContentBlockType | ContainerNodeType;

/**
 * Giriş Animasyonu (Scroll Reveal) — orkestratör kararı (nihai veri modeli, mimar onaylı):
 * `BaseNode`'a eklenir, böylece hem `ContainerNode` hem TÜM `ContentBlock` union üyeleri
 * (23 blok) `data`/`settings` şemalarına DOKUNMADAN bu alanı otomatik kazanır. `"none"` efekti
 * VEYA `reveal` alanının hiç OLMAMASI davranışsal olarak AYNI (animasyon uygulanmaz) — ikisi de
 * geçerli "kapalı" hali (bkz. `site/blocks/scroll-reveal.tsx`).
 */
export type RevealEffect =
  | "none"
  | "fade-in"
  | "fade-up"
  | "fade-down"
  | "slide-left"
  | "slide-right"
  | "zoom-in"
  | "flip-up";
/** Milisaniye — kapalı bir sayısal küme (serbest `number` DEĞİL), native `<input type="range">`
 *  slider ile 100ms adımlarla seçilir (bkz. `builder-canvas.tsx::RevealEffectControl`). */
export type RevealDelay = 0 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000;
/** Milisaniye — kapalı bir sayısal küme, `SegmentedToggle` ile seçilir (Hızlı/Normal/Yavaş). */
export type RevealDuration = 300 | 600 | 1000;

export interface RevealEffectSettings {
  effect: RevealEffect;
  delayMs: RevealDelay;
  /** Opsiyonel — yoksa `600` (bugünkü sabit CSS değeriyle BİREBİR aynı varsayılan). */
  durationMs?: RevealDuration;
  /** Opsiyonel — yoksa `true` (bugünkü TEK-SEFERLİK davranışla BİREBİR aynı varsayılan). */
  once?: boolean;
}

interface BaseNode {
  id: string;
  /** Opsiyonel — verilmemişse (veya `effect: "none"`) hiçbir giriş animasyonu uygulanmaz. */
  reveal?: RevealEffectSettings;
}

export interface HeroBlock extends BaseNode {
  type: "hero";
  data: { heading: string; subheading?: string; imageUrl?: string };
}

export interface TextBlock extends BaseNode {
  type: "text";
  data: { html: string };
}

/** Görselin köşe yuvarlaklığı — sabit Tailwind sınıf tablosuna eşlenir (bkz. `site/blocks/image-block.tsx`). */
export type ImageRadius = "none" | "sm" | "md" | "lg" | "full";

export interface ImageBlock extends BaseNode {
  type: "image";
  data: {
    url: string;
    alt: string;
    /** §Faz "Medya & İnteraktif" — YENİ alanlar, hepsi OPSİYONEL (geriye dönük uyumluluk: eski
     *  kayıtlarda YOK, okuyan taraf `??` ile varsayılana düşer). */
    caption?: string;
    radius?: ImageRadius;
    /** `true` ise görsele tıklamak `gallery-lightbox.tsx`'i TEK görsellik bir dizi ile açar. */
    lightbox?: boolean;
  };
}

/** Galeri bloğunun görsel düzeni — bkz. `.claude/design-notes-page-builder-gallery.md`. */
export type GalleryLayout = "grid" | "carousel" | "masonry";

export interface GalleryBlock extends BaseNode {
  type: "gallery";
  data: {
    images: { url: string; alt: string }[]; // MEVCUT şekil DEĞİŞMEZ — geriye dönük uyumluluk
    /**
     * Eski kayıtlarda YOK olabilir — okuyan taraf `block.data.layout ?? "grid"` ile
     * varsayılana düşer (bkz. `components/site/blocks/gallery-block.tsx`).
     */
    layout: GalleryLayout;
  };
}

/**
 * CTA kutusunun görsel tonu — HAM CSS/renk DEĞERİ DEĞİL, sabit bir sınıf tablosuna eşlenen kısa
 * isimler (`ImageRadius`/`ButtonBlock.style` ile AYNI desen; konteynerin serbest `background`
 * sistemi BURADA KASITLI OLARAK KULLANILMAZ — CTA yalnızca tema paletinden birkaç hazır tonu
 * sunar, isteyen kullanıcı bloğu bir `container` içine koyup tam background kontrolü alır).
 * `plain` = bugünkü kutusuz görünüm (eski kayıtların ve yeni blokların VARSAYILANI).
 */
export type CtaStyle = "plain" | "soft" | "solid" | "outline";

export interface CtaBlock extends BaseNode {
  type: "cta";
  data: {
    heading: string; // MEVCUT şekil DEĞİŞMEZ — geriye dönük uyumluluk
    buttonLabel: string;
    buttonHref: string;
    /** §Faz "Pazarlama & Sosyal Kanıt" — YENİ alanlar, hepsi OPSİYONEL (geriye dönük uyumluluk:
     *  eski kayıtlarda YOK, okuyan taraf `??` ile varsayılana düşer — `ImageBlock` ile AYNI desen).
     *  Varsayılanlar bugünkü render'ı BİREBİR korur: `align ?? "center"`, `style ?? "plain"`. */
    description?: string;
    align?: TextAlign;
    style?: CtaStyle;
    /** İkincil (düşük vurgulu) buton. İkisi de DOLU değilse buton HİÇ render EDİLMEZ —
     *  yarım yapılandırma sessizce yok sayılır (etiketsiz/hedefsiz buton üretilmez). */
    secondaryButtonLabel?: string;
    secondaryButtonHref?: string;
  };
}

/**
 * §Faz 4 Site Şablonu — `products`/`portfolio` modülleri kapalıyken bu bloklar public tarafta
 * SESSİZCE hiçbir şey render ETMEZ (bkz. components/site/blocks). Şablon SADECE ÖNERİ niteliğinde,
 * bu bloklar herhangi bir modülü otomatik açmaz/kapatmaz.
 */
export interface FeaturedProductsBlock extends BaseNode {
  type: "featured-products";
  data: { heading?: string; limit: number; categoryId?: string };
}

export interface FeaturedPortfolioBlock extends BaseNode {
  type: "featured-portfolio";
  data: { heading?: string; limit: number; categoryId?: string };
}

/**
 * §Faz 4 "Dinamik & CMS İçerikleri" (bu turda — yukarıdaki "§Faz 4 Site Şablonu" yorumuyla
 * KARIŞTIRILMASIN, o daha ÖNCEKİ bir tur) — Son Blog Yazıları. `featured-products`/
 * `featured-portfolio` ile AYNI desen: public tarafta blog modülü fetch edilip bellekte
 * filtrelenir/sıralanır/kırpılır (bkz. `site/blocks/latest-posts-block.tsx`), boş sonuç
 * SESSİZCE hiçbir şey render ETMEZ. Blog, `products`/`portfolio`'nun aksine kapatılabilir bir
 * modül DEĞİLDİR (`backend/lib/module-registry.ts`) — bu yüzden "modül kapalı" uyarısı YOK.
 */
export const LATEST_POSTS_MAX_LIMIT = 12;

export interface LatestPostsBlock extends BaseNode {
  type: "latest-posts";
  /** `categoryId`/`tagId` İKİSİ DE verilirse VE (AND) mantığıyla birlikte uygulanır. */
  data: { heading?: string; limit: number; categoryId?: string; tagId?: string };
}

/**
 * İletişim / Form Bloğu — kendi alan şemasını TAŞIMAZ (ad/e-posta/konu/mesaj gibi alanları
 * BURADA yeniden TANIMLAMAZ). Site genelinde TEK bir `ContactForm` (singleton, KVKK onayı/
 * honeypot/bildirim e-postası zaten `/admin/contact`'ta yönetiliyor — bkz.
 * `components/site/contact-form.tsx::ContactFormClient`) bu blokla sayfanın İSTENEN noktasına
 * GÖMÜLÜR. `showTitle` yalnızca formun kendi `title`/`description`'ını bu blokta göster/gizle —
 * sayfanın zaten kendi başlığı varsa yinelenmeyi önler.
 */
export interface ContactFormBlock extends BaseNode {
  type: "contact-form";
  data: { showTitle: boolean };
}

/**
 * Özel HTML / Kod Bloğu — harici widget/harita (`iframe`) gömme. `html` DB'ye yazılmadan ÖNCE
 * backend'de `lib/html-sanitize.ts::sanitizeCustomHtmlBlock` ile temizlenir (`text` bloğunun
 * `sanitizeRichHtml`'inden AYRI, DAHA GENİŞ bir izin listesi — yalnızca bu blok `iframe`e izin
 * verir, `script`/`style`/`object`/`embed`/`form` HİÇBİR ZAMAN). Frontend `text` bloğuyla AYNI
 * "yazma-anında temizlenir, okuma-anında OLDUĞU GİBİ `dangerouslySetInnerHTML`" deseni — burada
 * İKİNCİ bir sanitizasyon YAPILMAZ (tek temizleme yolu, bkz. `html-sanitize.ts` başlığı).
 */
export const CUSTOM_HTML_MAX_LENGTH = 20000;

export interface CustomHtmlBlock extends BaseNode {
  type: "custom-html";
  data: { html: string };
}

/**
 * Öncesi / Sonrası Karşılaştırma — iki görsel, ortada sürüklenebilir bir tutamaç. `orientation`
 * tutamacın hareket YÖNÜ: `"horizontal"` sol-sağ sürüklenir (dikey bölme çizgisi), `"vertical"`
 * yukarı-aşağı sürüklenir (yatay bölme çizgisi) — kullanıcı isteğindeki "dikey/yatay tutamaç"
 * ifadesiyle BİREBİR. `beforeUrl`/`afterUrl` `ImageBlock.url` ile AYNI serbestlik (yalnızca
 * `<img src>`, `iframe`/CSS enjeksiyon yüzeyi YOK — protokol beyaz listesi GEREKMEZ).
 */
export type BeforeAfterOrientation = "horizontal" | "vertical";

export interface BeforeAfterSliderBlock extends BaseNode {
  type: "before-after-slider";
  data: {
    beforeUrl: string;
    afterUrl: string;
    beforeLabel: string;
    afterLabel: string;
    orientation: BeforeAfterOrientation;
    /** YENİ, OPSİYONEL (google-map-corporate-blocks turu, mimar §2.3) — tam sayı 0..100, yoksa
     *  render `useState(initialSliderPosition ?? 50)` ile bugünkü sabit %50 davranışı korunur. */
    initialSliderPosition?: number;
  };
}

/** Logo Bandı (Marquee) — kesintisiz akan yatay şerit, bkz. `globals.css::pb-marquee-track`. */
export const LOGO_MARQUEE_MAX_ITEMS = 20;

export interface LogoMarqueeItem {
  id: string;
  url: string;
  alt: string;
  /** Opsiyonel — verilirse logo tıklanabilir bir bağlantı olur (ör. partner sitesi). */
  href?: string;
}

/** `logo-marquee.displayMode` — YENİ (mimar §2.5). `displayMode: "grid"` iken `speedSeconds`/
 *  `pauseOnHover` ANLAMSIZDIR; veri modelinde KALIR (mod değiştirip geri dönünce ayar kaybolmasın). */
export type LogoDisplayMode = "marquee" | "grid";

export interface LogoMarqueeBlock extends BaseNode {
  type: "logo-marquee";
  data: {
    items: LogoMarqueeItem[];
    /** Bir TAM döngünün saniye cinsinden süresi — küçük değer HIZLI akış demektir. */
    speedSeconds: number;
    pauseOnHover: boolean;
    /** YENİ, OPSİYONEL — yoksa `displayMode ?? "marquee"` (bugünkü tek davranış). */
    displayMode?: LogoDisplayMode;
    /** YENİ, OPSİYONEL — **`grayscale ?? true` KULLANILMAK ZORUNDADIR** (mimar §1.2/R1: bugün KOD
     *  İÇİNDE SABİT hard-code `grayscale hover:grayscale-0`; `?? false` yazılırsa TÜM mevcut logo
     *  bantlarının görünümü sessizce değişir — bu KESİNLİKLE YASAK). */
    grayscale?: boolean;
  };
}

/** İlerleme Çubuğu & Yetenekler — `percent` KASITLI OLARAK sayı (0-100), serbest metin DEĞİL. */
export const SKILL_BAR_MAX_ITEMS = 12;

export interface SkillBarItem {
  id: string;
  label: string;
  percent: number;
  /** Opsiyonel — verilmezse site temasının `--site-primary` rengi kullanılır. */
  color?: string;
}

export interface SkillBarBlock extends BaseNode {
  type: "skill-bar";
  data: { items: SkillBarItem[] };
}

/**
 * Ekip Üyesi Kartı — birden fazla üye (`icon-box`/`testimonial` ile AYNI "tekrarlı liste"
 * deseni). `socialLinks[].platform` `SocialPlatform` (bkz. `lib/api/types.ts` — site footer'ının
 * "sosyal hesap linkleri" özelliğiyle AYNI kapalı platform kümesi, bu lucide-react sürümünde
 * marka ikonu OLMADIĞI için `site-footer.tsx`teki AYNI anlamsal-yakın ikon eşlemesi
 * `lib/social-platform-icons.ts`ten PAYLAŞILIR).
 */
export const TEAM_MAX_MEMBERS = 12;
export const TEAM_MAX_SOCIAL_LINKS_PER_MEMBER = 5;

export interface TeamMemberSocialLink {
  id: string;
  platform: SocialPlatform;
  url: string;
}

export interface TeamMember {
  id: string;
  /** Opsiyonel — yoksa ad-soyaddan baş harf rozetine düşer (`testimonial` avatarıyla AYNI desen). */
  photoUrl?: string;
  name: string;
  role?: string;
  bio?: string;
  socialLinks: TeamMemberSocialLink[];
}

export interface TeamBlock extends BaseNode {
  type: "team";
  data: { members: TeamMember[] };
}

/**
 * Gelişmiş Slider / Hero Studio — blok İÇERİK TAŞIMAZ, yalnızca var olan bir
 * `Slider` kaydına REFERANS tutar (bkz. .claude/architect-scope-advanced-slider.md
 * §6.1). Slayt/katman verisi `/admin/sliders` ile yönetilir, `Page.blocks` içinde
 * ÇOĞALTILMAZ.
 *
 * `sliderId` OPSİYONEL — yeni eklenen blok henüz seçim yapılmamış haldedir
 * (`createBlock` bu alanı hiç EKLEMEZ; boş string backend'de `.uuid()`e takılırdı,
 * `CtaBlock.secondaryButton*` ile AYNI "omit et" deseni). Seçim yapılmamış VEYA
 * silinmiş bir slider → public tarafta SESSİZCE hiçbir şey render edilmez.
 */
export interface AdvancedSliderBlock extends BaseNode {
  type: "advanced-slider";
  data: { sliderId?: string };
}

/** §Faz "Temel Elemanlar" — H1-H6, hizalama, opsiyonel alt çizgi vurgusu. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type TextAlign = "left" | "center" | "right";

export interface HeadingBlock extends BaseNode {
  type: "heading";
  data: { text: string; level: HeadingLevel; align: TextAlign; underline: boolean };
}

/**
 * `style`/`size` HAM CSS DEĞERİ DEĞİL — `@/components/ui/link-button.tsx::LinkButton`'ın
 * `buttonVariants`'ına eşlenen kısa isimler (bkz. `site/blocks/button-block.tsx`). `icon`
 * VARSA `lib/page-builder/icon-options.ts::resolveIcon`'dan geçer — bilinmeyen/eski bir isim
 * güvenli bir varsayılana düşer, ASLA dinamik import/require yapılmaz.
 */
export interface ButtonBlock extends BaseNode {
  type: "button";
  data: { label: string; href: string; style: "solid" | "outline" | "ghost"; size: "sm" | "md" | "lg"; icon?: string; align: TextAlign };
}

/** İkon Kutusu — `icon` aynı `icon-options.ts` allowlist'inden. */
export interface IconBoxBlock extends BaseNode {
  type: "icon-box";
  data: { icon: string; heading: string; description: string; href?: string };
}

/**
 * Ayırıcı VE Boşluk TEK blok tipi olarak modellenir (kullanıcı isteğinde "Ayırıcı & Boşluk"
 * tek madde) — `variant` ayrımlar. `style` yalnızca `variant: "line"` iken anlamlıdır.
 */
export interface DividerBlock extends BaseNode {
  type: "divider";
  data: { variant: "line" | "space"; style: "solid" | "dashed"; height: number };
}

/**
 * §Faz "Medya & İnteraktif" — Video Oynatıcı. `url` sağlayıcıya göre farklı biçimlerde olabilir
 * (YouTube/Vimeo sayfa URL'i VEYA doğrudan `.mp4` dosya URL'i) — GERÇEK embed URL'i render
 * anında `lib/page-builder/video-embed.ts::getVideoEmbedUrl` ile HESAPLANIR, ham `url` HİÇBİR
 * ZAMAN doğrudan bir `<iframe src>`e YAZILMAZ (yalnızca sağlayıcının KENDİ domanindeki, id'si
 * regex ile ÇIKARILMIŞ bir embed URL'i inşa edilir) — bu, gelecekteki "Özel HTML" bloğunun da
 * izleyeceği "yapılandırılmış embed" güvenlik deseninin İLK örneğidir.
 */
export type VideoProvider = "youtube" | "vimeo" | "mp4";

/** `video.playStyle` — YENİ (mimar §2.6). `inline` = bugünkü davranış (doğrudan gömülü oynatıcı).
 *  `lightbox` = kapak görseli + oynat rozeti tetikleyicisi, tıklanınca `gallery-lightbox.tsx`
 *  desenindeki tam ekran modalde oynatılır. */
export type VideoPlayStyle = "inline" | "lightbox";

export interface VideoBlock extends BaseNode {
  type: "video";
  data: {
    provider: VideoProvider;
    url: string;
    autoplay: boolean;
    muted: boolean;
    /** YENİ, OPSİYONEL — yalnızca `<img src>` bağlamında kullanılır (security-review §5): asla
     *  `<a href>`/CSS `background-image`/`<iframe src>` DEĞİL. `playStyle: "lightbox"` iken
     *  tetikleyici kartın kapak görseli; yoksa düz siyah kutu + oynat simgesi (boş render EDİLMEZ). */
    coverUrl?: string;
    /** YENİ, OPSİYONEL — yoksa `playStyle ?? "inline"` (bugünkü davranış). */
    playStyle?: VideoPlayStyle;
    /** YENİ, OPSİYONEL — yoksa `loop ?? false`. Sağlayıcıya göre farklı uygulanır (bkz.
     *  `video-embed.ts::getVideoEmbedUrl`): YouTube `loop=1` TEK BAŞINA ÇALIŞMAZ, `playlist=<id>`
     *  de gerekir; Vimeo `loop=1`; `mp4` → `<video loop>`. */
    loop?: boolean;
  };
}

/** Bir konteynerdeki toplam öğe sınırlarından (§5) BAĞIMSIZ, bloğa ÖZGÜ üst sınırlar — backend
 *  `pages.schemas.ts`teki `ACCORDION_MAX_ITEMS`/`TABS_MAX_ITEMS` ile SAYISAL OLARAK BİREBİR AYNI
 *  olmak zorundadır (bkz. dosya başlığındaki §5 aynı uyarı). */
export const ACCORDION_MAX_ITEMS = 20;
export const TABS_MAX_ITEMS = 10;

export interface AccordionQAItem {
  id: string;
  question: string;
  /** KASITLI OLARAK düz metin (HTML DEĞİL) — hem yeni bir sanitizasyon yolu AÇMAMAK için hem de
   *  Schema.org FAQPage JSON-LD çıktısının (bkz. site render) temiz/geçerli kalması için. */
  answer: string;
  /** YENİ, OPSİYONEL (google-map-corporate-blocks turu, mimar §2.2). `allowMultipleOpen === false`
   *  iken birden fazla öğe işaretliyse render tarafı YALNIZCA İLKİNİ açar (`Accordion defaultValue`
   *  tek elemanlı dizi alır) — editör bunu bir UYARI ile bildirir, engellemez. */
  isOpenDefault?: boolean;
}

/** `accordion.layoutStyle` — sabit sınıf tablosuna eşlenir (bkz. `site/blocks/accordion-block.tsx`
 *  `ACCORDION_LAYOUT_CLASSES`, ui-designer §2). `bordered` = bugünkü görünüm, PİKSEL-EŞ. */
export type AccordionLayoutStyle = "bordered" | "card" | "minimal";

/** Akordiyon / SSS — Schema.org FAQPage JSON-LD üretir (bkz. `site/blocks/accordion-block.tsx`). */
export interface AccordionBlock extends BaseNode {
  type: "accordion";
  data: {
    items: AccordionQAItem[];
    allowMultipleOpen: boolean;
    /** YENİ, OPSİYONEL — yoksa `layoutStyle ?? "bordered"` bugünkü görünümle piksel-eş davranır. */
    layoutStyle?: AccordionLayoutStyle;
  };
}

export interface TabItem {
  id: string;
  label: string;
  /** `answer` ile AYNI gerekçe — düz metin, satır sonları paragraf olarak render edilir. */
  content: string;
}

export interface TabsBlock extends BaseNode {
  type: "tabs";
  data: { orientation: "horizontal" | "vertical"; items: TabItem[] };
}

/** §Faz "Pazarlama & Sosyal Kanıt" — bloğa ÖZGÜ üst sınırlar; `ACCORDION_MAX_ITEMS` ile AYNI
 *  gerekçe ve AYNI kural: backend `pages.schemas.ts` ile SAYISAL OLARAK BİREBİR AYNI olmak
 *  zorundadır (bkz. dosya başlığındaki §5 uyarısı). */
export const COUNTER_MAX_ITEMS = 8;
export const TESTIMONIAL_MAX_ITEMS = 12;
export const PRICING_MAX_PLANS = 6;
/** Plan BAŞINA özellik satırı sınırı (plan sayısından BAĞIMSIZ). */
export const PRICING_MAX_FEATURES = 15;

export interface CounterItem {
  id: string;
  /** KASITLI OLARAK sayı (string DEĞİL) — biçimlendirme (binlik ayracı) render anında
   *  `Intl.NumberFormat("tr-TR")` ile yapılır, kullanıcı "500.000" yazıp ayracı elle KURGULAMAZ.
   *  Metinsel varyasyonlar (`"500+"`, `"%98"`) `prefix`/`suffix` ile ifade edilir. */
  value: number;
  /** Sayının ÖNÜNE eklenen düz metin — ör. `"%"`, `"₺"`. */
  prefix?: string;
  /** Sayının ARKASINA eklenen düz metin — ör. `"+"`, `"K"`. */
  suffix?: string;
  label: string;
}

/** Sayaç / İstatistik — ör. "500+ Müşteri", "%98 Memnuniyet". */
export interface CounterBlock extends BaseNode {
  type: "counter";
  data: { items: CounterItem[] };
}

/** 1–5 arası tam yıldız — yarım yıldız KASITLI OLARAK DESTEKLENMEZ (MVP). */
export type TestimonialRating = 1 | 2 | 3 | 4 | 5;

export interface TestimonialItem {
  id: string;
  /** `AccordionQAItem.answer` ile AYNI gerekçe — düz metin (HTML DEĞİL), yeni bir sanitizasyon
   *  yolu açılmaz; satır sonları paragraf olarak render edilir. */
  quote: string;
  authorName: string;
  authorRole?: string;
  /** `ImageBlock.url`/`GalleryBlock.images[].url` ile AYNI serbestlik: göreli yol VEYA mutlak
   *  http(s) URL. Backend'de konteyner background görseliyle AYNI katılıkta protokol beyaz
   *  listesinden geçer (`SafeHrefSchema`) — `javascript:`/`data:` ASLA kabul edilmez. */
  avatarUrl?: string;
  rating?: TestimonialRating;
}

/** Müşteri Yorumları — sosyal kanıt kartları. */
export interface TestimonialBlock extends BaseNode {
  type: "testimonial";
  data: { items: TestimonialItem[] };
}

export interface PricingPlan {
  id: string;
  name: string;
  /** KASITLI OLARAK serbest metin (sayı DEĞİL) — `"₺299"`, `"Ücretsiz"`, `"Bize Sorun"` gibi
   *  biçimlerin HEPSİ geçerlidir; para birimi/biçim kararı içerik yazarına aittir. */
  price: string;
  /** Fiyatın yanında küçük punto ile gösterilen dönem — ör. `"/ay"`, `"/yıl"`. */
  period?: string;
  description?: string;
  /** Düz metin satırları; en fazla `PRICING_MAX_FEATURES` adet. */
  features: string[];
  /** `true` ise plan "öne çıkan" olarak vurgulanır. Birden fazla plan işaretlenebilir —
   *  tip seviyesinde "tek highlight" kısıtı YOKTUR, editör bunu bir UYARI ile bildirir. */
  highlighted?: boolean;
  buttonLabel: string;
  buttonHref: string;
}

/** `pricing-table.billingInterval` — YENİ (mimar §2.4). v1'de SALT GÖRSEL bir etikettir
 *  ("Aylık"/"Yıllık" rozeti); interaktif geçiş anahtarı KAPSAM DIŞIDIR. Yoksa hiçbir ek etiket
 *  render EDİLMEZ. */
export type PricingBillingInterval = "monthly" | "yearly";

/** Fiyatlandırma Tablosu — yan yana plan kartları. */
export interface PricingTableBlock extends BaseNode {
  type: "pricing-table";
  data: { plans: PricingPlan[]; billingInterval?: PricingBillingInterval };
}

/**
 * Google Harita — YENİ (mimar §2.1, `.claude/architect-scope-google-map-corporate-blocks.md`).
 * Backend karşılığı: `backend/src/modules/pages/pages.schemas.ts::GoogleMapBlockDataSchema` —
 * alan adları/opsiyonellik BİREBİR aynı olmak ZORUNDADIR.
 *
 * İki kaynak modu (bağlayıcı davranış, bkz. `lib/page-builder/map-embed.ts::getMapEmbedUrl`):
 * `embedUrl` DOLU ve security-review §2 NİHAİ regex'inden GEÇİYORSA → aynen kullanılır. Aksi
 * halde `address` DOLU ise sabit bir şablondan embed URL'i İNŞA EDİLİR. İkisi de yoksa/geçersizse
 * `getMapEmbedUrl` `null` döner, hiçbir şey render EDİLMEZ (throw YOK).
 *
 * `apiKey` alanı KASITLI OLARAK YOKTUR (mimar §3.1, security-review §1 ONAYLANDI) — `Page.blocks`
 * public API'de ham JSON döner, bu yüzeyde hiçbir sır tutulamaz.
 */
export type GoogleMapStyle = "standard" | "dark" | "silver" | "retro";

export interface GoogleMapHeight {
  value: number;
  unit: "px" | "vh";
}

export interface GoogleMapBlock extends BaseNode {
  type: "google-map";
  data: {
    /** Mod A. Google'ın "Haritayı paylaş → Haritayı yerleştir" iframe src'i. security-review §2
     *  beyaz listesinden GEÇMEK ZORUNDA. Doluysa `address`/`zoom` URL inşasında KULLANILMAZ. */
    embedUrl?: string;
    /** Mod B (TERCİH EDİLEN). Serbest adres metni — embed URL'i render anında `map-embed.ts`
     *  tarafından SABİT bir şablondan İNŞA EDİLİR (`video-embed.ts` ile AYNI desen). */
    address?: string;
    /** Yalnızca Mod B'de anlamlıdır (Mod A'da zoom, `pb=` parametresinin içine gömülüdür).
     *  1..20, yoksa render `zoom ?? GOOGLE_MAP_DEFAULT_ZOOM` (15). */
    zoom?: number;
    /** Yoksa render `{ value: GOOGLE_MAP_DEFAULT_HEIGHT_PX, unit: "px" }` (400px). */
    height?: GoogleMapHeight;
    /** Yoksa `mapStyle ?? "standard"`. */
    mapStyle?: GoogleMapStyle;
    /** iframe `title` niteliği + görsel etiket. */
    markerTitle?: string;
  };
}

/**
 * `children` TAŞIMAYAN düğümler. v2'nin `LeafBlock`'undan farkı: `hero` ARTIK DAHİLDİR
 * (§3.4 mimar dokümanı — tam-genişlik ihtiyacı artık `container.settings.layout: "full-width"`
 * ile karşılanıyor, tip seviyesinde yasaklamaya gerek kalmadı).
 */
export type ContentBlock =
  | HeroBlock
  | TextBlock
  | ImageBlock
  | GalleryBlock
  | CtaBlock
  | FeaturedProductsBlock
  | FeaturedPortfolioBlock
  | HeadingBlock
  | ButtonBlock
  | IconBoxBlock
  | DividerBlock
  | VideoBlock
  | AccordionBlock
  | TabsBlock
  | CounterBlock
  | TestimonialBlock
  | PricingTableBlock
  | LatestPostsBlock
  | ContactFormBlock
  | CustomHtmlBlock
  | BeforeAfterSliderBlock
  | LogoMarqueeBlock
  | SkillBarBlock
  | TeamBlock
  | AdvancedSliderBlock
  | GoogleMapBlock;

/** @deprecated v2 adı — yalnızca geçiş sırasında import kırılmasın diye. Yeni kodda `ContentBlock` kullanın. */
export type LeafBlock = ContentBlock;

// ============================================================================
// 2) KONTEYNER
// ============================================================================

/** `boxed` = ortalanmış içerik kuyusu (max-width + güvenli gutter). `full-width` = kenardan kenara. */
export type ContainerLayout = "boxed" | "full-width";

export type ContainerDirection = "row" | "column";

/**
 * CSS `justify-content` karşılıkları — HAM CSS DEĞERİ SAKLANMAZ (`"flex-start"` gibi),
 * Tailwind sınıf son eki saklanır. Gerekçe: depolanan değer asla doğrudan CSS'e
 * enterpole edilmez, sabit bir sınıf tablosundan geçer (bkz. `container-block.tsx`).
 */
export type ContainerJustify = "start" | "center" | "end" | "between" | "around" | "evenly";

/** CSS `align-items` karşılıkları — aynı gerekçe. */
export type ContainerAlign = "stretch" | "start" | "center" | "end";

export type ContainerLengthUnit = "px" | "vh";

/** Sayısal, birimi enum — serbest CSS string'i DEĞİL. */
export interface ContainerLength {
  value: number;
  unit: ContainerLengthUnit;
}

/** Dört kenar, **piksel** cinsinden tam sayı. Negatif değer YASAK (bkz. mimar §5.2/§13.4). */
export interface ContainerSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type ContainerBackgroundPosition = "center" | "top" | "bottom" | "left" | "right";
export type ContainerBackgroundSize = "cover" | "contain" | "auto";
export type ContainerBackgroundRepeat = "no-repeat" | "repeat";

/**
 * Görsel/video arka planların ÜZERİNE opaklığı ayarlanabilir düz renk katmanı — okunabilirliği
 * artırmak için (ör. koyu bir overlay + üstte beyaz metin). `color` `#rrggbb` (6 hane, `color`
 * arka plan tipinin `#rgb|#rrggbb|#rrggbbaa` regex'inden BİLEREK DAR — alfa `opacity` alanından
 * AYRI yönetilir, ikisinin karışması KAFA KARIŞTIRICI olurdu). `opacity` 0-100 (%), render
 * anında `container-block.tsx::hexToRgba` ile `rgba()`'ya çevrilir.
 */
export interface ContainerBackgroundOverlay {
  color: string;
  opacity: number;
}

/** `gradientType: "linear"` iken yön — HAM CSS DEĞERİ DEĞİL, `container-block.tsx`teki sabit bir
 *  sınıf/değer tablosuna eşlenir (`ContainerJustify`/`ButtonBlock.style` ile AYNI desen).
 *  `custom-angle` seçilirse `angle` (0-360) kullanılır, aksi halde yön sabit tablodan gelir. */
export type LinearGradientDirection =
  | "to-top"
  | "to-top-right"
  | "to-right"
  | "to-bottom-right"
  | "to-bottom"
  | "to-bottom-left"
  | "to-left"
  | "to-top-left"
  | "custom-angle";

/** "Floating / Gradient Wave" (yumuşak geçişli, hareketli) VEYA statik "Subtle Dots"/"Grid"
 *  deseni — üçü de SAF CSS (keyframe/`background-image` gradient), harici kütüphane/JS YOK. */
export type ContainerAnimatedBackgroundVariant = "gradient-wave" | "dots" | "grid";

/**
 * Ayrık birlik (discriminated union) — her `type` alanı için farklı doğrulama kuralları
 * uygulanır (hex regex vs. protokol beyaz listeli URL kontrolü vb.). Tüm yeni renk alanları
 * (`gradient`/`animated`) KASITLI OLARAK `#rrggbb` (6 hane) — `color` arka plan tipinin alfa
 * kanallı regex'inden AYRI, daha dar bir kural (bkz. backend `pages.schemas.ts` "OVERLAY_HEX_RE"
 * yorumu).
 */
export type ContainerBackground =
  | { type: "none" }
  | { type: "color"; value: string }
  | {
      type: "image";
      value: string;
      position: ContainerBackgroundPosition;
      size: ContainerBackgroundSize;
      repeat: ContainerBackgroundRepeat;
      overlay?: ContainerBackgroundOverlay;
    }
  | {
      type: "gradient";
      gradientType: "linear" | "radial";
      colorFrom: string;
      colorTo: string;
      /** Yalnızca `gradientType: "linear"` iken anlamlı. */
      direction?: LinearGradientDirection;
      /** Yalnızca `direction: "custom-angle"` iken anlamlı, 0-360. */
      angle?: number;
    }
  | { type: "animated"; variant: "gradient-wave"; colorFrom: string; colorTo: string }
  | { type: "animated"; variant: "dots"; patternColor: string }
  | { type: "animated"; variant: "grid"; patternColor: string };

/**
 * Şekilli Bölüm Ayırıcıları — orkestratör kararı (nihai veri modeli, mimar onaylı, bkz.
 * `.claude/design-notes-page-builder-editing-tools.md` §2). Render motoru tam-genişlik SVG
 * yollarını `site/blocks/container-block.tsx`teki sabit bir tabloya eşler (bkz. `SHAPE_DIVIDER_PATHS`).
 */
export type ShapeDividerType = "wave" | "slant" | "triangle" | "curve";

export interface ShapeDividerSettings {
  type: ShapeDividerType;
  /** Hex `#rrggbb` — `ColorField` ile aynı doğrulama, alfa kanalı TAŞIMAZ. */
  color: string;
  /** px, `MIN_DIVIDER_HEIGHT`–`MAX_DIVIDER_HEIGHT` arası. */
  height: number;
  /** `true` iken ayırıcı dikey eksende ters çevrilir (render anında `transform: scaleY(-1)`). */
  flip: boolean;
}

export interface ContainerSettings {
  /** `boxed` → ortalanmış + `maxWidth`; `full-width` → `w-full`. */
  layout: ContainerLayout;
  /** YALNIZCA `layout: "boxed"` iken anlamlı. Verilmezse `DEFAULT_CONTAINER_MAX_WIDTH` (1170). */
  customWidth?: number;
  minHeight?: ContainerLength;

  direction: ContainerDirection;
  justifyContent: ContainerJustify;
  alignItems: ContainerAlign;
  /** Piksel. `gap-*` Tailwind sınıfı DEĞİL — dinamik değer, inline style. */
  gap: number;

  padding: ContainerSpacing;
  margin: ContainerSpacing;
  background: ContainerBackground;

  /**
   * Bu konteynerin, `direction: "row"` olan EBEVEYNİ içindeki göreli genişlik ağırlığı.
   * CSS: `flex: <widthFr> 1 0%` (yani `flex-grow`). v2'deki `PageColumn.width` (`fr`)
   * ile SAYISAL OLARAK BİREBİR AYNI anlam — `1fr 2fr` ≡ `flex-grow: 1` + `flex-grow: 2`.
   * Ebeveyn `direction: "column"` ise veya düğüm kökteyse YOK SAYILIR.
   * `customWidth` ile KARIŞTIRILMAMALI: o, konteynerin KENDİ dış max-width'i (px).
   */
  widthFr?: number;

  /**
   * Şekilli Bölüm Ayırıcıları — opsiyonel, `undefined` = kapalı (`MinHeightField` ile AYNI
   * nullable-alan deseni, bkz. `container-settings-panel.tsx::ShapeDividerField`).
   * `DEFAULT_CONTAINER_SETTINGS` bu alanları İÇERMEZ.
   */
  topDivider?: ShapeDividerSettings;
  bottomDivider?: ShapeDividerSettings;
}

export interface ContainerNode extends BaseNode {
  type: "container";
  settings: ContainerSettings;
  children: PageNode[];
}

/** Ağaçtaki herhangi bir düğüm. `Page.blocks` = `PageNode[]` (kök dizi = örtük konteyner). */
export type PageNode = ContainerNode | ContentBlock;

/** @deprecated v2 adı — yeni kodda `PageNode`. */
export type Block = PageNode;

// ============================================================================
// 3) LEGACY OKUMA TİPLERİ — YALNIZCA `normalize.ts` kullanır, başka hiçbir yer DEĞİL
// ============================================================================

export type PageBlockGap = "none" | "sm" | "md" | "lg";
export type PageColumnVerticalAlign = "top" | "center" | "bottom";

/** @deprecated v1/v2 şekli — sadece `normalizePageNodes` girdisi olarak tanınır. */
export interface LegacyPageColumn {
  id: string;
  width?: number;
  blocks: unknown[];
}

/** @deprecated v1/v2 şekli. `data.columnCount`/`data.ratio` v1 kalıntılarıdır. */
export interface LegacyColumnsBlock {
  id: string;
  type: "columns";
  data: {
    gap?: PageBlockGap;
    verticalAlign?: PageColumnVerticalAlign;
    columns?: LegacyPageColumn[];
    columnCount?: number;
    ratio?: string;
  };
}

/** @deprecated v2 tip adı — yeni kodda kullanılmaz, yalnızca eski import'lar için tutulur. */
export type ColumnsBlockData = LegacyColumnsBlock["data"];
/** @deprecated v2 tip adı. */
export type ColumnsBlock = LegacyColumnsBlock;
/** @deprecated v2 tip adı — bkz. `LegacyPageColumn`. */
export type PageColumn = LegacyPageColumn;

// ============================================================================
// 4) dnd-kit SÖZLEŞMESİ
// ============================================================================

/**
 * Konteyner kimliği sözleşmesi v3: kök liste `"root"`, her konteyner
 * `"container:<node.id>"`. v2'nin `"col:<column.id>"` biçimi KALDIRILDI
 * (sütun artık ayrı bir varlık değil, sıradan bir `container`).
 */
export type BuilderContainerId = "root" | `container:${string}`;

/**
 * Cihaz Önizleme Çubuğu — editörün KENDİ görsel simülasyonu (bkz.
 * `.claude/design-notes-page-builder-editing-tools.md` §1). Kaydedilen veriyi ETKİLEMEZ,
 * yalnızca `builder-canvas.tsx::BuilderCanvas`'ın yerel state'i olarak kullanılır.
 */
export type DeviceMode = "desktop" | "tablet" | "mobile";

// ============================================================================
// 5) SINIRLAR (backend `pages.schemas.ts` ile SAYISAL OLARAK AYNI OLMAK ZORUNDA)
// ============================================================================

/** Kök = 1. Bir konteyner en fazla 4. seviyede olabilir → yaprak bloklar en fazla 5. seviyede. */
export const MAX_CONTAINER_DEPTH = 4;
/**
 * Bir konteynerin doğrudan çocuk sayısı (v2'nin 20 ve 24'ünün birleşimi).
 *
 * NETLEŞTİRME (security-agent ön denetimi §13.2, architect onayı): bu sınır YALNIZCA gerçek
 * `container.children` dizilerine uygulanır. Kök `Page.blocks` dizisi bir "konteyner" DEĞİLDİR
 * (§2.2 — "örtük root container", ayarları serileştirilmez) ve bu sınıra TABİ DEĞİLDİR; kökte
 * yalnızca `MAX_TOTAL_PAGE_NODES` (300) ve `MAX_PAGE_BLOCKS_BYTES` geçerlidir. `containers.ts`
 * içindeki `insertNode`/`moveNode` bu ayrımı uygular: `parentId === "root"` iken çocuk-sayısı
 * kontrolü YAPILMAZ, yalnızca `parentId` bir `container:<id>` iken yapılır.
 */
export const MAX_CHILDREN_PER_CONTAINER = 24;
/** Sayfa başına TOPLAM düğüm (konteynerler DAHİL) — v2'nin 200'ünden yükseltildi. */
export const MAX_TOTAL_PAGE_NODES = 300;
/** Bu eşiğin üzerinde `direction: "row"` konteynerde okunabilirlik UYARISI (engelleyici DEĞİL). */
export const ROW_CHILDREN_READABILITY_WARNING_THRESHOLD = 6;
/** `layout: "boxed"` varsayılan max-width (px) — inline style, Tailwind sınıfı değil. */
export const DEFAULT_CONTAINER_MAX_WIDTH = 1170;
export const MIN_CONTAINER_MAX_WIDTH = 320;
export const MAX_CONTAINER_MAX_WIDTH = 1920;
/** Galeri bloğu başına en fazla görsel — DEĞİŞMEDİ. */
export const GALLERY_MAX_IMAGES = 30;

/**
 * Google Harita — backend `pages.schemas.ts` ile SAYISAL OLARAK BİREBİR AYNI (mimar §2.1,
 * dosya başlığındaki §5 uyarısı bağlayıcıdır). Şemada `.min()`/`.max()`/`.default()` argümanı
 * olarak KULLANILMAYAN (`GOOGLE_MAP_DEFAULT_ZOOM`/`GOOGLE_MAP_MIN_HEIGHT_PX`/
 * `GOOGLE_MAP_DEFAULT_HEIGHT_PX`) sabitler de dahil — burada render-time `??` varsayılanları ve
 * editör UI sınırları için kullanılır.
 */
export const GOOGLE_MAP_MIN_ZOOM = 1;
export const GOOGLE_MAP_MAX_ZOOM = 20;
export const GOOGLE_MAP_DEFAULT_ZOOM = 15;
export const GOOGLE_MAP_MIN_HEIGHT_PX = 120;
export const GOOGLE_MAP_MAX_HEIGHT_PX = 2000;
export const GOOGLE_MAP_DEFAULT_HEIGHT_PX = 400;
export const GOOGLE_MAP_MAX_HEIGHT_VH = 100;
export const GOOGLE_MAP_MAX_ADDRESS_LENGTH = 300;
export const GOOGLE_MAP_MAX_MARKER_TITLE_LENGTH = 120;
/** UI-ONLY sabit — backend'de TANIMLI DEĞİLDİR (ui-designer §1.1). `vh` biriminde editör input'unun
 *  alt sınırı; backend'in teknik tavanı `value.min(1)`dir, bu yalnızca kullanılamaz bir harita
 *  üretmeyi engelleyen bir UX sınırıdır. */
export const GOOGLE_MAP_UI_MIN_HEIGHT_VH = 10;

/** Şekilli Bölüm Ayırıcıları — `customWidth`in `MIN/MAX/DEFAULT_CONTAINER_MAX_WIDTH` üçlüsüyle
 *  BİREBİR AYNI isimlendirme kalıbı (backend `pages.schemas.ts` ile SAYISAL OLARAK AYNI olmalı). */
export const MIN_DIVIDER_HEIGHT = 0;
export const MAX_DIVIDER_HEIGHT = 300;
export const DEFAULT_DIVIDER_HEIGHT = 100;

/** @deprecated v2 adları — geçiş süresince alias, sonra silinir. */
export const MAX_BLOCKS_PER_COLUMN = MAX_CHILDREN_PER_CONTAINER;
/** @deprecated v2 adı. */
export const MAX_COLUMNS_PER_ROW = MAX_CHILDREN_PER_CONTAINER;
/** @deprecated v2 adı. */
export const MAX_TOTAL_BLOCKS = MAX_TOTAL_PAGE_NODES;
/** @deprecated v2 adı. */
export const COLUMN_READABILITY_WARNING_THRESHOLD = ROW_CHILDREN_READABILITY_WARNING_THRESHOLD;

// ============================================================================
// 6) VARSAYILANLAR — tek kaynak, backend zod `.default()` değerleriyle BİREBİR aynı olmalı
// ============================================================================

export const DEFAULT_CONTAINER_SETTINGS: ContainerSettings = {
  layout: "boxed",
  direction: "column",
  justifyContent: "start",
  alignItems: "stretch",
  gap: 16,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
  background: { type: "none" },
};

/**
 * Bir ayırıcı "eklendiğinde" (`MinHeightField` deseni, §2.2/§2.7 ui-designer dokümanı) verilen
 * başlangıç değeri. `color: "#ffffff"` — §2.4 gerekçesi: konteynerin arka planı `background.type:
 * "none"` iken saydamdır, ayırıcının "hangi rengin üstüne oturacağı" render motorunda hesaplanamaz;
 * endüstri standardı (Elementor/Divi) beyazdır.
 */
export const DEFAULT_SHAPE_DIVIDER: ShapeDividerSettings = {
  type: "wave",
  color: "#ffffff",
  height: DEFAULT_DIVIDER_HEIGHT,
  flip: false,
};

/** `BlockRenderer`'a geçilen, bir düğümün "kendi dış boşluğunu taşıyıp taşımadığı" bilgisi (§6.3). */
export type BlockChrome = "page" | "bare";
