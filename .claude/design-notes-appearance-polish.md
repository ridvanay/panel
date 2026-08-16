# Tasarım Notu — Görünüm Paneli Cilası (`/admin/appearance` polish turu)

**Kapsam:** `frontend/src/app/admin/appearance/page.tsx` (mevcut, 1352 satır) + `frontend/src/components/ui/tabs.tsx` (paylaşılan bileşen, dikkatli genişletme). Önceki tasarım kararları için bkz. `.claude/design-notes-appearance-panel.md` — bu doküman ONU EZMEZ, yalnızca 5 net görsel iyileştirmeyi (item 2, 3, 4, 5, 6) ekler. **Item 1 (Base UI `nativeButton` uyarısı) ve item 2'nin kök nedeni architect/orkestratör tarafından zaten teşhis edildi — burada tekrar edilmiyor.**

**Görsel yön:** Değişmedi — proje **Minimal/Flat**. Bu polish turu yeni bir görsel dil eklemez; mevcut `Card`/`Badge`/`Button` token setini kullanır.

---

## 1) Banner önizlemesi okunaksızlığı (item 2) — SADECE (a), overlayOpacity'den BAĞIMSIZ okunabilirlik katmanı

**Karar: metnin arkasına, admin'in seçtiği `overlayOpacity` değerinden tamamen BAĞIMSIZ, sabit yarı saydam bir "pill" eklenir.** Text-shadow tek başına YETERSİZ kabul edildi çünkü etkinliği arka plan görselinin içeriğine göre değişir (düz renkli bir alanda görünmez, dokulu bir alanda yetersiz kalabilir); `bg-black/60 backdrop-blur-sm` pill ise blur sayesinde ARKASINDAKİ HERHANGİ bir görseli/deseni bulanıklaştırıp karartarak sabit bir kontrast tabanı garanti eder — `overlayOpacity` %0 olsa bile okunur kalır.

`PreviewPageHeaderBanner` (satır 272-295) için TEK değişiklik, `<span>`'a class eklemek — üstteki `overlay` katmanı (satır 291) AYNEN KALIR, bu ikisi ÇAKIŞMAZ (overlay tüm zemini karartır, pill metnin kendi arka planını EK olarak garanti eder):

```tsx
<span className="relative rounded-md bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
  Örnek Sayfa Başlığı
</span>
```

Somut değerler: `bg-black/60` (mevcut overlay katmanının `bg-black` tonuyla AYNI renk ailesi, tutarlı), `backdrop-blur-sm` (proje zaten `Card`'da `backdrop-blur-xl` kullanıyor — burada küçük bir metin pill'i için `sm` yeterli, `xl` gereksiz agresif olurdu), `px-3 py-1` (12px/4px, mevcut spacing ölçeğinden), `rounded-md`.

**Gerçek site render'ı — BULGU (kod aramasıyla doğrulandı):** `frontend/src/app/(site)/` altında `pageHeaderStyle`/`PageHeaderStyle`/"BANNER" için TEK bir eşleşme YOK. `fetchSiteAppearanceServer` (`frontend/src/lib/api/server-appearance.ts`) yalnızca `(site)/layout.tsx`'te header/footer için renk-font CSS değişkenlerini besliyor; **sayfa başlığı (page header) bloğunun kendisi ziyaretçi tarafında henüz HİÇ implemente edilmemiş** (ne `[slug]/page.tsx` ne başka bir yerde `PageHeaderBanner`/benzeri bir bileşen bulunamadı). Bu, `ui-designer`'ın kapsamı DIŞINDA bir eksik (kod implementasyonu) — architect/backend-agent'a bilgi notu: **o bileşen yazıldığında, BURADAKİ AYNI okunabilirlik garantisi (`bg-black/60 backdrop-blur-sm` pill, overlay'den bağımsız) UYGULANMALI** — aksi halde admin önizlemesi ile gerçek site arasında tutarsızlık (önizlemede okunur, sitede okunmaz) oluşur. Bu notu `documentation-agent`/architect mimari dokümana (`ARCHITECTURE.md` §10.12) eklemeli.

---

## 2) Sol menü kategorileri (item 3)

**Karar: `TabsList` İÇİNDE, her grubun üstünde interaktif olmayan bir `<span aria-hidden="true">` ayraç etiketi — Base UI'nin Tab kaydı yalnızca gerçek `TabsPrimitive.Tab` bileşenlerini roving-tabindex döngüsüne aldığı için, aralarına serpiştirilen düz `<span>`/`<div>` etiketler klavye navigasyonunu BOZMAZ (kayıt olmayan eleman döngüde yer almaz).**

3 grup, sıra ve içerik (kullanıcının istediği eşlemeyle birebir):

| Grup başlığı | Sekmeler |
|---|---|
| **Marka** | `brand` (Logo & Marka), `social` (Sosyal Medya Paylaşımı) |
| **Tasarım** | `presets` (Tasarım Ön Ayarları), `pageHeader` (Sayfa Başlığı Düzeni), `colors` (Stil / Renk), `typography` (Yazı Tipi) |
| **Gelişmiş** | `features` (Ekstra Özellikler), `customCode` (Özel CSS / JS), `notFound` (404 Sayfası) |

`TAB_ITEMS` (satır 79-89) düz dizi olmaktan çıkıp gruplu bir yapıya döner (`SECTION_FIELDS`/`SECTION_KEYS`/mantık AYNEN KALIR — sadece görüntüleme sırası/gruplaması değişir, `value` alanları sabit kalır):

```tsx
const TAB_GROUPS: { label: string; items: { value: string; label: string; icon: typeof Palette }[] }[] = [
  { label: "Marka", items: [
    { value: "brand", label: "Logo & Marka", icon: Palette },
    { value: "social", label: "Sosyal Medya Paylaşımı", icon: Share2 },
  ]},
  { label: "Tasarım", items: [
    { value: "presets", label: "Tasarım Ön Ayarları", icon: Sparkles },
    { value: "pageHeader", label: "Sayfa Başlığı Düzeni", icon: LayoutTemplate },
    { value: "colors", label: "Stil / Renk", icon: Paintbrush },
    { value: "typography", label: "Yazı Tipi", icon: Type },
  ]},
  { label: "Gelişmiş", items: [
    { value: "features", label: "Ekstra Özellikler", icon: ToggleRight },
    { value: "customCode", label: "Özel CSS / JS", icon: Code2 },
    { value: "notFound", label: "404 Sayfası", icon: FileQuestion },
  ]},
];
```

Render (`TabsList`'in İÇİNDE, `TabsTrigger`'lar ile aynı flex-col akışında):

```tsx
<TabsList variant="line" className="w-full lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
  {TAB_GROUPS.map((group, i) => (
    <div key={group.label} className="w-full">
      <span
        className={cn(
          "block px-2 pb-1 text-[11px] font-semibold tracking-wide text-foreground/40 uppercase",
          i === 0 ? "mt-0" : "mt-3"
        )}
        aria-hidden="true"
      >
        {group.label}
      </span>
      {group.items.map((tab) => (
        <TabsTrigger key={tab.value} value={tab.value}>
          <tab.icon className="h-3.5 w-3.5" />
          {tab.label}
          {isTabDirty(tab.value) && <DirtyDot />}
        </TabsTrigger>
      ))}
    </div>
  ))}
</TabsList>
```

Somut değerler: `text-[11px]` (proje `settings/page.tsx` satır 82'de aynı mikro-boyutu zaten kullanıyor — yeni bir keyfi değer icat edilmiyor), `tracking-wide`, `text-foreground/40` (en düşük vurgu — sadece kategori etiketi, tıklanabilir değil), `uppercase`, ilk grup `mt-0`/sonraki gruplar `mt-3` (12px, spacing ölçeği), etiketin altı `pb-1` (4px) ile ilk `TabsTrigger`'dan ayrılır.

**Not (frontend-agent kontrolü):** Her grup bir `<div className="w-full">` sarmalayıcısına alınıyor — bu, dikey `TabsList`'in `flex-col` akışını bozmaz (div zaten block/flex-col uyumlu), ama **Base UI'nin klavye ok-tuşu gezinmesinin gruplar ARASI da düzgün çalıştığı manuel olarak test edilmeli** (beklenen: çalışır, çünkü `Tab` bileşenleri DOM derinliği fark etmeksizin context üzerinden kayıt olur — ama Base UI sürüm-özel davranışları için tek satırlık bir smoke test gerekir).

---

## 3) Canlı önizleme — cihaz görünümü + yeni sekmede aç (item 4)

**Karar: "CANLI ÖNİZLEME" etiketiyle AYNI satırda, sağa yaslı bir kontrol grubu** — sol tarafta 3 ikon-buton (Masaüstü/Tablet/Mobil) bir "segmented control" kutusunda, sağında ayrı duran "yeni sekmede aç" ikon-butonu.

```tsx
type PreviewDevice = "desktop" | "tablet" | "mobile";
const DEVICE_MAX_WIDTH: Record<PreviewDevice, string> = {
  desktop: "100%",
  tablet: "768px",
  mobile: "375px",
};
const DEVICE_OPTIONS: { value: PreviewDevice; label: string; icon: typeof Monitor }[] = [
  { value: "desktop", label: "Masaüstü", icon: Monitor },
  { value: "tablet", label: "Tablet", icon: Tablet },
  { value: "mobile", label: "Mobil", icon: Smartphone },
];
```

```tsx
<div className="flex items-center justify-between gap-2">
  <p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Canlı Önizleme</p>
  <div className="flex items-center gap-1.5">
    <div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-surface-muted p-0.5">
      {DEVICE_OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          type="button"
          size="icon-xs"
          variant={previewDevice === opt.value ? "secondary" : "ghost"}
          onClick={() => setPreviewDevice(opt.value)}
          aria-label={opt.label}
          aria-pressed={previewDevice === opt.value}
        >
          <opt.icon className="h-3 w-3" />
        </Button>
      ))}
    </div>
    <Button type="button" size="icon-xs" variant="ghost" render={<a href="/" target="_blank" rel="noreferrer" />} aria-label="Siteyi yeni sekmede aç">
      <ExternalLink className="h-3 w-3" />
    </Button>
  </div>
</div>
<div
  className="mx-auto w-full transition-all duration-300 ease-in-out"
  style={{ maxWidth: DEVICE_MAX_WIDTH[previewDevice] }}
>
  <div className="site-scope overflow-hidden rounded-xl border border-border ..." style={previewCssVars}>
    {/* SiteHeader / sahte sayfa içeriği / SiteFooter — AYNEN KALIR */}
  </div>
</div>
```

Somut değerler:
- İkonlar `lucide-react`'ten `Monitor`, `Tablet`, `Smartphone` — proje tek ikon kaynağını (`lucide-react`) korur, YENİ import eklenmesi gerekiyor (şu an dosyada içe aktarılmamış).
- Segmented control kutusu: `rounded-md border border-border/60 bg-surface-muted p-0.5 gap-0.5` — mevcut "Karartma yoğunluğu"/preset kart border tonlarıyla tutarlı, `Button` bileşeninin `size="icon-xs"` (24px kare, zaten `button.tsx`'te tanımlı, YENİ bir buton boyutu İCAT EDİLMİYOR) + `variant="ghost"`/`"secondary"` (aktif/pasif ayrımı için mevcut varyantlar, yeni varyant YOK).
- Genişlikler: masaüstü `100%` (mevcut davranış — `lg:w-[420px]` panel genişliğini doldurur), tablet `768px`, mobil `375px` — `mx-auto` ile ortalanır, `transition-all duration-300 ease-in-out` ile yumuşak geçiş (mevcut kod tabanında `duration-300`/`duration-200` zaten standart geçiş süresi olarak kullanılıyor, tutarlı).
- "Yeni sekmede aç" ikon-butonu, `customCode` sekmesindeki "Siteyi Aç" (satır 1274, `render={<a href="/" target="_blank" rel="noreferrer" />}`) ile AYNI pattern — sadece ikon-only küçük buton haline getirilmiş hali, iki farklı "siteyi aç" davranışı İCAT EDİLMİYOR.
- `previewDevice` state'i yalnızca GÖRSEL — `SiteHeader`/`SiteFooter` prop arayüzü değişmez, sadece sarmalayıcı `div`'in `max-width`'i değişir (§10.12.9'daki "prop arayüzü değiştirilmez" kısıtına uygun).

---

## 4) Bölüm doluluk göstergesi (item 5)

**Karar: `DirtyDot`'tan (sağda, `bg-warning`, YALNIZCA true iken render edilir) TAMAMEN AYRI, YENİ bir "doluluk soketi" — solda, ikonun HEMEN ÖNÜNDE, HER ZAMAN render edilir (boşken içi boş halka, doluyken dolu nokta) — böylece kullanıcı sekmeler arasında karşılaştırma yapabilir (yokluk ile "henüz kontrol edilmedi" karışmaz, her zaman aynı konumda bir "soket" vardır).**

```tsx
function FullnessSocket({ filled }: { filled: boolean }) {
  return (
    <span
      className={cn(
        "h-1.5 w-1.5 shrink-0 rounded-full border",
        filled ? "border-primary bg-primary" : "border-foreground/25 bg-transparent"
      )}
      aria-hidden="true"
    />
  );
}
```

```tsx
<TabsTrigger key={tab.value} value={tab.value}>
  <FullnessSocket filled={isTabFilled(tab.value)} />
  <tab.icon className="h-3.5 w-3.5" />
  {tab.label}
  {isTabDirty(tab.value) && <DirtyDot />}
</TabsTrigger>
```

**Renk kararı — neden `bg-primary` (indigo), `bg-success` DEĞİL:** Bu SAYFADA `success` tonu zaten başka bir anlamda kullanılıyor — `ContrastBadge` (design-notes-appearance-panel.md §5) "kontrast AA eşiğini geçti" için `tone="success"` kullanacak. Aynı sayfada `success` rengini "bölüm doldurulmuş" için de kullanmak iki farklı anlamı aynı renkte çakıştırır (kullanıcı "yeşil = kontrast mı geçti, bölüm mü dolu" diye tereddüt eder). `primary` (marka rengi, indigo) nötr bir "bilgi/varlık" anlamı taşır ve DirtyDot'un `warning` (amber) tonundan hem HUE hem KONUM olarak açıkça ayrışır.

**"Doluluk" tanımı:** Bir sekme, `SECTION_FIELDS[tab]` listesindeki alanlardan EN AZ BİRİ sunucudan gelen `DEFAULT_APPEARANCE` (`frontend/src/lib/api/server-appearance.ts` — zaten export edilmiş, YENİ bir sabit İCAT ETMEYE gerek yok, backend `DEFAULTS`'uyla birebir eşleşen tek doğru kaynak) değerinden FARKLIYSA "dolu" sayılır. Karşılaştırma **`snapshot`** (son kaydedilmiş form state, `form` DEĞİL — anlık taslak değişiklikler "doluluk"u geçici olarak değiştirmemeli, o zaten `DirtyDot`'un işi) üzerinden yapılır:

```ts
function isTabFilled(tab: string): boolean {
  if (tab === "customCode") return Boolean(customCodeMeta?.css?.trim() || customCodeMeta?.js?.trim());
  if (tab === "brand") return false; // salt-okunur özet — bu sekmenin "doluluğu" Navigasyon ekranına ait, burada yanıltıcı olur
  if (!snapshot || !(tab in SECTION_FIELDS)) return false;
  return SECTION_FIELDS[tab as SectionKey].some(
    (key) => JSON.stringify(toRequestValue(key, snapshot[key])) !== JSON.stringify((DEFAULT_APPEARANCE as Record<string, unknown>)[key])
  );
}
```

Bu bir implementasyon detayı (frontend-agent hesaplar) — ui-designer burada yalnızca **hangi alan grubunun hangi sekmeye ait olduğunu** (`SECTION_FIELDS`, zaten satır 198-214'te mevcut, YENİDEN İCAT EDİLMİYOR) ve **görsel ayrışmayı** teyit eder. `brand` sekmesi için doluluk göstergesi BİLİNÇLİ olarak her zaman `false`/boş halka — çünkü o sekme salt-okunur bir özet, "doluluk" onun için Navigasyon ekranındaki gerçek veriye ait bir sinyal olurdu ve burada göstermek yanıltıcı olur.

**Çakışma durumu (aynı sekme hem dolu hem dirty):** Soket solda dolu (`bg-primary`) görünür, `DirtyDot` sağda `bg-warning` olarak AYRI konumda görünür — ikisi ASLA aynı noktada üst üste binmez, `TabsTrigger`'ın `flex items-center gap-1.5` düzeni ikisini otomatik olarak ayrık tutar (soket en solda, `DirtyDot` `ml-auto` ile en sağda).

---

## 5) Genel cila (item 6)

### 5a) Aktif sekme vurgusu — `tabs.tsx` KENDİSİNDE, kapsamı ayrıştırılmış iki değişiklik

`variant="line"` proje genelinde 6 yerde kullanılıyor (Navigation, Settings, Stats, content-list-tabs, appearance — hepsi YATAY; `orientation="vertical"` bugün SADECE appearance sayfasında kullanılıyor). Bu ayrım sayesinde değişiklikleri İKİYE bölüp riski izole edebiliyoruz:

**(1) Dikey aktif kenar çizgisi kalınlığı — GÜVENLİ, SADECE appearance'ı etkiler (bugün tek dikey tüketici o):**

`tabs.tsx` satır 64:
```diff
- group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-[3px]
+ group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-1
```
(`w-[3px]` → `w-1` = 4px; yatay after-bar `h-[3px]` DOKUNULMAZ.)

**(2) Aktif zemin opaklığı + hover zemini — TÜM `variant="line"` kullanıcılarını etkiler (Navigation, Settings, Stats, content-list-tabs DAHİL), BİLİNÇLİ ve DÜŞÜK RİSKLİ bir global tutarlılık iyileştirmesi olarak kabul edildi (sadece renk yoğunluğu artıyor, hiçbir spacing/layout değişmiyor — taşma/kırılma riski yok):**

`tabs.tsx` satır 62:
```diff
- "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-primary/10 group-data-[variant=line]/tabs-list:data-active:text-primary dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-primary/15 dark:group-data-[variant=line]/tabs-list:data-active:text-primary-hover",
+ "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:hover:bg-muted/50 group-data-[variant=line]/tabs-list:data-active:bg-primary/15 group-data-[variant=line]/tabs-list:data-active:text-primary dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-primary/20 dark:group-data-[variant=line]/tabs-list:data-active:text-primary-hover",
```
(light `/10`→`/15`, dark `/15`→`/20`; pasif sekmelere `hover:bg-muted/50` eklendi — şu an line varyantında hover'da SADECE metin rengi değişiyordu, zemin de hafifçe belirir.)

**Kontrol listesi maddesi (code-quality/qa için):** Bu değişiklikten sonra Navigation (`/admin/navigation`), Settings (`/admin/settings`), Stats (`/admin/stats`) ve içerik listesi sekmelerinin (`content-list-tabs.tsx`) görsel olarak BOZULMADIĞI (sadece biraz daha belirgin aktif/hover durumu) manuel olarak kontrol edilmeli — bu satırlar paylaşılan bileşende olduğu için.

### 5b) "Logo & Marka" kartı — YENİ API çağrısı GEREKTİRMEDEN mevcut state'ten üç ek görsel blok

Mevcut kart (satır 611-636) yalnızca küçük logo + site adı/slogan + link içeriyor. **Karar: kartın ALTINA, `border-t border-border/60 pt-4` ile ayrılmış iki yeni blok eklenir** — ikisi de zaten yüklü `siteSettings`/`navigation`/`form` state'inden okunur, YENİ bir API çağrısı YOK:

```tsx
<Card className="space-y-4">
  <SectionHeader icon={Palette} title="Logo & Marka" description="Logo, site adı ve sloganınız Navigasyon ekranında yönetilir." />

  {/* Mevcut logo + site adı satırı — büyütülmüş logo kutusu */}
  <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-muted p-3">
    {siteSettings.logoUrl ? (
      <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md border border-border/40 bg-surface p-2">
        <img src={siteSettings.logoUrl} alt="" className="max-h-10 w-auto object-contain" />
      </span>
    ) : (
      <span className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md bg-muted text-base font-semibold text-foreground/50">
        {siteSettings.siteName?.trim().charAt(0).toUpperCase() || "S"}
      </span>
    )}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-foreground">{siteSettings.siteName || "Site adı tanımlanmamış"}</p>
      <p className="truncate text-xs text-foreground/50">{siteSettings.tagline || "Slogan tanımlanmamış"}</p>
    </div>
  </div>

  {/* YENİ: Aktif renk paleti şeridi — form.primaryColor/secondaryColor/buttonColor/linkColor, YENİ state YOK */}
  <div className="space-y-1.5 border-t border-border/60 pt-4">
    <p className="text-xs font-medium text-foreground/60">Aktif Renk Paleti</p>
    <div className="flex h-6 overflow-hidden rounded-md">
      <span className="flex-1" style={{ backgroundColor: form.primaryColor }} title="Birincil" />
      <span className="flex-1" style={{ backgroundColor: form.secondaryColor }} title="İkincil" />
      <span className="flex-1" style={{ backgroundColor: form.buttonColor }} title="Buton" />
      <span className="flex-1" style={{ backgroundColor: form.linkColor }} title="Bağlantı" />
    </div>
  </div>

  {/* YENİ: Header CTA önizlemesi — navigation.headerCtaLabel/headerCtaHref, YENİ state YOK */}
  <div className="space-y-1.5">
    <p className="text-xs font-medium text-foreground/60">Header CTA Önizlemesi</p>
    {navigation.headerCtaLabel && navigation.headerCtaHref ? (
      <span
        className="inline-flex items-center rounded-lg px-3.5 py-1.5 text-xs font-medium"
        style={{ backgroundColor: form.buttonColor, color: form.buttonTextColor }}
      >
        {navigation.headerCtaLabel}
      </span>
    ) : (
      <p className="text-xs text-foreground/40">Header CTA tanımlanmamış.</p>
    )}
  </div>

  <Button type="button" variant="secondary" size="sm" render={<Link href="/admin/navigation?tab=locations" />}>
    <ExternalLink className="h-3.5 w-3.5" /> Navigasyon&apos;da Düzenle
  </Button>
</Card>
```

Somut değerler: logo kutusu `h-14 w-20` (56px × 80px, önceki `h-8 w-8`'den belirgin şekilde büyütüldü ama Card'ın `p-6` iç boşluğu içinde taşmaz), `max-h-10` logo görseli (40px tavan, kutunun içine `object-contain` ile sığar), renk şeridi `h-6` (24px, preset kartlarındaki `h-8` şeritten biraz daha ince — burada dekoratif özet, seçim UI'ı değil), CTA pill `px-3.5 py-1.5` (mevcut 404 önizleme butonundaki AYNI ölçüler, satır 1247 ile tutarlı), tüm bloklar arası `border-t border-border/60 pt-4` (16px) ayraç — Card'ın kendi `space-y-4` (16px) ritmiyle örtüşüyor.

Bu kart HALA salt-okunur — hiçbir yeni alan `SECTION_FIELDS`'e eklenmez, "Bu bölümü kaydet" butonu YOK (§ önceki karar korunuyor).

---

## Kontrol Listesi (frontend-agent)

- [x] `PreviewPageHeaderBanner`'daki `<span>`'a `rounded-md bg-black/60 backdrop-blur-sm px-3 py-1` eklenir — overlay katmanı (satır 291) dokunulmadan kalır.
- [x] Mimari nota (ARCHITECTURE.md §10.12 veya yeni bir TODO) şu bulgu eklenir: gerçek site tarafında (`(site)` route grubu) `PageHeaderStyle=BANNER` render eden bir bileşen HENÜZ YOK — ileride yazılınca AYNI `bg-black/60 backdrop-blur-sm` pill garantisi uygulanmalı.
- [x] `TAB_ITEMS` → `TAB_GROUPS` (3 grup: Marka/Tasarım/Gelişmiş) olarak yeniden yapılandırılır; `SECTION_FIELDS`/`SECTION_KEYS` mantığı DEĞİŞMEZ, sadece görüntüleme sırası/gruplaması değişir.
- [x] Grup başlıkları `TabsList` içinde `text-[11px] font-semibold tracking-wide uppercase text-foreground/40` `<span aria-hidden="true">` — ilk grup `mt-0`, sonrakiler `mt-3`.
- [x] Klavye ok-tuşu gezinmesi grup sarmalayıcı `<div>`'ler eklendikten SONRA manuel test edilir (Base UI Tab kaydı context-bazlı, beklenen: sorunsuz).
- [x] Canlı Önizleme başlığının sağında cihaz toggle'ı (`Monitor`/`Tablet`/`Smartphone`, `size="icon-xs"`, segmented control kutusu) + ayrı "yeni sekmede aç" ikon-butonu (`ExternalLink`, `size="icon-xs"`, `render={<a href="/" target="_blank" rel="noreferrer" />}`) eklenir; `lucide-react`'ten `Monitor`/`Tablet`/`Smartphone` importları eklenir.
- [x] Önizleme sarmalayıcısı `mx-auto transition-all duration-300 ease-in-out` + `style={{ maxWidth: DEVICE_MAX_WIDTH[previewDevice] }}` (`100%`/`768px`/`375px`) ile sarmalanır; `SiteHeader`/`SiteFooter` prop arayüzü DEĞİŞMEZ.
- [x] `FullnessSocket` bileşeni eklenir (sol, ikon ÖNÜNDE, `border-primary bg-primary` dolu / `border-foreground/25` boş halka), `DirtyDot` (sağ, `ml-auto`, sadece true iken render) AYNEN KALIR — ikisi aynı `TabsTrigger` içinde ayrı konumlarda bir arada bulunabilir.
- [x] `isTabFilled` hesaplaması `DEFAULT_APPEARANCE` (`@/lib/api/server-appearance`, YENİ sabit İCAT EDİLMEZ) ile `snapshot` (form DEĞİL) karşılaştırması üzerinden yapılır; `brand` her zaman `false`, `customCode` `customCodeMeta.css`/`js` doluluğuna bakar.
- [x] `tabs.tsx` satır 64: dikey after-bar `w-[3px]` → `w-1` (SADECE dikey, yatay dokunulmaz).
- [x] `tabs.tsx` satır 62: line varyantı aktif zemin `bg-primary/10`→`/15` (dark `/15`→`/20`) + pasif `hover:bg-muted/50` eklenir — Navigation/Settings/Stats/content-list-tabs görsel olarak smoke-test edilir (bozulma BEKLENMİYOR, sadece daha belirgin).
- [x] Logo & Marka kartına iki yeni salt-okunur blok eklenir: `h-14 w-20` büyütülmüş logo kutusu, `h-6` 4 renkli palet şeridi (`form.primaryColor/secondaryColor/buttonColor/linkColor`), Header CTA pill önizlemesi (`navigation.headerCtaLabel/headerCtaHref` + `form.buttonColor/buttonTextColor`) — YENİ API çağrısı YOK, kart HALA salt-okunur (Kaydet butonu yok).
