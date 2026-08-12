# Tasarım Notu — Çok Dillilik (i18n) Görsel Dili

**Kapsam:** `.claude/architect-scope-i18n.md` §9 "ui-designer" görev listesi (madde 1-5) + §7 "Admin panel arayüz dili" bölümünün gerektirdiği görsel kararlar. Bu doküman bağlayıcıdır — frontend-agent burada tanımlanan sınıf/token değerlerini birebir tüketir, yeni bir görsel dil İCAT ETMEZ.

**Görsel yön:** Değişmedi — proje **Minimal/Flat** (bkz. `design-notes-appearance-panel.md`, `design-notes-appearance-polish.md`). Bu doküman yeni bir görsel dil eklemez; mevcut `Card`/`Badge`/`Button`/`Tabs`/`Alert`/`ConfirmDialog` token setini kullanır ve yalnızca gerekli olan yerlerde **küçük, gerekçeli** eklemeler (1 yeni Button varyantı, 1 yeni ConfirmDialog tonu) önerir.

**Kaynak incelemesi:** `frontend/src/components/admin/topbar.tsx` (mevcut `🇹🇷 TR` göstergesi, `LOCALE_OPTIONS`), `frontend/src/app/admin/pages/[pageId]/page.tsx` (mevcut `LocaleToggle` — TR/EN segmented control, satır 68-85, çeviri durumu/fallback göstergesi YOK), `frontend/src/components/site/site-header.tsx` (`.site-scope` `--site-*` token ailesi, admin `--primary`'den bağımsız), `frontend/src/app/globals.css` (`--primary`/`--success`/`--warning`/`--danger` + AA kontrast notları, `--radius-*` ölçeği, admin tipografi sınıfları `.admin-h1/h2/h3/body/text-secondary`), `frontend/src/components/ui/{badge,tabs,button,confirm-dialog,alert,card}.tsx`, `frontend/src/components/admin/content-list/content-list-tabs.tsx` (`flex-nowrap overflow-x-auto` — mevcut yatay sekme taşma deseni), `frontend/src/components/admin/accent-color-picker.tsx` (seçili öğe için `Check` ikonu + `ml-auto` deseni).

---

## 0. Bağlayıcı kavram ayrımı — mimari §7.4'ün görsel karşılığı

Architect §7.4 iki dil kavramını ayırıyor (`adminLocale` vs `locale`). Bunun görsel karşılığı **tek bir tabloya** bağlanır — aşağıdaki 5 sinyalin **hepsi** aynı anda farklı olmalı, tek bir sinyale (örn. sadece ikon) güvenilmez:

| Sinyal | Ziyaretçi dil değiştirici (**içerik dili**, `locale`) | Panel arayüzü dil değiştirici (**arayüz dili**, `adminLocale`) |
|---|---|---|
| Konum | Site header, sağ blok (sepet ikonundan önce) | Admin topbar, sağ blok (mevcut yer korunur) |
| İkon | `Globe` (lucide-react) | `Languages` (lucide-react — zaten kullanılıyor, korunur) |
| Etiket biçimi | **Tam `nativeLabel`** ("English", "Türkçe") | **Kısa kod, büyük harf** ("TR", "EN") |
| Bayrak | Kullanılmaz (bkz. §4) | Kullanılmaz (bkz. §4) |
| Token ailesi | `.site-scope` (`--site-*`) | `.admin-shell` (`--primary`, admin `--foreground`) |
| Veri kaynağı | `GET /locales` (`enabled=true`, `sortOrder` sıralı) | Sabit 2 seçenek (`tr`/`en` — panel arayüz çevirisi Faz 1 kapsamı, §7.3) |
| Seçimin sonucu | Aynı içeriğin o dildeki URL'i (`localizations`'tan) | Yalnızca `localStorage`, URL/API'ye **hiç** yansımaz |
| Seçili öğe göstergesi | `Check` ikonu, `ml-auto` (accent-color-picker.tsx ile aynı desen) | `Check` ikonu, `ml-auto` (aynı desen — iç tutarlılık) |

**Not:** `Globe` ikonu projede başka bağlamlarda (örn. `settings/page.tsx`'teki "Tanıtım Sitesi" şablon seçeneği) zaten kullanılıyor — bu genel bir ikon tekeli kuralı DEĞİLDİR. Kural yalnızca şu ikiliye özeldir: **aynı ekranda/akışta içerik dili ile arayüz dili yan yana görünebileceği her yerde** `Globe` = içerik, `Languages` = arayüz ayrımı korunmalıdır.

---

## 1. Dil değiştirici deseni

### 1.1 (a) Site header — ziyaretçi içerik dil değiştirici

`frontend/src/components/site/site-header.tsx`'e, sepet linkinden önce, `DropdownMenu` (mevcut header zaten bu bileşeni kullanıyor — navigasyon alt menüleri) ile:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger
    render={
      <button
        type="button"
        aria-label="Dil seç"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-sm text-foreground/70 outline-none transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:text-foreground"
      />
    }
  >
    <Globe className="h-3.5 w-3.5" aria-hidden="true" />
    {activeLocale.nativeLabel}
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
    {locales.map((l) => (
      <DropdownMenuItem key={l.code} render={<Link href={l.href} />}>
        {l.nativeLabel}
        {l.code === activeLocale.code && <Check className="ml-auto h-4 w-4" />}
      </DropdownMenuItem>
    ))}
  </DropdownMenuContent>
</DropdownMenu>
```

Somut değerler: `rounded-lg` (mevcut CTA/sepet butonlarıyla aynı yarıçap), `px-2.5 py-1.5` (mevcut CTA linkiyle `py-1.5` ortak), `text-sm` (header'ın genel metin boyutu), `gap-1.5` (proje spacing ölçeğinden 6px), ikon `h-3.5 w-3.5` (14px — header'daki `ChevronDown h-3.5 w-3.5` ile tutarlı). `border-border`/`text-foreground/70`/`hover:bg-surface-muted` — bunlar `--site-*` DEĞİL, paylaşılan global temadan (header zaten `border-border bg-surface/80` kullanıyor, tutarlı) — yalnızca CTA/sepet rozeti gibi **markaya özel** öğeler `--site-*` kullanır; bu buton nötr bir chrome öğesi olduğu için mevcut header deseniyle aynı kalır.

`DropdownMenuContent`'e `max-h-72 overflow-y-auto` — 5-6 dilde menü taşmasın diye (mevcut bileşende varsayılan bir üst sınır yok, bu satır YENİ eklenir). `locales.map`, `Locale.sortOrder` sırasına göre (backend zaten bu sırayla döner, frontend ekstra sıralama YAPMAZ).

`l.href`: mevcut sayfanın **o dildeki karşılığı** (`localizations`'tan çözümlenir); yoksa o dilin ana sayfasına (`/en`) düşer — bu davranış frontend-agent'ın (architect §9 madde 4), burada yalnızca görsel/etkileşim sözleşmesi tanımlanıyor.

### 1.2 (b) Admin topbar — panel arayüz dil değiştirici (mevcut, bayraksız hale getirilir)

`frontend/src/components/admin/topbar.tsx`'teki `LOCALE_OPTIONS` değişir — **yalnızca `label` alanından emoji kaldırılır**, bileşen yapısı (dropdown, mobil `role="group"` satırı) AYNEN KALIR:

```diff
 const LOCALE_OPTIONS: { value: AdminLocale; label: string }[] = [
-  { value: "tr", label: "🇹🇷 TR" },
-  { value: "en", label: "🇬🇧 EN" },
+  { value: "tr", label: "TR" },
+  { value: "en", label: "EN" },
 ];
```

`Languages` ikonu (satır 39, mevcut) KORUNUR — bayrağın taşıdığı "hangi dil" bilgisini artık tek başına ikon + kısa kod taşıyor. Seçili öğede `Check` ikonu eklenir (mevcut `font-medium` vurgusuyla BİRLİKTE, tek sinyal olmasın diye — accent-color-picker.tsx'teki desenle birebir):

```diff
 <DropdownMenuItem
   key={option.value}
   onClick={() => setAdminLocale(option.value)}
   className={option.value === adminLocale ? "font-medium" : undefined}
 >
   {option.label}
+  {option.value === adminLocale && <Check className="ml-auto h-4 w-4" />}
 </DropdownMenuItem>
```

Mobil menüdeki `role="group"` satırındaki iki küçük buton (satır 113-133) için de aynı emoji kaldırma uygulanır — orada zaten `aria-pressed` + `bg-accent` ile seçili durum görsel olarak ayırt ediliyor, ek değişiklik gerekmez.

---

## 2. Çeviri sekmesi deseni (`LocaleTabs`) — içerik editörü

### 2.1 Neden yeni bir paylaşılan bileşen

Bugün her editörde (`pages/[pageId]`, `blog/[postId]`, ve mimari doküman gereği eklenecek `products/[productId]`, `portfolio/[itemId]`) yerel bir `LocaleToggle` **kopyalanmış** ve sabit `["TR","EN"]` diline gömülü (architect §0.1a, §9 frontend-agent madde 10: "sabit EN sekmesi gömme"). Bu, `Locale` tablosundan N dile ölçeklenemez. **Karar: `LocaleTabs` tek bir paylaşılan bileşen olarak tasarlanır**, 4 editör de onu tüketir.

### 2.2 Yapı

Mevcut `Tabs`/`TabsList variant="line"` + `content-list-tabs.tsx`'teki **mevcut taşma deseni** (`flex-nowrap overflow-x-auto`) yeniden kullanılır — yeni bir taşma stratejisi İCAT EDİLMEZ:

```tsx
<Tabs value={locale} onValueChange={(v) => onLocaleChange(v)}>
  <TabsList variant="line" className="flex-nowrap overflow-x-auto">
    {locales.map((l) => (
      <TabsTrigger key={l.code} value={l.code} className="min-w-16 shrink-0 justify-center gap-1.5">
        <span className="uppercase">{l.code}</span>
        {!l.isDefault && <LocaleStatusIcon status={statusFor(l.code)} />}
      </TabsTrigger>
    ))}
  </TabsList>
</Tabs>
```

Somut değerler: `min-w-16` (64px — kod + ikon rahat sığar, tab sıkışıp metni kırpmaz), `shrink-0` (`flex-nowrap` ile birlikte tab'lerin daralması yerine şerit yatay kayar — mobil/5-6 dilde davranış budur, `content-list-tabs.tsx` ile birebir aynı strateji). `l.code` **büyük harfte** gösterilir (`uppercase` class, veri küçük harf kalır — mimari §3.2 madde 1 ile çelişmez, yalnızca sunum) — bu, mevcut `LocaleToggle`'ın "TR"/"EN" biçimiyle görsel süreklilik sağlar.

**Varsayılan dil sekmesi (`isDefault`) hiçbir zaman durum ikonu TAŞIMAZ** — "çevrildi/kısmen/çevrilmedi" kavramı kendi kaynağına uygulanamaz; bu yokluk, sekmenin "kaynak dil" olduğunun kendisi bir sinyaldir (ekstra rozet gerekmez, gürültü olur). Varsayılan dil `Locale.sortOrder`'a göre zaten ilk sekmededir (mimari §2.1 seed: `tr` sortOrder 0).

### 2.3 Durum ikonu — üç durum, üç FARKLI ŞEKİL (renk tek sinyal değil)

```tsx
type LocaleStatus = "translated" | "partial" | "untranslated";

function LocaleStatusIcon({ status }: { status: LocaleStatus }) {
  if (status === "translated")
    return <CheckCircle2 className="h-3 w-3 text-success" aria-hidden="true" />;
  if (status === "partial")
    return <CircleDashed className="h-3 w-3 text-warning" aria-hidden="true" />;
  return <Circle className="h-3 w-3 text-foreground/30" aria-hidden="true" />;
}
```

Üç ikon şekli birbirinden **renk körlüğünde bile ayırt edilir**: dolu onay işareti (✓ şekli), kesikli halka (dashed outline), boş halka (thin outline) — üç farklı SİLÜET, sadece üç farklı renk değil. `title`/`Tooltip` ile tam metin eklenir (`Tooltip` bileşeni projede mevcut, `frontend/src/components/ui/tooltip.tsx`):

| Durum | İkon | Renk | Tooltip metni |
|---|---|---|---|
| Çevrildi | `CheckCircle2` | `text-success` | "Çevrildi" |
| Kısmen çevrildi | `CircleDashed` | `text-warning` | "Kısmen çevrildi ({dolu}/{toplam} alan)" |
| Çevrilmedi | `Circle` | `text-foreground/30` | "Çevrilmedi — varsayılan dil gösterilecek" |

**Hesaplama (frontend-agent'ın işi, burada yalnızca kural):** entity'nin `SECTION`/çevrilebilir alan listesi (Page/BlogPost/Product/Portfolio için zaten backend `translations` şemasında tanımlı alan kümesi) içinde `translations[locale]` altında dolu (boş string/undefined olmayan) alan sayısı → 0 ise `untranslated`, tümü ise `translated`, arası `partial`. Karşılaştırma **kaydedilmiş** veriye göre yapılır (autosave/snapshot sonrası) — anlık taslak yazımı sekme ikonunu her tuş vuruşunda titretmemeli (appearance panelindeki `isTabFilled`/`snapshot` kararıyla aynı ilke, bkz. `design-notes-appearance-polish.md` §4).

### 2.4 N dile ölçekleme — 5-6 dilde davranış

- 2 dilde: sekmeler tam genişlikte, kayma görünmez (davranış bugünküyle özdeş).
- 5-6 dilde: `TabsList` konteyneri dolar, `overflow-x-auto` devreye girer, kullanıcı yatay kaydırır/trackpad ile gezer. **Dropdown'a çökme (collapse) YOK** — proje zaten aynı durumda (`content-list-tabs.tsx`) dropdown'a düşmüyor, tutarlılık için burada da düşmez.
- Klavye erişilebilirliği: Base UI `Tab` roving-tabindex'i yatay `overflow-x-auto` ile ÇAKIŞMAZ (scroll native, tab-index native ok tuşu davranışıyla birlikte çalışır — appearance-polish notundaki aynı gerekçe).
- Aktif sekme ekran dışındaysa tarayıcı native `scrollIntoView` davranışı yeterlidir, ekstra JS gerekmez (v1 kapsamı dışı bırakılabilir, gerekirse frontend-agent `scrollIntoView({ inline: "nearest" })` ekler).

---

## 3. Fallback alan göstergesi

Mimari §5: bir alan varsayılan dilden geliyorsa (fallback), editördeki editör bunu görebilmeli — **üç kanallı sinyal** (renk tek başına YETERSİZ):

| Durum | Kanal 1 — Border stili | Kanal 2 — İkon+etiket rozeti | Kanal 3 — Zemin |
|---|---|---|---|
| **Çevrilmiş** (bu dilde override var) | Standart `border-input` (solid) | Rozet YOK | Standart `bg-background`/`bg-input` |
| **Fallback** (override yok, varsayılan dilden gösteriliyor) | `border-dashed border-foreground/25` | `CornerUpLeft` ikon + "Varsayılan dilden ({defaultNativeLabel})" metni | `bg-muted/30` (hafif ton, doygun renk DEĞİL) |
| **Boş** (varsayılan dilde de yok — override edilebilir opsiyonel alan) | Standart `border-input` (solid) | Rozet YOK, placeholder gri italik | Standart |

"Boş" ile "Fallback" kasıtlı olarak **görsel olarak birbirinden çok farklı** tutulur (biri kesikli+rozetli+tonlu, diğeri sade+placeholder) — editör "bu alanda hiç veri yok" ile "bu alanda TR'den gelen bir değer var, ben henüz EN'e çevirmedim" ayrımını gözle net yapabilmeli (bu, görevin doğrudan istediği ayrım).

```tsx
function FallbackBadge({ defaultLabel }: { defaultLabel: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-foreground/25 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-foreground/60">
      <CornerUpLeft className="h-3 w-3" aria-hidden="true" />
      Varsayılan dilden ({defaultLabel})
    </span>
  );
}
```

Kullanım — `Field` bileşeninin (`frontend/src/components/ui/field.tsx`) label satırının sağına, mevcut `required` yıldızıyla aynı satırda:

```tsx
<div className="flex items-center justify-between">
  <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
  {isFallback && <FallbackBadge defaultLabel={defaultLocale.nativeLabel} />}
</div>
```

Input/textarea'nın kendisine `border-dashed border-foreground/25 bg-muted/30` sınıfları koşullu eklenir (mevcut `Input`/`Textarea` bileşenlerinin `className` prop'u zaten dışarıdan override edilebiliyor — yeni bir varyant İCAT EDİLMEZ, sadece `cn()` ile koşullu class).

Somut değerler: `border-dashed` (Tailwind yerleşik), `border-foreground/25` (nötr, ne success ne warning — bu bir "eksik/hata" değil "bilgi" durumu, bu yüzden `--danger`/`--warning` KULLANILMAZ), `bg-muted/50` rozet zemini / `bg-muted/30` input zemini (rozet biraz daha belirgin), `text-[11px]` (appearance-polish notundaki mikro-etiket boyutuyla tutarlı), `rounded-full` (Badge bileşeniyle aynı köşe biçimi — bu ayrı bir bileşen ama Badge'in görsel dilini taklit eder, `Badge`'in kendisi KULLANILMAZ çünkü `Badge`'in `tone` sistemi burada anlamsız/yanlış sinyal verir).

---

## 4. Bayrak kullanımı kararı — TEK KURAL: hiçbir yüzeyde bayrak kullanılmaz

**Karar:** Proje genelinde (site dil değiştirici, admin dil değiştirici, çeviri sekmeleri, ileride Dil Yönetimi ekranı) **bayrak emoji/ikonu KULLANILMAZ.**

**Gerekçe:** Bayrak ülke temsil eder, dil değil. `en` dili İngiltere, ABD, Kanada, Avustralya bayraklarından hiçbirine tekil olarak eşlenemez; `de` Almanya/Avusturya/İsviçre; İspanyolca/Portekizce onlarca ülke. Mimarinin `Locale.code` modeli BCP-47 (`en`, `en-gb` gibi bölgesel varyantlar mümkün) — bayrak eşlemesi bu esnekliği yanlış temsil eder ve yeni bir dil eklendiğinde (mimarinin "yeni dil = deploy yok" kabul kriteri) bir tasarımcının o dil için "doğru" bayrağı elle seçmesi gerekir; bu, "yeni dil sadece bir veritabanı satırı" ilkesini görsel katmanda BOZAR.

**Yerine konan sinyal — kod + tam ad ikilisi:**
- Dar alanlarda (sekmeler, kısa buton etiketleri): **kod, büyük harf** ("TR", "EN", "DE").
- Geniş alanlarda (dropdown menü öğeleri, Dil Yönetimi listesi): **`nativeLabel` (tam ad)**, isteğe bağlı yanında küçük gri kod (`English (en)` gibi — Dil Yönetimi ekranında, §6).

Bu, zaten mevcut `LocaleToggle`'ın (pages editörü) hiç bayrak kullanmayan, sade "TR"/"EN" konvansiyonuyla uyumludur — admin topbar'daki mevcut `🇹🇷 TR` bu kurala aykırı **tek** istisnaydı, §1.2'de düzeltildi.

---

## 5. Metin genişlemesi (EN→TR ~%30) — taşma stratejisi

**Genel kural:** Çevrilebilir metin taşıyan hiçbir konteynere **sabit piksel genişlik** verilmez. İki somut teknik, bağlama göre:

| Bağlam | Strateji | Somut sınıf |
|---|---|---|
| Sidebar nav etiketi (`sidebar.tsx`, mimari §9 frontend-agent madde 9 kapsamında `t()`'ye taşınacak) | Tek satır, taşarsa **kırp + native `title` tooltip** — sarma (wrap) YOK, sidebar'ın dikey ritmini bozar | `min-w-0 flex-1 truncate` + `title={label}` |
| Buton metni (serbest genişlikli, örn. `Kaydet`/`Save changes`) | Sabit genişlik verilmez, buton içeriğe göre doğal genişler (`Button` zaten `whitespace-nowrap` — mevcut, KORUNUR) | Değişiklik yok — sadece **sabit `w-*` class'ı hiçbir zaman eklenmez** |
| Sabit-genişlikli hücreler (segmented control, dar rozet, tab kodu) | Uzun kelime yerine **kod** kullanılır (bkz. §2, §4) — bu tasarım kuralı zaten taşmayı kaynağında önler | `uppercase` kod, `min-w-16` |
| Badge/Chip (durum etiketleri: "Yayında"/"Published", "Taslak"/"Draft") | Badge zaten içeriğe göre genişler (`inline-flex`, `Badge` bileşeni sabit genişlik TAŞIMAZ) — risk YOK, ama bir Badge grid hücresi İÇİNDEYSE hücre `min-w-0` + Badge'in `span`'ı `truncate` alır | `min-w-0` (ebeveyn hücre) |
| Tablo hücresi (içerik listeleri, Dil Yönetimi tablosu) | Sütun `min-width` yerine `w-full` + hücre içeriği `truncate` + `title` | `truncate` + native `title` |

**Reddedilen alternatif:** Otomatik font küçültme (`text-[10px]`'e düşürme) — okunabilirliği düşürür ve WCAG'a aykırı bir "gizli metin küçültme" pratiğidir, kullanılmaz. Genişleme sorunu **kısaltma değil, düzen esnekliğiyle** çözülür.

---

## 6. Admin Dil Yönetimi ekranı (`/admin/settings` → "Diller" sekmesi)

### 6.1 Yerleşim

Mevcut `settings/page.tsx`'teki `Tabs`/`activeTab` deseni (satır 113-120) genişletilir — yeni bir üst-seviye rota AÇILMAZ, mevcut Ayarlar sekme şeridine `"languages"` değeriyle bir sekme eklenir (`SectionHeader` deseni satır 91-111 birebir tekrar kullanılır, icon=`Languages`):

```tsx
<SectionHeader icon={Languages} title="Diller" description="Sitenizin desteklediği dilleri yönetin. Yeni dil eklemek deploy gerektirmez." />
```

### 6.2 Liste

Mevcut `Table`/`TableHeader`/`TableRow` (`frontend/src/components/ui/table.tsx`) kullanılır — yeni bir liste bileşeni İCAT EDİLMEZ:

| Sütun | İçerik |
|---|---|
| (sürükle tutamağı) | `GripVertical` ikonu, `sortOrder` için sürükle-bırak — yoksa yukarı/aşağı ok butonları (`icon-xs`) fallback |
| Dil | `{nativeLabel}` kalın + altında `text-foreground/60 text-xs` `{code} · {label}` (panel dilindeki ad) — bayrak YOK (§4) |
| Durum | `Badge tone={enabled ? "success" : "neutral"} size="sm"` → "Etkin"/"Devre dışı" |
| Varsayılan | Varsayılansa `Badge tone="primary" solid size="sm"` → "Varsayılan"; değilse `Button variant="ghost" size="sm"` → "Varsayılan yap" (§6.3) |
| Çevrilmiş içerik | `{translatedContentCount} içerik` `text-xs text-foreground/60 tabular-nums` |
| İşlemler | `DropdownMenu` (⋮) → Düzenle / Etkin&Devre Dışı Bırak (Switch veya menü öğesi) / Sil |

Varsayılan dilin satırında "Sil" ve "Devre dışı bırak" menü öğeleri **gizlenmez, `disabled` + `title="Varsayılan dil silinemez/devre dışı bırakılamaz"`** olarak görünür kalır — kullanıcı neden yapamadığını görür, "eylem sanki hiç yokmuş" gibi kafa karışıklığı YARATILMAZ (mevcut projede menü öğelerinin `disabled` durumu zaten `DropdownMenuItem`'da destekleniyor).

"Dil Ekle" birincil buton, tablonun üstünde sağa yaslı: `Button variant="default" size="sm"` + `Plus` ikonu → "Dil Ekle" — açılan `Dialog` alanları: Kod (immutable ipucu: "Oluşturulduktan sonra değiştirilemez"), Etiket, Kendi Dilindeki Ad (`nativeLabel`), hreflang override (opsiyonel, "Gelişmiş" olarak katlanabilir/`Accordion`).

### 6.3 Yüksek riskli işlem #1 — Varsayılan dili değiştirme

Mevcut `ConfirmDialog` (`frontend/src/components/ui/confirm-dialog.tsx`) **yeni bir `tone` seçeneğiyle genişletilir** — `destructive: boolean` yerine `tone?: "default" | "warning" | "danger"` (geriye dönük `destructive` prop'u `tone="danger"`ın takma adı olarak KORUNUR, mevcut çağrı yerleri KIRILMAZ):

```tsx
{tone === "warning" && (
  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
    <AlertTriangle className="h-4 w-4" />
  </span>
)}
```

`Button`'a bu yeni tonu taşıyacak bir varyant eklenir (`buttonVariants`, mevcut `destructive` varyantının BİREBİR aynı deseniyle, sadece token değişir):

```diff
 destructive:
   "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
+warning:
+  "bg-warning/10 text-warning hover:bg-warning/20 focus-visible:border-warning/40 focus-visible:ring-warning/20 dark:bg-warning/20 dark:hover:bg-warning/30 dark:focus-visible:ring-warning/40",
```

Diyalog içeriği:

```
İkon: AlertTriangle (bg-warning/10 text-warning)
Başlık: "'{nativeLabel}' dilini varsayılan yap"
Açıklama: "Bu işlem site URL yapısını değiştirir: '{currentDefaultNativeLabel}' içerik artık
  /{currentDefaultCode}/... altında yayınlanır, '{nativeLabel}' ise prefix'siz hale gelir.
  Mevcut bağlantılar 301 ile yönlendirilir ama arama motoru sıralaması geçici olarak etkilenebilir."
Onay butonu: variant="warning", "Varsayılanı Değiştir"
İptal butonu: variant="outline", "Vazgeç"
```

Type-to-confirm GEREKMEZ (geri alınabilir bir işlem — tekrar eski dile "varsayılan yap" ile dönülebilir), ama uyarı tonunun (kırmızı DEĞİL, amber) `destructive`'ten görsel olarak ayrışması ZORUNLUDUR — kullanıcı "silme kadar tehlikeli değil ama önemli" ayrımını renkten okuyabilmeli.

### 6.4 Yüksek riskli işlem #2 — Dil silme (en ciddi eylem)

**Karar: tek kademeli DEĞİL, `translatedContentCount`'a göre iki kademeli diyalog.**

**Kademe A — `translatedContentCount === 0`:** standart `ConfirmDialog tone="danger"` (mevcut `destructive` görünümü), açıklama: `"'{nativeLabel}' dili silinecek. Bu dilde yayınlanmış çeviri bulunmuyor, veri kaybı riski yok."`

**Kademe B — `translatedContentCount > 0`:** genişletilmiş diyalog, `ConfirmDialog`'un ÜZERİNE inşa edilen özel bir `DeleteLocaleDialog`:

```tsx
<DialogContent>
  <DialogHeader>
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger/10 text-danger">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <DialogTitle>"{nativeLabel}" dilini kalıcı olarak sil</DialogTitle>
    </div>
  </DialogHeader>

  <Alert variant="error">
    <ul className="list-disc space-y-1 pl-4">
      <li><strong>{translatedContentCount} çevrilmiş içerik</strong> kalıcı olarak silinecek.</li>
      <li><code>/{code}/...</code> altındaki tüm URL'ler 404 dönmeye başlayacak.</li>
      <li>Bu işlem <strong>geri alınamaz</strong>.</li>
    </ul>
  </Alert>

  <Field id="confirm-code" label={`Onaylamak için dil kodunu yazın: "${code}"`}>
    {(inputProps) => (
      <Input {...inputProps} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} autoComplete="off" />
    )}
  </Field>

  <DialogFooter>
    <Button variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
    <Button variant="destructive" disabled={confirmInput.trim().toLowerCase() !== code} onClick={onConfirm}>
      Dili Kalıcı Olarak Sil
    </Button>
  </DialogFooter>
</DialogContent>
```

Gerekçe: mimari doküman bu işlemi açıkça "yüksek riskli, tüm site URL'lerini etkiliyor" olarak işaretliyor (§9, §11 açık riskler tablosu — "Varsayılan dil değişimi tüm URL'leri değiştirir / Yüksek"). Standart tek-tık `ConfirmDialog` bu ciddiyeti taşımaz; **kod yaz-ve-onayla** deseni (GitHub'ın repo silme diyaloğuyla aynı aile) kullanıcının "yanlışlıkla Enter'a basma" riskini ortadan kaldırır. Bu, projede BENZERİ olmayan YENİ bir diyalog türüdür ama gerekçesi (etki büyüklüğü) mimari dokümanda doğrudan yazılı olduğu için haklıdır — `ConfirmDialog`'un genel kullanım alanı (basit silmeler) bu düzeyde ağırlaştırılmaz, yalnızca dil silme bu özel bileşeni kullanır.

**Etkin/devre dışı bırakma (Switch, dialog GEREKMEZ):** mimari doküman yalnızca "varsayılan yapma" ve "silme"yi onay diyaloğu gerektiren işlemler olarak işaretliyor (§9 frontend-agent madde 11) — devre dışı bırakma tersine çevrilebilir (içerik korunur, yalnızca public route'lardan kalkar) olduğu için `Switch` bileşeniyle anında uygulanır, ardından `sonner` toast ile bilgilendirilir: `"İngilizce devre dışı bırakıldı — çeviriler korundu, /en/... rotaları artık erişilemez."`

---

## Kontrol Listesi (frontend-agent)

- [ ] Site header'a `Globe` ikonlu, `nativeLabel` etiketli dil değiştirici eklenir (§1.1); `.site-scope` dışı, mevcut header nötr chrome tonlarını kullanır.
- [ ] `topbar.tsx`: `LOCALE_OPTIONS`'tan bayrak emojisi kaldırılır (`🇹🇷 TR` → `TR`, `🇬🇧 EN` → `EN`), `Languages` ikonu KORUNUR, seçili öğeye `Check` ikonu (`ml-auto`) eklenir — hem masaüstü hem mobil menü satırı (§1.2).
- [ ] Paylaşılan `LocaleTabs` bileşeni oluşturulur (`TabsList variant="line" className="flex-nowrap overflow-x-auto"`, her `TabsTrigger` `min-w-16 shrink-0`); 4 editör (`pages`, `blog`, `products`, `portfolio`) kendi yerel `LocaleToggle` kopyalarını bununla değiştirir; dil listesi `GET /admin/locales`'ten dinamik (§2.1-2.2).
- [ ] `LocaleStatusIcon` (`CheckCircle2`/`CircleDashed`/`Circle`, sırasıyla `text-success`/`text-warning`/`text-foreground/30`) varsayılan olmayan her sekmede render edilir; varsayılan dil sekmesi hiçbir zaman durum ikonu taşımaz (§2.3).
- [ ] `FallbackBadge` + input'a koşullu `border-dashed border-foreground/25 bg-muted/30` eklenir; "boş" ile "fallback" durumları görsel olarak birbirinden ayrık tutulur (§3).
- [ ] Sidebar nav etiketleri `min-w-0 flex-1 truncate` + `title={label}` alır (uzun EN/DE çevirilerinde taşma önlenir, §5); hiçbir çevrilebilir metin konteynerine sabit `w-*` piksel genişlik verilmez.
- [ ] `ConfirmDialog`e `tone?: "default" | "warning" | "danger"` prop'u eklenir (`destructive` eski davranışın takma adı olarak KORUNUR); `buttonVariants`e `warning` varyantı eklenir (`destructive` varyantının birebir aynı deseni, `--warning` token'ıyla) (§6.3).
- [ ] `/admin/settings`e "Diller" sekmesi eklenir (`icon={Languages}`, mevcut `SectionHeader`/`Table` desenleri kullanılır) — liste, "Varsayılan yap" (`tone="warning"` ConfirmDialog) ve "Sil" (Kademe A/B, §6.4) akışlarını uygular.
- [ ] `DeleteLocaleDialog` (yalnızca `translatedContentCount > 0` iken): kod yaz-ve-onayla deseni, `Alert variant="error"` içinde etki listesi, `Button variant="destructive"` girilen kod eşleşene kadar `disabled`.
- [ ] Hiçbir yüzeyde (site header, admin topbar, çeviri sekmeleri, Dil Yönetimi listesi) bayrak emoji/ikonu KULLANILMAZ (§4).
