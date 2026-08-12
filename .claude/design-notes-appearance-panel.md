# Tasarım Notu — Site Özelleştirme Paneli (`/admin/appearance`)

**Kapsam:** Yeni sayfa `frontend/src/app/admin/appearance/page.tsx` (henüz yok — frontend-agent oluşturacak) + kullanacağı alt bileşenler. Kaynak kontrat: `docs/architecture/ARCHITECTURE.md` §10.12 (tüm alt bölümler), `docs/architecture/openapi.yaml` (`Appearance` tag'i, `SiteAppearance`/`UpdateSiteAppearanceRequest`/`SiteCustomCode`/`AppearancePreset` şemaları).

**Görsel yön:** Proje **Minimal/Flat** dilinde (`frontend/src/app/admin/navigation/page.tsx`, `frontend/src/app/admin/settings/page.tsx` ile birebir aynı: `bg-surface/70` + `border-border/60` kartlar, `backdrop-blur-xl` YALNIZCA `Card`'ın kendi taban stilinden geliyor — glow/gradient EKLENMEYECEK). Bu panel de **aynı dile bağlı kalır**; yeni bir görsel dil icat edilmez.

**Genişletilen desen — yeniden icat YOK:** Bu panelin layout'u, canlı önizlemesi, kaydetme çubuğu ve sekme rozeti mantığı `frontend/src/app/admin/navigation/page.tsx`'in `locations` sekmesinin (satır ~620-937) **birebir genişletilmiş halidir**. Aynı `SiteHeader`/`SiteFooter` bileşenleri, aynı `grid-cols-[1fr_480px]` + `lg:sticky lg:top-6` önizleme paterni, aynı `sticky bottom-6` Kaydet çubuğu, aynı kirli-sekme noktası (`bg-warning` nokta) kullanılır.

---

## 0) Genel panel layout'u

**Karar: Sol dikey sekme listesi (navigasyon sayfasındaki YATAY `TabsList variant="line"` DEĞİL) — 9 bölüm için yatay sekme çubuğu taşmaya/kalabalığa yol açar.**

`Tabs` bileşeni zaten `orientation="vertical"` destekliyor (`components/ui/tabs.tsx` — `data-vertical` varyantları tanımlı, `group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start`). Bunu kullan:

```
<Tabs orientation="vertical" value={activeTab} onValueChange={...} className="lg:flex-row">
  <TabsList variant="line" className="w-full lg:sticky lg:top-6 lg:w-64 lg:shrink-0">
    <TabsTrigger value="brand">…</TabsTrigger>
    …
  </TabsList>
  <div className="min-w-0 flex-1 space-y-6">
    <TabsContent value="brand">…</TabsContent>
    …
    {/* Canlı önizleme, TÜM sekmelerin YANINDA sabit kalır — sekmeye göre unmount OLMAZ */}
  </div>
</Tabs>
```

9 madde ve etiketleri (sıra `SiteAppearance` şemasındaki yorum bölümleriyle birebir):

| `value` | Etiket | İkon (`lucide-react`) |
|---|---|---|
| `brand` | Logo & Marka | `Palette` |
| `presets` | Tasarım Ön Ayarları | `Sparkles` |
| `pageHeader` | Sayfa Başlığı Düzeni | `LayoutTemplate` |
| `colors` | Stil / Renk | `Paintbrush` |
| `social` | Sosyal Medya Paylaşımı | `Share2` |
| `typography` | Yazı Tipi | `Type` |
| `features` | Ekstra Özellikler | `ToggleRight` |
| `customCode` | Özel CSS / JS | `Code2` |
| `notFound` | 404 Sayfası | `FileQuestion` |

**Genel sayfa iskeleti (üç sütun hissi, ama gerçekte iki flex bölge):**
- Sol: `w-64` (256px, `4/8/12/16/24/32` ölçeğinin dışında ama Tailwind'in standart `w-64`'ü — navigasyon sayfasındaki `lg:w-[340px]` sol panelden BİLİNÇLİ olarak daha dar, çünkü burada içerik picker değil sade metin linkleri var), `lg:sticky lg:top-6`.
- Orta: form içeriği, `min-w-0 flex-1`, `max-w-2xl` (form alanlarının navigasyon sayfasındaki gibi aşırı genişlememesi için — 672px okunabilir satır uzunluğu sınırı).
- Sağ: Canlı önizleme, `lg:w-[420px] lg:shrink-0 lg:sticky lg:top-6` — navigasyon sayfasının `480px`'inden biraz daha dar çünkü bu panelde form genişliği de rekabet ediyor (orta sütun `max-w-2xl` ile sınırlı olduğu için sağda kazanılan alan önizlemeye verilir).

Bu üç bölge tek bir `<div className="flex flex-col gap-6 lg:flex-row lg:items-start">` içinde: sol `TabsList` + orta `flex-1` + sağ önizleme kartı üç kardeş. (`Tabs` bileşenini yalnızca sol liste + orta içerik sarmalar; sağ önizleme `Tabs`'ın DIŞINDA, kardeş bir `motion.div` — navigasyon sayfasının `locations` sekmesindeki gibi TabsContent içine gömülmez, çünkü önizleme sekmeye bakmaksızın HER ZAMAN görünür kalmalı.)

```
<div className="flex flex-col gap-6 lg:flex-row lg:items-start">
  <Tabs orientation="vertical" value={activeTab} onValueChange={handleTabChange} className="min-w-0 flex-1 lg:flex-row">
    <TabsList variant="line" className="w-full lg:sticky lg:top-6 lg:w-64 lg:shrink-0" />
    <div className="min-w-0 max-w-2xl flex-1 space-y-6">
      <TabsContent value="brand">…</TabsContent> … (9 adet)
    </div>
  </Tabs>
  <motion.div className="w-full lg:sticky lg:top-6 lg:w-[420px] lg:shrink-0">
    {/* Canlı Önizleme kartı — bkz. §"Ortak Önizleme Paneli" */}
  </motion.div>
</div>
```

**Sekme değişiminde kaydedilmemiş değişiklik uyarısı:** navigasyon sayfasındaki `hasUnsavedChangesForTab` + `window.confirm` deseni yerine artık `useUnsavedChangesGuard` hook'unun döndürdüğü `confirmDiscard()` kullanılır (bkz. §10.12.8) — `onValueChange` içinde `if (!confirmDiscard()) return;`. Bu, frontend-agent'ın çıkaracağı ortak hook — ui-designer SADECE görsel sonucu (aşağıdaki "Kaydedilmemiş değişiklik" bölümü) tanımlıyor.

---

## 1) Ortak Önizleme Paneli

**Karar: `overflow-hidden rounded-xl border border-border` sarmalayıcı içinde `SiteHeader` + sahte sayfa içeriği + `SiteFooter`** — navigasyon sayfasındaki `locations` sekmesinin (satır 913-934) BİREBİR AYNI görsel kabuğu, sadece prop kaynağı değişiyor.

```
<p className="text-xs font-medium tracking-wide text-foreground/50 uppercase">Canlı Önizleme</p>
<div className="overflow-hidden rounded-xl border border-border site-scope" style={{ ...previewCssVars }}>
  <SiteHeader settings={...} pages={...} navigationItems={...} ctaLabel={...} ctaHref={...} />
  <div className="flex min-h-32 flex-col items-center justify-center gap-2 bg-muted/30 px-4 py-10 text-center">
    {pageHeaderStyle === "BANNER" && <PreviewPageHeaderBanner .../>}
    <p className="text-xs text-foreground/40">Sayfa içeriği</p>
  </div>
  <SiteFooter siteName={...} logoUrl={...} .../>
</div>
<p className="text-xs text-foreground/50">
  Değişiklikler yayına alındıktan sonra sitenizde en geç 60 saniye içinde görünür.
</p>
```

**`.site-scope` + `--site-*` uygulaması (§10.12.4 render sözleşmesi ile UYUMLU):** Önizleme sarmalayıcı `div`'e `className="site-scope"` eklenir ve `style` prop'u üzerinden **satır-içi** `--site-primary`, `--site-secondary`, `--site-button`, `--site-button-text`, `--site-link`, `--site-heading-font`, `--site-body-font`, `--site-base-font-size` değişkenleri form state'inden anlık yazılır (kod tarafı frontend-agent'ın işi; burada sadece hangi class/scope'un kullanılacağı kararlaştırılıyor). Bu, renk/font sekmelerinde kullanıcı bir değeri değiştirdiği anda önizlemenin **canlı** güncellenmesini sağlar — ayrı bir "Önizlemeyi Yenile" butonu YOK.

**Özel CSS/JS önizlemede UYGULANMAZ (§10.12.6 bağlayıcı kural).** `customCode` sekmesinde önizleme kartının yerine bir bilgi kutusu gösterilir (bkz. §9 aşağıda) — sağ sütun o sekmede boş kalmaz, "Sitenizi yeni sekmede açın" CTA'sına dönüşür:

```
<Card className="space-y-3 p-6 text-center">
  <Code2 className="mx-auto h-8 w-8 text-foreground/30" />
  <p className="text-sm font-medium text-foreground">Özel kod önizlemede uygulanmaz</p>
  <p className="text-xs text-foreground/60">Kaydettikten sonra değişiklikleri görmek için siteyi yeni sekmede açın.</p>
  <Button type="button" variant="secondary" size="sm" render={<a href="/" target="_blank" rel="noreferrer" />}>
    <ExternalLink className="h-3.5 w-3.5" /> Siteyi Aç
  </Button>
</Card>
```

---

## 2) Logo & Marka özet kartı (salt-okunur)

**Karar:** Tam bir form YOK — `Card` içinde salt-okunur özet + derin link. `MediaSelectField`/`ImageUploadField` BURADA KULLANILMAZ (§10.12.1: taşınmadı).

```
<Card className="space-y-4">
  <SectionHeader icon={Palette} title="Logo & Marka" description="Logo, site adı ve sloganınız Navigasyon ekranında yönetilir." />
  <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-muted p-3">
    {logoUrl ? (
      <img src={logoUrl} alt="" className="h-8 w-auto object-contain" />
    ) : (
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-xs font-semibold text-foreground/50">
        {siteName.charAt(0).toUpperCase() || "S"}
      </span>
    )}
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-foreground">{siteName || "Site adı tanımlanmamış"}</p>
      <p className="truncate text-xs text-foreground/50">{tagline || "Slogan tanımlanmamış"}</p>
    </div>
  </div>
  <Button type="button" variant="secondary" size="sm" render={<Link href="/admin/navigation?tab=locations" />}>
    <ExternalLink className="h-3.5 w-3.5" /> Navigasyon'da Düzenle
  </Button>
</Card>
```

Bu kart **salt-okunur olduğu için `hasUnsavedChanges`'e HİÇBİR ZAMAN katkıda bulunmaz** — bölüm başına Kaydet butonu bu sekmede YOK (yalnızca özet + link).

---

## 3) Tasarım Ön Ayarları (Presets)

**Karar: `SITE_TEMPLATE_OPTIONS` radio-kart paterninin (settings sayfası, satır ~419-448) GENİŞLETİLMİŞ hali** — ikon yerine küçük bir renk paleti şeridi.

```
<div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Tasarım ön ayarı">
  {presets.map((preset) => {
    const active = presetKey === preset.key;
    return (
      <button
        key={preset.key}
        type="button"
        role="radio"
        aria-checked={active}
        onClick={() => applyPreset(preset)}
        className={cn(
          "flex flex-col gap-3 rounded-lg border p-4 text-left transition-all duration-300",
          active ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:bg-muted"
        )}
      >
        <div className="flex h-8 overflow-hidden rounded-md">
          <span className="flex-1" style={{ backgroundColor: preset.values.primaryColor }} />
          <span className="flex-1" style={{ backgroundColor: preset.values.secondaryColor }} />
          <span className="flex-1" style={{ backgroundColor: preset.values.buttonColor }} />
          <span className="flex-1" style={{ backgroundColor: preset.values.linkColor }} />
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            {preset.label}
            {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden="true" />}
          </p>
          <p className="mt-0.5 text-xs text-foreground/60">{preset.description}</p>
        </div>
      </button>
    );
  })}
</div>
```

**Seçili durum vurgusu:** `border-primary bg-primary/5 ring-1 ring-primary/30` — settings sayfasındaki `active ? "border-primary bg-primary/5"` deseniyle AYNI, ek olarak `ring-1 ring-primary/30` (paletli kart daha "dolu" göründüğü için sadece border yetersiz kalabilir, hafif ring ekliyoruz). Seçili kartta ayrıca `CheckCircle2` ikonu başlığın yanına eklenir (settings sayfasındaki ikon-kutusu deseninden farklı — burada ikon zaten renk şeridi olduğu için ayrı bir "aktif ikon kutusu" gerekmiyor).

**"İleri seviye ayarlara geç" linki:** Preset grid'inin ALTINDA, sağa yaslı küçük bir metin-link (`variant="link"` Button):

```
<div className="flex justify-end">
  <Button type="button" variant="link" size="sm" onClick={() => setActiveTab("colors")}>
    İleri seviye renk/tipografi ayarlarına geç →
  </Button>
</div>
```

Preset uygulandığında `presetKey` state'i preset.key olur; **kullanıcı `colors`/`typography` sekmesinde tek bir alanı elle değiştirdiği an `presetKey` client-side `null`'a düşürülür** (§10.12.3 — "elle değişiklik → `presetKey: null`"). Bunun görsel karşılığı: preset grid'inde HİÇBİR kart `active` görünmez hale gelir (tümü nötr border) ve grid'in üstünde küçük bir bilgi rozeti belirir:

```
<Badge tone="neutral">Özel (ön ayar uygulanmadı)</Badge>
```

---

## 4) Sayfa Başlığı Düzeni

**Karar: 3 seçenekli segmented control (radio-kart, YATAY sıra) — Banner/Sade/Gizli.** Preset kartlarıyla aynı radio-kart görsel dili, ama tek satır ikon+etiket (renk şeridi yok, çünkü bu bir düzen seçimi, renk değil):

```
<div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Sayfa başlığı düzeni">
  {PAGE_HEADER_STYLE_OPTIONS.map((opt) => (
    <button role="radio" aria-checked={pageHeaderStyle === opt.value} className={cn(
      "flex flex-col items-center gap-2 rounded-lg border p-4 text-center transition-all duration-300",
      pageHeaderStyle === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
    )}>
      <opt.icon className="h-5 w-5" />
      <span className="text-sm font-medium text-foreground">{opt.label}</span>
      <span className="text-xs text-foreground/60">{opt.description}</span>
    </button>
  ))}
</div>
```

| `value` | Etiket | İkon | Açıklama |
|---|---|---|---|
| `BANNER` | Banner | `Image` (lucide) | Arka planı olan geniş başlık bloğu |
| `PLAIN` | Sade | `AlignLeft` | Düz metin başlık (varsayılan) |
| `HIDDEN` | Gizli | `EyeOff` | Başlık bloğu hiç gösterilmez |

**`BANNER` seçiliyken açılan ek alanlar** (`animate-in fade-in-0 slide-in-from-top-1 duration-200` ile, `quick-edit-row` notundaki giriş animasyonu paterniyle tutarlı):

```
<div className="mt-4 space-y-4 rounded-lg border border-border/60 bg-surface-muted/50 p-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <ColorField id="pageHeaderBackgroundColor" label="Zemin rengi (yedek)" value={pageHeaderBackgroundColor} onChange={...} />
    <MediaSelectField id="pageHeaderBackgroundMedia" label="Arka plan görseli" value={pageHeaderBackgroundMedia} onChange={...} />
  </div>
  <div className="space-y-1.5">
    <label className="block text-sm font-medium text-foreground">Karartma yoğunluğu (%{pageHeaderOverlayOpacity})</label>
    <input type="range" min={0} max={100} value={pageHeaderOverlayOpacity} onChange={...} className="w-full accent-primary" />
    <p className="text-xs text-foreground/60">Görselin üzerine binen koyu katman — başlık metninin okunabilirliğini korur.</p>
  </div>
  <p className="text-xs text-foreground/50">Hem görsel hem renk tanımlıysa GÖRSEL kazanır; renk yalnızca görsel yüklenene kadarki yedek zemindir.</p>
</div>
```

`MediaSelectField` (`frontend/src/components/admin/media/media-select-field.tsx`) kullan — `ImageUploadField` DEĞİL, çünkü `pageHeaderBackgroundMediaId` gerçek bir `Media` FK'sidir (mevcut `coverMediaId` paterni, §10.12.2), düz URL string değil. `ColorField` §5'te tanımlanan ortak renk seçici bileşenidir.

`<input type="range">` için ayrı bir Tailwind class seti gerekmiyor — proje `accent-*` utility'sini zaten kullanmıyor ama Tailwind v4 çekirdek utility'si, `accent-primary` mevcut `--primary` token'ına bağlanır; native range thumb'ı tema rengiyle boyar.

---

## 5) Stil / Genel Renk

**Karar: Ortak `ColorField` bileşeni — native `<input type="color">` (küçük kare swatch) + yanında hex `<Input>` (metin) + WCAG uyarı rozeti.**

```
function ColorField({ id, label, value, onChange, checkAgainst }: {
  id: string; label: string; value: string; onChange: (hex: string) => void;
  checkAgainst?: string; // kontrast kontrolü için karşılaştırılacak diğer renk (örn. buttonColor vs buttonTextColor)
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
          aria-label={`${label} — renk seçici`}
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono uppercase"
          maxLength={7}
          aria-label={`${label} — hex kod`}
        />
      </div>
      {checkAgainst && <ContrastBadge foreground={value} background={checkAgainst} />}
    </div>
  );
}
```

**`ContrastBadge` — WCAG AA eşiği ve metin (net karar, architect'in bıraktığı boşluk):**

- Eşik: **4.5:1** (WCAG AA, normal metin boyutu — buton/link metinleri 18px altı olduğu varsayılır, büyük metin 3:1 istisnası KULLANILMAZ, daha güvenli/basit tek eşik).
- Hesaplama: standart relative luminance formülü (sRGB → linearize → `0.2126R + 0.7152G + 0.0722B`), sonra `(L1+0.05)/(L2+0.05)`.
- Görsel:
  - Oran ≥ 4.5 → `<Badge tone="success" size="sm">Kontrast yeterli ({oran}:1)</Badge>`
  - Oran < 4.5 → `<Badge tone="warning" size="sm">Düşük kontrast ({oran}:1) — AA eşiği 4.5:1</Badge>`
- **Engellemeyen (non-blocking):** Kaydet butonu bu rozetten etkilenmez, disabled OLMAZ (§10.12.4: "sunucuda zorlanmaz", istemci de zorlamaz — sadece bilgilendirir).

**Alanlar ve karşılaştırma çiftleri (§10.12.4/openapi `SiteAppearance`):**

| Alan | Etiket | `checkAgainst` |
|---|---|---|
| `primaryColor` | Birincil Renk | — (kontrast kontrolü yok, marka rengi serbest) |
| `secondaryColor` | İkincil Renk | — |
| `buttonColor` | Buton Zemini | `buttonTextColor` (karşılıklı) |
| `buttonTextColor` | Buton Metni | `buttonColor` |
| `linkColor` | Bağlantı Rengi | `--site-secondary`'nin altında render edileceği varsayılan zemin — pratikte body arka planı sabit `#ffffff`/`#09090b` olmadığından (site kullanıcı temalı olabilir) bu alan için kontrast kontrolü YAPILMAZ, sadece renk seçici gösterilir |

Layout: `grid grid-cols-1 gap-4 sm:grid-cols-2` (settings sayfasındaki genel form gridiyle tutarlı).

---

## 6) Sosyal Medya Paylaşımı

**Karar:** Bu sekmede TEK bir alan var: `socialShareEnabled` toggle + açık ise altında beliren `socialShareNetworks` çoklu-seçim çip grubu. Hesap linklerine (Navigasyon'a) derin link, alt bilgi olarak eklenir.

```
<Card className="space-y-4">
  <SectionHeader icon={Share2} title="Sosyal Medya Paylaşımı" description="Yazı ve sayfa altında görünen paylaşım butonları." />
  <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
    <div>
      <p className="text-sm font-medium text-foreground">Paylaşım butonlarını göster</p>
      <p className="text-xs text-foreground/60">Ziyaretçiler içeriği bu ağlarda paylaşabilir.</p>
    </div>
    <Switch checked={socialShareEnabled} onCheckedChange={setSocialShareEnabled} aria-label="Paylaşım butonlarını göster" />
  </div>

  {socialShareEnabled && (
    <div className="flex flex-wrap gap-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
      {SOCIAL_SHARE_OPTIONS.map((opt) => {
        const active = socialShareNetworks.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => toggleNetwork(opt.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200",
              active ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground/60 hover:bg-muted"
            )}
          >
            <opt.icon className="h-3.5 w-3.5" /> {opt.label}
          </button>
        );
      })}
    </div>
  )}

  <p className="text-xs text-foreground/50 border-t border-border/60 pt-3">
    Sitenizin kendi sosyal hesap linkleri (Twitter, Instagram vb.) burada değil —{" "}
    <Link href="/admin/navigation?tab=locations" className="text-primary hover:underline">Navigasyon'da yönetilir</Link>.
  </p>
</Card>
```

`SOCIAL_SHARE_OPTIONS` (`SocialShareNetwork` enum, §10.12.1'deki AYRIM'a uygun — `SocialPlatform` ile KARIŞTIRILMAZ):

| `value` | Etiket | İkon |
|---|---|---|
| `TWITTER` | Twitter / X | `AtSign` (mevcut `SITE_FOOTER` eşleştirmesiyle tutarlı) |
| `FACEBOOK` | Facebook | `ThumbsUp` |
| `LINKEDIN` | LinkedIn | `Briefcase` |
| `WHATSAPP` | WhatsApp | `MessageCircle` |
| `EMAIL` | E-posta | `Mail` |
| `COPY_LINK` | Linki Kopyala | `Link2` |

(`TWITTER`/`FACEBOOK`/`LINKEDIN` ikonları `site-footer.tsx`'teki `SOCIAL_ICONS` eşlemesiyle GÖRSEL OLARAK aynı seçildi — kullanıcı aynı platformu iki farklı yerde farklı ikonla görmesin.)

---

## 7) Yazı Tipi Ayarları

**Karar: Görsel kart seçici (dropdown DEĞİL)** — her fontun KENDİ yazı tipiyle örnek metin göstermesi, kullanıcının "bu font nasıl görünüyor" sorusunu tıklamadan cevaplar (Stripe/Linear'ın font seçicilerindeki desen). Başlık fontu ve gövde fontu için AYRI, birbirinin altında iki `grid`.

```
<div className="space-y-2">
  <p className="text-sm font-medium text-foreground">Başlık Fontu</p>
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {SITE_FONT_OPTIONS.map((opt) => (
      <button
        role="radio" aria-checked={headingFont === opt.value}
        className={cn(
          "rounded-lg border p-3 text-left transition-all duration-300",
          headingFont === opt.value ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
        )}
        style={{ fontFamily: opt.cssFallback }}
      >
        <span className="block text-base text-foreground">Aa</span>
        <span className="mt-1 block text-xs text-foreground/60" style={{ fontFamily: "inherit" }}>{opt.label}</span>
      </button>
    ))}
  </div>
</div>
{/* Gövde Fontu — aynı grid, ayrı state (`bodyFont`) */}
```

Kart içindeki önizleme metni `next/font/google` derleme-zamanı yüklemesi GEREKTİRMEZ (§10.12.3 — enum kapalı ama panel içindeki mini-önizleme sistem fontlarıyla yaklaşık gösterim yapabilir); `opt.cssFallback` her font için tarayıcının zaten sahip olduğu en yakın sistem eşleniği (aşağıdaki tabloda) — admin panelinin kendisi bu fontları YÜKLEMEZ, sadece `font-family` CSS ile yaklaşık bir izlenim verir. **Gerçek font yalnızca sağdaki canlı önizleme panelinde** (`SiteHeader`/`SiteFooter`, `.site-scope` altında, `--site-heading-font`/`--site-body-font` üzerinden) doğru şekilde görünür — frontend-agent bu iki değişkeni gerçek `next/font/google` çıktısına bağlar.

**Font eşleştirme tablosu** (`SiteFont` enum → görüntülenen ad + admin kart önizlemesindeki `cssFallback`):

| `SiteFont` değeri | Görüntülenen ad | Google Font | `cssFallback` (admin kart önizlemesi) |
|---|---|---|---|
| `SYSTEM` | Sistem Yazı Tipi | — (harici istek yok) | `ui-sans-serif, system-ui, sans-serif` |
| `INTER` | Inter | Inter | `Inter, ui-sans-serif, sans-serif` (proje zaten Inter'e yakın bir font kullanıyor olabilir, en güvenli fallback) |
| `ROBOTO` | Roboto | Roboto | `Roboto, Arial, sans-serif` |
| `OPEN_SANS` | Open Sans | Open Sans | `"Segoe UI", Arial, sans-serif` |
| `MONTSERRAT` | Montserrat | Montserrat | `Verdana, Geneva, sans-serif` |
| `POPPINS` | Poppins | Poppins | `Verdana, Geneva, sans-serif` |
| `LORA` | Lora | Lora | `Georgia, "Times New Roman", serif` |
| `PLAYFAIR_DISPLAY` | Playfair Display | Playfair Display | `Georgia, serif` |
| `SOURCE_SERIF_4` | Source Serif 4 | Source Serif 4 | `"Times New Roman", Times, serif` |

**Gövde metni temel boyutu (`baseFontSize`, 14-20px):** Yazı tipi kartlarının ALTINDA, ayrı bir sayısal alan — `<input type="range" min={14} max={20} step={1}>` + değeri gösteren `%{baseFontSize}px` etiketi (Sayfa Başlığı'ndaki karartma sürgüsüyle AYNI görsel desen, tutarlılık için).

---

## 8) Ekstra Özellikler

**Karar: `Accordion` bileşeni (`components/ui/accordion.tsx`, zaten mevcut) — her anahtar bir `AccordionItem`, başlık satırında toggle + açıklama, yalnızca metin-alanı gerektirenler (`cookieBannerEnabled`, `maintenanceModeEnabled`) açılınca panel içinde ek `Textarea`/`Input` gösterir.**

Toggle'ın Accordion TETİKLEYİCİSİNDEN bağımsız olması önemli — kullanıcı paneli açmadan da anahtarı aç/kapa yapabilmeli, "genişlet" ayrı bir eylem:

```
<Accordion className="divide-y-0">
  {FEATURE_TOGGLES.map((feature) => (
    <AccordionItem key={feature.key} value={feature.key}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <feature.icon className="h-4 w-4 shrink-0 text-foreground/50" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{feature.label}</p>
          <p className="text-xs text-foreground/60">{feature.description}</p>
        </div>
        <Switch checked={values[feature.key]} onCheckedChange={(v) => setValue(feature.key, v)} aria-label={feature.label} />
        {feature.hasExtraFields && (
          <AccordionTrigger className="w-auto p-1.5" aria-label={`${feature.label} ek ayarları`} />
        )}
      </div>
      {feature.hasExtraFields && (
        <AccordionPanel className="space-y-3 px-3 pb-3">
          {/* çerez bandı: Textarea (metin) + Input (politika href) */}
          {/* bakım modu: Textarea (mesaj) */}
        </AccordionPanel>
      )}
    </AccordionItem>
  ))}
</Accordion>
```

`AccordionTrigger`'ın kendi `ChevronDown` ikonu zaten `components/ui/accordion.tsx` içinde tanımlı — burada sadece `w-auto` ile satırın en sağına, toggle'ın YANINA küçültülmüş hali kullanılıyor (varsayılan `w-full` satır davranışı yerine).

**5 anahtar, sıra ve içerik (§10.12.5 — v1 kabul edilen beş anahtar):**

| `key` | Etiket | Açıklama | İkon | Ek alan |
|---|---|---|---|---|
| `backToTopEnabled` | Yukarı Çık Butonu | Sayfa kaydırıldığında sağ altta beliren buton. | `ArrowUpCircle` | Yok |
| `stickyHeaderEnabled` | Yapışkan Header | Sayfa kaydırılırken header üstte sabit kalır. | `PanelTop` | Yok |
| `cookieBannerEnabled` | Çerez Bandı | **Bilgilendirme amaçlıdır — onay yönetimi yapmaz, hiçbir script'i engellemez.** | `Cookie` | `cookieBannerText` (Textarea) + `cookieBannerPolicyHref` (Input) |
| `maintenanceModeEnabled` | Bakım Modu | Site ziyaretçilerine bakım sayfası gösterir. Yönetim paneli etkilenmez. | `Wrench` | `maintenanceMessage` (Textarea) |
| `socialShareEnabled` | Sosyal Paylaşım | (Bu listede tekrar GÖSTERİLMEZ — kendi sekmesinde yönetilir, §6.) | — | — |

**Not — `socialShareEnabled` bu accordion'da satır olarak YER ALMAZ**, çünkü zaten §6'da kendi sekmesi var; görev tanımındaki "5 toggle" listesi mimari doküman açısından kavramsal bir sayımdır (§10.12.5), UI'da tekrar etmek kullanıcıyı iki farklı yerde aynı anahtarı görmeye/şaşırmaya sürükler. **Bu bölümdeki Accordion'da yalnızca 4 satır render edilir.**

**Bakım modu satırı, açık olduğunda ekstra bir uyarı şeridi de gösterir** (Accordion panelinin İÇİNDE, textarea'nın ÜSTÜNDE):
```
<Alert variant="warning" className="text-xs">
  Bakım modu yalnızca ziyaretçi sitesini etkiler — yönetim paneline erişiminiz kesilmez.
</Alert>
```

**Çerez bandı varsayılan placeholder metinleri (Türkçe, `Textarea`'nın `placeholder` prop'u — DB varsayılanı değil, kullanıcı hiç yazmadıysa görünen ipucu):**
- `cookieBannerText` placeholder: *"Bu site deneyiminizi iyileştirmek için çerezler kullanır. Sitede gezinmeye devam ederek çerez kullanımını kabul etmiş olursunuz."*
- `cookieBannerPolicyHref` placeholder: `/gizlilik-politikasi`

**Bakım modu varsayılan placeholder:**
- `maintenanceMessage` placeholder: *"Sitemizde bakım çalışması yapıyoruz. Kısa süre içinde geri döneceğiz."*

---

## 9) Özel CSS / JS

**Karar: Sade `<textarea>` (syntax highlight YOK — proje `@monaco-editor`/`codemirror` bağımlılığı KULLANMIYOR, doğrulandı), monospace font, satır numarası YOK (kapsam dışı, basit tutulur).**

```
<Textarea
  value={css}
  onChange={(e) => setCss(e.target.value)}
  rows={14}
  spellCheck={false}
  className="font-mono text-xs leading-relaxed"
  placeholder="/* Örnek: .site-scope h1 { letter-spacing: -0.02em; } */"
/>
```

`components/ui/textarea.tsx` zaten var — yeni bir bileşen YAZILMAZ, sadece `className="font-mono text-xs"` ile monospace'e çevrilir (varsayılan `text-base`/proportional yerine).

**Güvenlik uyarısı — CSS bölümü (üstte, EDİTÖRÜN HEMEN ÜSTÜNDE, `Alert` bileşeninin `warning` varyantıyla):**

> **`components/ui/alert.tsx`'e `warning` varyantı EKLENMESİ GEREKİYOR** (şu an sadece `error`/`success`/`info` var). Eklenecek satır, mevcut desenle BİREBİR tutarlı:
> ```ts
> warning: "border-warning/30 bg-warning/10 text-warning",
> ```
> (`--warning`/`--color-warning` token'ı `globals.css`'te zaten tanımlı — badge.tsx'in `warning` tonuyla renk kaynağı ORTAK.) Bu, frontend-agent'ın yapacağı KÜÇÜK bir bileşen genişletmesidir, yeni bir bileşen değil.

```
<Alert variant="warning">
  <span className="flex items-start gap-2">
    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
    <span>
      <span className="block font-medium">Bu alan sitenizin HTML'ine doğrudan gömülür.</span>
      Yalnızca güvendiğiniz kod parçacıklarını yapıştırın. Hatalı CSS sitenizin görünümünü bozabilir.
    </span>
  </span>
</Alert>
```

**JS bölümü için DAHA SERT bir uyarı (`Alert variant="error"` — CSS'ten görsel olarak daha ciddi, çünkü JS riski daha yüksek, §10.12.6):**

```
<Alert variant="error">
  <span className="flex items-start gap-2">
    <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
    <span>
      <span className="block font-medium">Bu alan her ziyaretçinin tarayıcısında sitenizin kendi kaynağından çalışır.</span>
      Kötü niyetli veya hatalı kod; veri sızıntısına, oturum çalınmasına veya sitenizin çökmesine yol açabilir. Yalnızca ne yaptığını TAM olarak anladığınız kodu ekleyin.
    </span>
  </span>
</Alert>
```

**Onay checkbox'ı + disabled Kaydet (§10.12.6 — `acknowledged` sunucuda zorunlu, istemci UI'da da yansıtır):**

```
<label className="flex items-start gap-2 text-sm text-foreground">
  <Checkbox checked={acknowledged} onCheckedChange={setAcknowledged} className="mt-0.5" />
  Bu kodun ne yaptığını anlıyorum ve sonuçlarını kabul ediyorum.
</label>
<Button type="button" disabled={!acknowledged && Boolean(css?.trim())} onClick={handleSaveCss}>
  CSS'i Kaydet
</Button>
```

**Disabled koşulu netleştirmesi:** `acknowledged` checkbox'ı yalnızca **kod alanı DOLU olduğunda** zorunludur — kod temizlenirken (`""`/`null`) onay ARANMAZ (§10.12.6 "kod temizlenirken onay aranmaz"). Bu yüzden disabled ifadesi `!acknowledged && Boolean(code?.trim())`: kod boşsa checkbox işaretlenmese bile buton AKTİF kalır (silme her zaman güvenli).

**Kill switch (`customCodeEnabled: false`) görsel karşılığı:** Editör `disabled` olur + üstte AYRI bir `Alert variant="info"`:
```
<Alert variant="info">
  Özel kod düzenleme şu anda ortam tarafından devre dışı bırakılmış.
</Alert>
```
(Textarea + checkbox + Kaydet butonu hepsi `disabled`.)

**CSS/JS ayrı Kaydet butonları:** İki alan `PUT /admin/appearance/custom-code/css` ve `.../js` ayrı uçlar olduğu için (§10.12.6), her birinin KENDİ Kaydet butonu ve KENDİ `acknowledged` checkbox'ı vardır — ortak "Tümünü Kaydet" çubuğuna DAHİL EDİLMEZ (o çubuk yalnızca `PATCH /admin/appearance`'a giden 8 bölümü kapsar).

**Denetim izi görünümü (salt-okunur, editörün ALTINDA, küçük metin):**
```
<p className="text-xs text-foreground/50">
  Son güncelleme: {cssUpdatedBy?.name ?? "—"} · {formatDate(cssUpdatedAt)}
</p>
```

---

## 10) 404 Sayfası

**Karar: Basit form alanları + canlı önizleme panelinde SİMÜLE EDİLMEZ (statik açıklama kartı yeterli)** — sağdaki `SiteHeader`/`SiteFooter` önizlemesi normal sayfa akışını gösterir, 404 durumunu simüle etmek ayrı bir sahte route/DOM gerektirir ve mevcut önizleme paterniyle uyuşmaz (§10.12.9'daki "SiteHeader/SiteFooter prop arayüzü DEĞİŞTİRİLMEDEN" kısıtına da aykırı düşerdi).

```
<Card className="space-y-4">
  <SectionHeader icon={FileQuestion} title="404 Sayfası" description="Sayfa bulunamadığında gösterilecek özel metin." />
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <Field id="notFoundTitle" label="Başlık" hint='Boş bırakılırsa "Sayfa Bulunamadı" kullanılır.'>
      {(p) => <Input {...p} value={notFoundTitle ?? ""} onChange={(e) => setNotFoundTitle(e.target.value)} maxLength={120} />}
    </Field>
    <Field id="notFoundButtonLabel" label="Buton Metni" hint="Href de doluysa gösterilir.">
      {(p) => <Input {...p} value={notFoundButtonLabel ?? ""} onChange={(e) => setNotFoundButtonLabel(e.target.value)} maxLength={60} />}
    </Field>
    <Field id="notFoundMessage" label="Mesaj" className="sm:col-span-2">
      {(p) => <Textarea {...p} rows={3} value={notFoundMessage ?? ""} onChange={(e) => setNotFoundMessage(e.target.value)} maxLength={500} />}
    </Field>
    <Field id="notFoundButtonHref" label="Buton Bağlantısı" hint="Varsayılan /.">
      {(p) => <Input {...p} value={notFoundButtonHref ?? ""} onChange={(e) => setNotFoundButtonHref(e.target.value)} maxLength={2048} />}
    </Field>
  </div>

  <div className="rounded-lg border border-dashed border-border p-4 text-center">
    <p className="text-sm font-medium text-foreground">{notFoundTitle || "Sayfa Bulunamadı"}</p>
    <p className="mt-1 text-xs text-foreground/60">{notFoundMessage || "Aradığınız sayfa taşınmış veya kaldırılmış olabilir."}</p>
    {notFoundButtonLabel && notFoundButtonHref && (
      <span className="mt-3 inline-block rounded-lg bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground">
        {notFoundButtonLabel}
      </span>
    )}
  </div>
</Card>
```

**Statik mini-önizleme** (`border-dashed`, `SiteHeader`/`SiteFooter`'ın DIŞINDA, bağımsız bir kart) — gerçek sayfa şablonunu TAKLİT ETMEZ, sadece metinlerin nasıl birleşeceğini (başlık+mesaj+koşullu buton) gösterir. `border-dashed`, bunun "gerçek" canlı önizleme olmadığını, bir ÖRNEK/taslak olduğunu görsel olarak ayırt eder.

**404 varsayılan placeholder'ları (input `placeholder` — DB varsayılanı `null`, frontend'in sabit Türkçe varsayılanı §10.12.7'ye göre BURADA render edilen metinlerle AYNI olmalı):**
- `notFoundTitle`: *"Sayfa Bulunamadı"*
- `notFoundMessage`: *"Aradığınız sayfa taşınmış veya kaldırılmış olabilir."*
- `notFoundButtonLabel`: *"Ana Sayfaya Dön"*
- `notFoundButtonHref`: `/`

---

## Kaydedilmemiş Değişiklik — Görsel Sunum (frontend-agent hook'unu SADECE görsel olarak giydiriyoruz)

- **Sekme rozeti:** Kirli olan her sekmenin `TabsTrigger` etiketinin YANINDA `bg-warning` nokta — navigasyon sayfasındaki `menuHasUnsavedChanges`/`locationsHasUnsavedChanges` deseniyle BİREBİR: `<span className="ml-1 h-1.5 w-1.5 rounded-full bg-warning" aria-hidden="true" />`. Dikey listede bu nokta `TabsTrigger`'ın SAĞ kenarına yaslanır (`ml-auto`).
- **Yapışkan alt çubuk:** `sticky bottom-6 z-10` içinde `Card className="flex items-center gap-3 p-3 shadow-lg"` — navigasyon sayfasının BİREBİR AYNISI: kirli sekme varsa `bg-warning` nokta + "Kaydedilmemiş değişiklikler var" metni + "Tümünü Kaydet" butonu.
- **Bölüm başına Kaydet (§10.12.9):** Her `TabsContent`'in EN ALTINDA, o bölüme özel küçük bir `Button size="sm"` — "Bu bölümü kaydet". Bu buton yalnızca İLGİLİ bölüm kirliyken `variant="default"`, temizken `variant="secondary"` (görsel önceliği düşürülür ama gizlenmez — kullanıcı istese de tekrar kaydedebilmeli, no-op zararsız).
- **`beforeunload`/sekme geçişi onayı** aynı Türkçe metni kullanır (`UNSAVED_CHANGES_WARNING`, hook modülüne taşınmış hali) — görsel olarak native `window.confirm` dialogu, ui-designer'ın kontrolü DIŞINDA (tarayıcı native UI'ı).

---

## Token Özet Tablosu — `--site-*` (§10.12.4)

| Token | Kaynak alan (`SiteAppearance`) | Uygulandığı yer |
|---|---|---|
| `--site-primary` | `primaryColor` | `.site-scope` kökü |
| `--site-secondary` | `secondaryColor` | `.site-scope` kökü |
| `--site-button` | `buttonColor` | `.site-scope` kökü |
| `--site-button-text` | `buttonTextColor` | `.site-scope` kökü |
| `--site-link` | `linkColor` | `.site-scope` kökü |
| `--site-heading-font` | `headingFont` (çözümlenmiş `next/font` değişkeni) | `.site-scope` kökü |
| `--site-body-font` | `bodyFont` (çözümlenmiş `next/font` değişkeni) | `.site-scope` kökü |
| `--site-base-font-size` | `baseFontSize` (px) | `.site-scope` kökü |

**Bağlayıcı hatırlatma (kod yazmıyorum ama görsel doğruluk için tekrar):** Bu değişkenler `:root`'a DEĞİL, yalnızca önizleme sarmalayıcısındaki `.site-scope` class'ına satır-içi `style` ile yazılır — admin panelinin `--primary`/`--ring` token'larını EZMEZ.

---

## Yeni Bileşen İhtiyacı Özeti (frontend-agent için)

Bu panel YENİ bir "preview component" gerektirmiyor (§10.12.9 — mevcut `SiteHeader`/`SiteFooter` kullanılıyor). Ancak şu KÜÇÜK, mevcut bileşen üzerine yapılan eklemeler gerekiyor:

1. `components/ui/alert.tsx` → `warning` varyantı eklenir (bkz. §9, tek satır `cva`/Record girişi).
2. `ColorField` (yeni, küçük, `admin/appearance/` altında) → native color input + hex text input + opsiyonel `ContrastBadge`.
3. `ContrastBadge` (yeni, küçük) → WCAG AA 4.5:1 hesaplayıp `Badge tone="success"|"warning"` döner.
4. `Tabs orientation="vertical"` kullanımı — bileşenin kendisi zaten destekliyor, yeni kod GEREKMİYOR, sadece prop.

Hiçbiri "yeni bir görsel dil" değil — hepsi mevcut `Card`/`Badge`/`Input`/`Alert`/`Accordion`/`Switch`/`Button` üzerine ince kompozisyon.

---

## Kontrol Listesi (frontend-agent)

- [ ] Sol dikey `TabsList` (`orientation="vertical"`, `lg:w-64 lg:sticky lg:top-6`), 9 sekme, ikonlar yukarıdaki tabloyla birebir.
- [ ] Sağ önizleme paneli TÜM sekmelerde (özel kod hariç) `SiteHeader`/`SiteFooter` ile CANLI güncellenir (`.site-scope` + satır-içi `--site-*`).
- [ ] `customCode` sekmesinde sağ panel "Siteyi Aç" CTA kartına döner (önizleme YOK).
- [ ] Logo & Marka kartı tamamen salt-okunur, Kaydet butonu YOK, `/admin/navigation?tab=locations` linki var.
- [ ] Preset kartları: renk şeridi + `border-primary bg-primary/5 ring-1 ring-primary/30` seçili durumu + elle değişiklikte `presetKey: null` → "Özel" rozeti.
- [ ] Sayfa başlığı: 3'lü radio-kart + `BANNER` seçiliyken `MediaSelectField` (ImageUploadField DEĞİL) + karartma sürgüsü.
- [ ] Renk alanları: `ColorField` (native color + hex input) + `buttonColor`/`buttonTextColor` çiftinde `ContrastBadge` (4.5:1 eşik, engellemeyen).
- [ ] Sosyal paylaşım: tek `Switch` + açılan çip grubu (`SocialShareNetwork`, `SocialPlatform` ile KARIŞTIRILMAZ) + Navigasyon'a alt bilgi linki.
- [ ] Yazı tipi: başlık/gövde için AYRI görsel kart gridleri (`Aa` önizlemesi + `cssFallback`), `baseFontSize` için range slider.
- [ ] Ekstra özellikler: `Accordion` içinde 4 satır (`socialShareEnabled` BURADA TEKRAR EDİLMEZ), çerez bandı/bakım modu açıldığında ek alanlar + Türkçe placeholder'lar.
- [ ] Özel CSS/JS: syntax-highlight YOK, `font-mono` textarea, CSS'te `warning` Alert / JS'te `error` Alert, onay checkbox'ı + kod DOLUYKEN disabled Kaydet, kill switch'te tüm alan disabled + `info` Alert.
- [ ] 404: form + `border-dashed` statik mini-önizleme (SiteHeader/SiteFooter içinde DEĞİL), placeholder'lar §10 tablosuyla birebir.
- [ ] Kirli sekme noktası (`bg-warning`), yapışkan alt Kaydet çubuğu, bölüm-başına Kaydet — navigasyon sayfasıyla BİREBİR görsel tutarlılık.
- [ ] `components/ui/alert.tsx`'e `warning` varyantı eklenir (`border-warning/30 bg-warning/10 text-warning`).
