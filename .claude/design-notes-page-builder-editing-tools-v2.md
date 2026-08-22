# Tasarım Notları v2: Konteyner Kontrol Çubuğu Kompaktlığı, İç İçe Konteyner Ekleme, Gelişmiş Görünüm Efekti Paneli

Ajan: **ui-designer** · Durum: **v2 (spesifikasyon, implementasyon bekliyor)** · Sahibi: ui-designer
Kapsam: (1) `ContainerCard` kontrol çubuğunun (`builder-canvas.tsx` ~509-583) responsive/kompakt hale getirilmesi, (2) iç içe (nested/child) konteyner ekleme — `AddContentMenu` + kontrol çubuğu, (3) `RevealEffectControl`'ün (`builder-canvas.tsx` ~179-230) profesyonel bir panele dönüştürülmesi. Bu doküman kod İÇERMEZ (yalnızca yapıyı netleştiren kısa iskelet parçacıkları) — `frontend-agent` bunu okuyup `builder-canvas.tsx`, `add-content-menu.tsx`, `container-inserter.tsx`, `globals.css`, `site/blocks/scroll-reveal.tsx`, `lib/page-builder/types.ts`'i buna göre kodlar.

Bağlayıcı kaynaklar: `.claude/design-notes-page-builder-editing-tools.md` (v1 — Cihaz Önizleme/Şekilli Ayırıcı/Reveal'in İLK sürümü, DOKUNULMADI), `.claude/design-notes-page-builder-container-ui.md` (`LayoutPresetTile`/karo deseni), `.claude/design-notes-page-builder-dynamic-container-insertion.md` (`onInsertContainer` sözleşmesi). Veri alanı adları/genişletmeleri (`RevealDuration`, `once`, yeni `RevealEffect` üyeleri) birer **öneridir** — nihai şema kararı **architect**e aittir; ui-designer yalnızca görünüm/etkileşim katmanını bağlar.

---

## 0. Görsel yön (değişmiyor)

Proje **Minimal/Flat** idiomunu sürdürüyor. Yeni renk tokenı YOK, yeni kontrol primitifi İCAT EDİLMEZ (`Button`, `Popover`, `DropdownMenu`/`DropdownMenuSub`, `Select`, `Switch`, `Badge` — hepsi mevcut). Tek ikon kaynağı `lucide-react`; bu oturumda kullanılan TÜM yeni ikonlar `frontend/node_modules/lucide-react/dist/lucide-react.d.ts` içinde doğrulandı (bkz. §5).

---

## 1. Kompakt Kontrol Çubuğu (`ContainerCard`)

### 1.1 Taşmanın kök nedeni

Sağ buton grubu `<div className="flex shrink-0 items-center gap-1">` — `shrink-0` VE iç `flex-wrap` YOK. Üst kapsayıcı (`justify-between`) tek bir flex-item olarak bu grubu taşıdığı için, dar sütunlarda grup kendi genişliğini KORUYUP kapsayıcının dışına taşıyor (Sil'in dışarı çıkması budur). Çözüm yalnızca boyut küçültmek DEĞİL — buton SAYISINI 5'e indirmek (§1.3).

### 1.2 KESİN KARAR — görünür sıra, boyut, aralık

Görünür buton sayısı **8-9 → 5**e iner, hepsi `size="icon-xs"` (mevcut varyant, `size-6` = 24px — `add-content-menu.tsx`teki arama-temizleme butonuyla AYNI, yeni bir boyut İCAT EDİLMEDİ). Sağ grubun sınıfı `gap-1` → `gap-0.5` olur:

```
[Settings2 — Ayarlar] [Sparkles — Efekt] [FolderPlus — Alt Konteyner Ekle (YENİ, §2.2b)] [Ellipsis — Daha Fazla] [Trash2 — Sil]
```

```tsx
<div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
  {/* Settings2, RevealEffectControl (Sparkles), AddChildContainerControl (FolderPlus, §2.2b),
      ContainerMoreMenu (Ellipsis, §1.3), Trash2 — hepsi size="icon-xs" */}
</div>
```

5×24px + 4×2px(gap) = **128px** minimum — en dar (4'lü sütun) düzende bile taşma riski pratik olarak ortadan kalkar (eski hesap: 8-9×28px + gap ≈ 260px+). `icon-sm` (28px) yerine `icon-xs` (24px) seçimi bilinçli: kontrol çubuğu zaten ince bir şerit (`py-1`), 5 butona düştükten sonra bile ekstra küçültme "Vercel/Linear" tarzı sıkı bir üst-bar hissi verir.

### 1.3 "•••" Daha Fazla menüsü — `DropdownMenu`, ikon `Ellipsis`

**KESİN KARAR:** Trigger `variant="ghost" size="icon-xs"` `aria-label`/`title="Daha fazla işlem"`, ikon `Ellipsis` (doğrulandı, §5 — YATAY üç nokta, "•••" isteğiyle birebir örtüşüyor; `EllipsisVertical` KULLANILMAZ, yatay bir kontrol çubuğunda yatay ikon daha tutarlı okunur).

İçerik (`DropdownMenuContent align="end" className="w-56"`), gruplar arası `DropdownMenuSeparator`:

```
Konteyneri Çoğalt        (Copy)
Yukarı Taşı              (ArrowUp, disabled=index===0)
Aşağı Taşı               (ArrowDown, disabled=index===total-1)
──────────────
Alta Konteyner Ekle       (LayoutTemplate) → DropdownMenuSub, içinde LayoutPresetPopoverGrid (7 preset, disabled={atMaxDepth})
[yalnızca isBare] Üst Konteynere Taşı  (ArrowUpToLine)
──────────────
Konteyneri Kaldır         (Unlink2 — mevcut LayoutMenu mode="unwrap" eylemi buraya TAŞINIR)
```

**Not (mevcut "Alta yeni konteyner ekle" butonunun akıbeti):** Kullanıcı isteğinin §1'de saydığı ••• adayları listesinde (Kopyala, Yukarı, Aşağı, gelecekte HTML dışa aktar) bu buton açıkça YOK, ama görünür 5'li sırada da yer YOK (o slot artık YENİ child-insert butonuna ait, §2.2b). Eleme yoluyla: bu buton da ••• içine taşınır — gerekçe: (a) aynı sibling-ekleme işlevine kanvasta zaten `BetweenContainersInserter` (satırlar arası "+", hover'da beliren) üzerinden erişilebiliyor, kontrol çubuğundaki kopyası ikincil bir kısayoldur; (b) `DropdownMenuSub` + `LayoutPresetPopoverGrid` kombinasyonu zaten `AddContentMenu`de (§2.2a) aynı desenle kanıtlanıyor, yeni bir etkileşim biçimi İCAT EDİLMİYOR.

`DropdownMenuSub` alt-içeriği (mevcut popover içeriğiyle BİREBİR aynı, yalnızca kabuk `Popover`→`DropdownMenuSub` değişiyor):

```tsx
<DropdownMenuSub>
  <DropdownMenuSubTrigger>
    <LayoutTemplate className="h-4 w-4 text-foreground/50" />
    Alta Konteyner Ekle
  </DropdownMenuSubTrigger>
  <DropdownMenuSubContent className="w-80">
    <LayoutPresetPopoverGrid
      disabled={atMaxDepth}
      disabledReason="Maksimum iç içe geçme derinliğine ulaşıldı (4)"
      onSelect={(preset) => ctx.onInsertContainer(parentId, index + 1, preset)}
    />
  </DropdownMenuSubContent>
</DropdownMenuSub>
```

"Konteyneri Kaldır" (`Unlink2`, `onSelect={() => ctx.onUnwrap(container.id)}`) — mevcut `LayoutMenu mode="unwrap"` tek-öğeli dropdown'ı ARTIK ContainerCard'da kullanılmaz (o bileşen `ContentBlockCard`'ın `mode="wrap"` kullanımı için kalır, DOKUNULMAZ — kapsam dışı).

### 1.4 a11y — dokunma hedefi

Görünür sıradaki 5 buton `icon-xs` (24×24px, WCAG AA'nın önerdiği 44×44'ün altında) — ancak bu proje zaten `icon-xs`'i başka bir yerde (arama temizleme) aynı boyutta kullanıyor ve page-builder masaüstü-öncelikli bir admin aracı (mouse-driven). **Telafi edici karar:** ••• menüsünün İÇİNDEKİ öğeler `DropdownMenuItem` — bunların dokunma alanı 24px'lik bir kareyle SINIRLI DEĞİL, menü genişliği kadar (`w-56` = 224px) YATAY + `py-1` dikey alan kaplar, yani gerçek tıklanabilir yüzey çok daha büyük. Sonuç: yalnızca en sık kullanılan/birincil 5 aksiyon küçük ikon-kare formatında kalır, ikincil aksiyonlar zaten daha geniş liste satırlarına taşınmış olur — net dokunma erişilebilirliği KÖTÜLEŞMEZ, tam tersi çoğu buton için İYİLEŞİR.

### 1.5 Sil butonu — küçük iyileştirme (opsiyonel, önerilir)

Sıra kısaldığı için Sil artık tek başına en sağda daha görünür; `hover:text-destructive` sınıfı eklenmesi önerilir (zorunlu değil, mevcut `variant="ghost"` KORUNUR — `destructive` varyantına geçmek gerekmiyor, yalnızca hover tonu farklılaşsın).

---

## 2. İç İçe Konteyner Ekleme (Nested Containers)

### 2.1 Genel prensip — CHILD ekleme, SIBLING eklemeden AYRI

Mevcut `ctx.onInsertContainer(parentId, index, preset)` imzası DEĞİŞMEZ. Fark yalnızca ÇAĞRI PARAMETRELERİNDE:

- **Sibling** (mevcut "Alta Konteyner Ekle", artık ••• içinde, §1.3): `onInsertContainer(parentId, index + 1, preset)` — YENİ konteyner, TIKLANAN konteynerin KENDİ ebeveyninin çocuğu olarak, hemen ardına eklenir.
- **Child** (YENİ, §2.2a/§2.2b): `onInsertContainer(containerId, container.children.length, preset)` — YENİ konteyner, TIKLANAN konteynerin KENDİ `children` dizisinin SONUNA eklenir. `containerId` burada `toContainerId(container.id)` (`ContainerCard` içinde zaten hesaplı).

Derinlik guard'ı `insertContainer` fonksiyonunun İÇİNDE zaten var (`parentDepth + subtreeDepth(newContainer) > MAX_CONTAINER_DEPTH` → no-op) — UI tarafı yalnızca `disabled`/`disabledReason` ile ÖNCEDEN bilgilendirme yapar, ekstra bir guard YAZILMAZ.

### 2.2a `AddContentMenu` — menünün EN BAŞINA "İç Konteyner / Bölüm Ekle" satırı

**KESİN KARAR:** `DropdownMenuContent`in en üstüne (arama input'undan ÖNCE), `DropdownMenuSub` olarak tek bir "pinned" satır eklenir, altında `DropdownMenuSeparator`:

```tsx
<DropdownMenuContent align="center" className="w-80">
  <DropdownMenuSub>
    <DropdownMenuSubTrigger className="bg-surface-muted/40 font-medium text-foreground hover:bg-primary/10">
      <FolderPlus className="h-4 w-4 text-primary" />
      İç Konteyner / Bölüm Ekle
    </DropdownMenuSubTrigger>
    <DropdownMenuSubContent className="w-80">
      <LayoutPresetPopoverGrid
        disabled={atMaxDepth}
        disabledReason="Maksimum iç içe geçme derinliğine ulaşıldı (4)"
        onSelect={(preset) => onInsertContainer(preset)}
      />
    </DropdownMenuSubContent>
  </DropdownMenuSub>
  <DropdownMenuSeparator />
  <div className="space-y-2 p-1 pb-0">{/* mevcut arama + kategori satırı, DEĞİŞMEDEN */}</div>
  {/* mevcut 2 sütunlu blok grid'i, DEĞİŞMEDEN */}
</DropdownMenuContent>
```

Görsel ayrım (`bg-surface-muted/40` + `font-medium` + `text-primary` ikon) satırı bir "pinned aksiyon" olarak, aşağıdaki 2-sütunlu ikon-üstte/etiket-altta blok karolarından KASITLI OLARAK farklı gösterir — kullanıcı bunun bir "içerik bloğu" değil, yapısal bir eylem olduğunu tek bakışta ayırt eder.

**Bileşen sözleşmesi değişikliği (frontend-agent'a not):** `AddContentMenu` bugün yalnızca `onAdd`/`disabled`/`variant` alıyor; bu özellik için EK olarak `atMaxDepth: boolean` VE `onInsertContainer: (preset: LayoutPreset) => void` prop'ları gerekir (çağıran taraf, `ContainerCard`/`EmptyContainerDropZone` içinde zaten hesaplı `atMaxDepth` değerini ve `ctx.onInsertContainer(containerId, children.length, preset)` closure'ını geçirir). `EmptyContainerDropZone` de (boş konteyner içi "+ Eleman Ekle") AYNI iki prop'u alıp `AddContentMenu`e iletir — boş bir konteynerin içine DE doğrudan alt-konteyner eklenebilmeli, tutarlılık için.

### 2.2b Kontrol çubuğu — YENİ "Alt Konteyner Ekle" butonu (§1.2'deki 5'li sıranın 3. öğesi)

**KESİN KARAR:** `Popover` (DropdownMenu DEĞİL — bu tek başına bir buton, ••• menüsünün parçası değil), ikon **`FolderPlus`** (aynı ikon §2.2a ile — aynı kavramsal eylem: "bu konteynerin İÇİNE yeni bir alt konteyner ekle", iki giriş noktası aynı ikonla tutarlı tanınır). `LayoutTemplate` (sibling-ekleme ikonu) ile görsel olarak KESİN AYRIŞIR — `FolderPlus` bir "içine ekleme/klasörleme" metaforu taşırken `LayoutTemplate` bir "şablon/satır" metaforu taşır.

```tsx
<Popover>
  <PopoverTrigger
    render={<Button type="button" variant="ghost" size="icon-xs" aria-label="İç konteyner ekle" title="İç konteyner ekle" />}
  >
    <FolderPlus className="h-3.5 w-3.5" />
  </PopoverTrigger>
  <PopoverContent align="start" className="w-56">
    <LayoutPresetPopoverGrid
      presets={LAYOUT_PRESETS.filter((p) => p.id === "100" || p.id === "50-50")}
      columns={2}
      disabled={childInsertDisabled}
      disabledReason={childInsertDisabledReason}
      onSelect={(preset) => ctx.onInsertContainer(containerId, container.children.length, preset)}
    />
  </PopoverContent>
</Popover>
```

Yalnızca **2 seçenek** (Tekli Konteyner / 2'li Sütun — kullanıcı isteği net) — `LayoutPresetPopoverGrid`e opsiyonel `presets`/`columns` prop'ları eklenmesi önerilir (`presets` verilmezse mevcut 7'li `LAYOUT_PRESETS` + `columns` verilmezse mevcut `grid-cols-4` — geriye dönük DAVRANIŞ DEĞİŞMEZ, sibling-insert çağrıları ETKİLENMEZ). Popover genişliği `w-56` (224px) — 2 karo `grid-cols-2 gap-2` için `w-80`den daha uygun, gereksiz boş alan bırakmaz.

`childInsertDisabled`/`childInsertDisabledReason` — `ContainerCard` içinde ZATEN hesaplı (`atMaxChildren || atMaxDepth`, bkz. mevcut kod ~452-457), yeniden hesaplanmaz, AYNEN kullanılır.

### 2.3 İkon tablosu (bu bölüm özeti)

| Eylem | İkon | Konum |
|---|---|---|
| İç konteyner ekle (menü satırı) | `FolderPlus` | `AddContentMenu` en üstü |
| İç konteyner ekle (buton) | `FolderPlus` | Kontrol çubuğu, 5'li sıranın 3. öğesi |
| Alta konteyner ekle (sibling, TAŞINDI) | `LayoutTemplate` | ••• menüsü, `DropdownMenuSub` |
| Daha Fazla tetikleyici | `Ellipsis` | Kontrol çubuğu, 5'li sıranın 4. öğesi |

---

## 3. Gelişmiş Görünüm Efekti Paneli (`RevealEffectControl`)

### 3.1 Popover genişliği — `w-64` → `w-80`

**KESİN KARAR:** `w-80` (320px). Gerekçe: 4×2 ikon-karo grid'i (§3.2) + slider (§3.3) + `SegmentedToggle` (§3.4) + `Switch` satırı (§3.5) + önizleme kutusu (§3.6) — v1'in `w-64`'ü (256px) bu kadar içeriğe göre sıkışık kalır; `w-80` proje genelinde zaten kullanılan İKİNCİ standart popover genişliği (`LayoutPresetPopoverGrid`in kendi popover'ları, `AddContentMenu`), yeni bir ölçü İCAT EDİLMİYOR.

### 3.2 Efekt seçimi — KESİN KARAR: `Select` → 4×2 ikon-karo grid (`ShapeDividerTile` ailesi)

v1'de `Select` tercih edilmişti çünkü 5 seçeneğin TR etiketleri uzundu ve `SegmentedToggle` (salt metin/ikon) `w-64`i aşardı. Şimdi durum FARKLI: 8 seçenek eklendi AMA her biri yön/hareket bildiren, lucide'de GERÇEK KARŞILIĞI olan somut ikonlarla temsil edilebiliyor (§2.3'teki "şekil ayırıcı" probleminin AKSİNE — orada hiçbir lucide ikonu bir "dalga"yı temsil edemiyordu, burada `MoveUp`/`MoveLeft` gibi ikonlar efekti doğrudan ve doğru temsil ediyor). **KESİN KARAR:** `container-inserter.tsx::LayoutPresetTile` / v1 `ShapeDividerTile` ile AYNI karo kabuğu, `grid-cols-4 gap-1.5` (4×2 = 8 karo), gerçek `lucide-react` ikonu + kısa TR etiket:

| Sıra | `RevealEffect` | İkon | Kısa etiket (karo altı) | Uzun etiket (`title`/`aria-label`) |
|---|---|---|---|---|
| 1 | `none` | `Ban` | Yok | Yok |
| 2 | `fade-in` | `Eye` | Belirme | Belirme (Fade In) |
| 3 | `fade-up` | `MoveUp` | Yukarı | Yukarı Belirme (Fade Up) |
| 4 | `fade-down` **YENİ** | `MoveDown` | Aşağı | Aşağı Belirme (Fade Down) |
| 5 | `slide-left` | `MoveLeft` | Soldan | Soldan Kayma (Slide Left) |
| 6 | `slide-right` **YENİ** | `MoveRight` | Sağdan | Sağdan Kayma (Slide Right) |
| 7 | `zoom-in` | `ZoomIn` | Yakınlaş | Yakınlaşma (Zoom In) |
| 8 | `flip-up` **YENİ** | `FlipVertical2` | Çevir | Çevirerek Belirme (Flip Up) |

Satır 1 = opacity ailesi (Yok/Belirme/Yukarı/Aşağı), satır 2 = yön/dönüşüm ailesi (Sol/Sağ/Yakınlaş/Çevir) — kavramsal gruplama, ekstra bir başlık/ayraç GEREKMEZ (4'lü grid satırı zaten görsel bir blok oluşturuyor).

```tsx
<div className="grid grid-cols-4 gap-1.5">
  {REVEAL_TILES.map(({ value, Icon, shortLabel, longLabel }) => (
    <button
      key={value}
      type="button"
      aria-label={longLabel}
      title={longLabel}
      aria-pressed={effect === value}
      data-active={effect === value}
      onClick={() => setEffect(value)}
      className="flex flex-col items-center gap-1.5 rounded-lg border border-border/60 bg-surface-muted p-2
                 transition-colors hover:border-primary/50 hover:bg-primary/5 focus-visible:border-ring
                 focus-visible:ring-3 focus-visible:ring-ring/50 outline-none
                 data-[active=true]:border-primary data-[active=true]:bg-primary/10"
    >
      <Icon className="h-4 w-4 text-foreground/60 group-data-[active=true]:text-primary" />
      <span className="text-[11px] font-medium text-foreground/70">{shortLabel}</span>
    </button>
  ))}
</div>
```

`Field`/`Select` importları bu kontrolden KALKAR (artık kullanılmıyor) — `builder-canvas.tsx`teki `REVEAL_EFFECT_LABEL` sabiti kalır ama artık karoların `title`/`aria-label`'ı için "uzun etiket" kaynağı olarak kullanılır (amaç değişir, veri YAPISI aynı kalabilir).

### 3.3 Gecikme — KESİN KARAR: `SegmentedToggle` (5 sabit değer) → native `<input type="range">` slider

0–1000ms, 100ms adım (11 durak). `SegmentedToggle` 11 seçenekte okunaksız kırılır (v1'in 5 değerlik gerekçesi artık geçerli DEĞİL). Mevcut divider-height slider deseniyle (v1 §2.5) BİREBİR aynı iskelet:

```tsx
<div className="space-y-1.5">
  <label htmlFor="reveal-delay" className="block text-xs font-medium text-foreground/70">
    Gecikme ({delayMs}ms)
  </label>
  <input
    type="range"
    id="reveal-delay"
    min={0}
    max={1000}
    step={100}
    list="reveal-delay-ticks"
    value={delayMs}
    onChange={(e) => setDelay(Number(e.target.value))}
    className="w-full accent-primary"
  />
  <datalist id="reveal-delay-ticks">
    {[0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000].map((ms) => <option key={ms} value={ms} />)}
  </datalist>
</div>
```

`<datalist>` — native, sıfır-JS bir tık/durak (tick mark) ipucu; yeni bir kütüphane GEREKTİRMEZ, tarayıcı desteği evrensel (görsel çentik render'ı tarayıcıya göre değişebilir, dekoratif bir gelişmedir, işlevsel değil — `list` olmadan da slider tamamen çalışır).

### 3.4 Süre (Duration) — YENİ alan, `SegmentedToggle` (aynı aile, v1'in gecikme kontrolüyle AYNI bileşen)

```tsx
<div className="space-y-1.5">
  <p className="text-xs font-medium text-foreground/70">Süre</p>
  <SegmentedToggle
    value={String(durationMs)}
    options={[
      { value: "300", label: "Hızlı" },
      { value: "600", label: "Normal" },
      { value: "1000", label: "Yavaş" },
    ]}
    onChange={(v) => setDuration(Number(v) as RevealDuration)}
  />
</div>
```

Varsayılan `600` (Normal) — bugünkü sabit CSS değeriyle (`0.6s`) BİREBİR aynı, mevcut kayıtlı efektlerin görünümü SESSİZCE DEĞİŞMEZ (geriye dönük uyumluluk).

### 3.5 Tekrarlama — KESİN KARAR: `Switch` (2'li `SegmentedToggle` DEĞİL)

Bu net bir boole (`once: true/false`) — v1'in "Ters çevir" (`flip`) alanı da AYNI `Switch` deseniyle çözülmüştü (§2.6 v1), burada da tutarlılık için `Switch` tercih edilir; 2'li `SegmentedToggle` (İKİ metin butonu) burada gereksiz bir görsel ağırlık ekler.

```tsx
<div className="flex items-center justify-between">
  <label htmlFor="reveal-repeat" className="text-xs font-medium text-foreground/70">
    Her görünüşte tekrarla
  </label>
  <Switch id="reveal-repeat" checked={!once} onCheckedChange={(checked) => setOnce(!checked)} />
</div>
```

Varsayılan `once: true` (switch KAPALI = "Yalnızca bir kez", bugünkü TEK-SEFERLİK davranışla BİREBİR aynı — geriye dönük uyumluluk: `reveal` alanı hiç `once` taşımıyorsa `once ?? true` varsayılır).

### 3.6 Canlı Önizleme — KESİN KARAR: parametre değiştikçe OTOMATİK tetikle + "Yeniden Oynat" butonu

Yalnızca bir "▶ Önizle" butonuna bağlı MANUEL tetikleme her parametre değişiminde ekstra bir tıklama gerektirir — doğrudan/anlık geri bildirim (Stripe/Linear kalitesindeki araçların ortak özelliği) daha iyi bir deneyim. **KESİN KARAR:** `effect`/`delayMs`/`durationMs` her değiştiğinde önizleme OTOMATİK yeniden oynar; AYRICA parametre DEĞİŞMEDEN tekrar izlemek isteyen kullanıcı için küçük bir "Yeniden Oynat" ikon-butonu (`RotateCcw`, `size="icon-xs"`) sağ üstte durur.

```tsx
<div className="space-y-1.5">
  <div className="flex items-center justify-between">
    <p className="text-xs font-medium text-foreground/70">Önizleme</p>
    <Button type="button" variant="ghost" size="icon-xs" aria-label="Yeniden oynat" title="Yeniden oynat" onClick={replay}>
      <RotateCcw className="h-3.5 w-3.5" />
    </Button>
  </div>
  <div className="flex h-16 items-center justify-center rounded-md border border-dashed border-border/60 bg-surface-muted/30">
    <div
      key={previewKey}
      className={cn(`pb-reveal-${effect}`, previewVisible && "pb-revealed")}
      style={{ transitionDelay: `${delayMs}ms`, transitionDuration: `${durationMs}ms` }}
    >
      <div className="h-8 w-20 rounded-md border border-primary/40 bg-primary/20" />
    </div>
  </div>
</div>
```

Uygulama notu (frontend-agent): `previewKey` (`effect`/`delayMs`/`durationMs` değiştiğinde VEYA "Yeniden Oynat" tıklanınca artan bir sayaç) değiştiğinde önizleme kutusu yeniden mount olur (başlangıç/gizli duruma döner), ardından bir `requestAnimationFrame`/kısa `setTimeout` ile `previewVisible=true` yapılarak `.pb-revealed` sınıfı eklenir — `scroll-reveal.tsx`teki IntersectionObserver mantığına PARALEL ama scroll'dan BAĞIMSIZ, yalnızca ADMIN popover'ının kendi yerel mini-tetikleyicisi (`site/blocks/scroll-reveal.tsx`in KENDİSİ DEĞİŞMEZ). `effect === "none"` iken önizleme kutusu "Önizlenecek efekt yok" gibi nötr bir metin gösterir (boş bırakılmaz).

### 3.7 CSS sınıf isimlendirmesi — 3 yeni efekt + süre mekanizması değişikliği

**İsimlendirme (frontend-agent `globals.css`e ekler):**

```css
.pb-reveal-fade-down { transform: translateY(-24px); }   /* fade-up'ın AYNASI: +24px yerine -24px */
.pb-reveal-slide-right { transform: translateX(40px); }  /* slide-left'in AYNASI: -40px yerine +40px */
.pb-reveal-flip-up {
  transform: perspective(600px) rotateX(-90deg);
  transform-origin: bottom;
}
```

Bu 3 sınıf, mevcut `.pb-reveal-fade-in, .pb-reveal-fade-up, .pb-reveal-slide-left, .pb-reveal-zoom-in` seçici listesine (başlangıç `opacity: 0` + `transition` tanımı) VE `.pb-revealed` bitiş-durumu seçici listesine (`opacity: 1; transform: none;`) EKLENİR — yeni bir kural bloğu değil, MEVCUT seçici zincirine katılım.

**Süre artık sabit DEĞİL (KIRICI DEĞİŞİKLİK, dikkat):** bugün `transition: opacity 0.6s ease, transform 0.6s ease;` CSS'te SABİT. §3.4 ile süre kullanıcı tarafından seçilebilir hale geldiği için, `delayMs`in bugün `scroll-reveal.tsx`te inline `style.transitionDelay` ile uygulanmasıyla AYNI desende, `durationMs` da inline `style.transitionDuration` olarak eklenir; CSS'teki sabit `0.6s` KALDIRILIR, yerine yalnızca `transition-property`/`timing-function` tanımlanır (süre HER ZAMAN inline'dan gelir, varsayılan `600ms` — mevcut kayıtlarda `durationMs` yoksa `?? 600` ile bugünkü görünüm KORUNUR).

### 3.8 Veri şekli — öneri (mimar onayı gerekir)

```ts
export type RevealEffect =
  | "none" | "fade-in" | "fade-up" | "fade-down" | "slide-left" | "slide-right" | "zoom-in" | "flip-up";
/** Kapalı küme KORUNUR (v1'deki gerekçeyle aynı) — serbest `number` DEĞİL. */
export type RevealDelay = 0 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000;
export type RevealDuration = 300 | 600 | 1000;

export interface RevealEffectSettings {
  effect: RevealEffect;
  delayMs: RevealDelay;
  /** Opsiyonel — yoksa `600` (bugünkü sabit CSS değeriyle BİREBİR aynı varsayılan). */
  durationMs?: RevealDuration;
  /** Opsiyonel — yoksa `true` (bugünkü TEK-SEFERLİK davranışla BİREBİR aynı varsayılan). */
  once?: boolean;
}
```

Bu GENİŞLETME geriye dönük UYUMLUDUR (yalnızca yeni OPSİYONEL alanlar + `RevealEffect`/`RevealDelay` birleşimlerine yeni üyeler eklenir, MEVCUT değerlerden hiçbiri KALDIRILMAZ) — yine de zod şeması `backend/pages.schemas.ts`te GÜNCELLENMESİ gerektiğinden mimar/backend-agent onayına TABİDİR.

### 3.9 Kart rozeti — kısa etiket tablosu güncellemesi

`REVEAL_SHORT_LABEL`e 3 satır eklenir (mevcut 4 satır DEĞİŞMEZ):

```ts
"fade-down": "Aşağı Belirme",
"slide-right": "Sağdan Kayma",
"flip-up": "Çevirerek Belirme",
```

Rozet FORMATI DEĞİŞMEZ (`"{ShortLabel} · {delayMs}ms"`) — `durationMs`/`once` rozette GÖSTERİLMEZ (bilinçli minimalizm: bunlar ince ayar alanları, yalnızca popover içinde görünür; rozeti kalabalıklaştırmak v1'in "sessizken sade" ilkesini bozar).

---

## 4. Bileşen/dosya eşleme tablosu (frontend-agent için hızlı referans)

| UI parçası | Mevcut primitif | Yeni yerel bileşen (isim önerisi) | Hedef dosya |
|---|---|---|---|
| Kontrol çubuğu görünür 5'li | `Button size="icon-xs"` (mevcut) | — | `builder-canvas.tsx::ContainerCard` |
| Daha Fazla menüsü | `DropdownMenu`/`DropdownMenuSub` (mevcut) | `ContainerMoreMenu` | `builder-canvas.tsx` (yerel) |
| İç konteyner ekle (buton) | `Popover` + `LayoutPresetPopoverGrid` (genişletilmiş) | `AddChildContainerControl` | `builder-canvas.tsx` (yerel) |
| İç konteyner ekle (menü satırı) | `DropdownMenuSub` + `LayoutPresetPopoverGrid` | — | `add-content-menu.tsx` |
| `LayoutPresetPopoverGrid` genişletmesi | mevcut, `presets`/`columns` opsiyonel prop eklenir | — | `container-inserter.tsx` |
| Efekt seçimi (ikon-karo) | `LayoutPresetTile`/`ShapeDividerTile` prensibi (yeni yerel) | `RevealEffectTile` | `builder-canvas.tsx` (yerel) |
| Gecikme slider | native `<input type="range">` + `<datalist>` | — | `builder-canvas.tsx` |
| Süre seçimi | `SegmentedToggle` (paylaşılan, `blocks/segmented-toggle.tsx`) | — | `builder-canvas.tsx` |
| Tekrarlama | `Switch` (mevcut) | — | `builder-canvas.tsx` |
| Canlı önizleme | `RotateCcw` ikonlu `Button` + yerel `pb-reveal-*` class toggling | `RevealPreviewBox` | `builder-canvas.tsx` (yerel) |

---

## 5. Doğrulanmış `lucide-react` ikon adları (bu oturumda `lucide-react.d.ts` içinde tek tek doğrulandı)

`Ellipsis`, `FolderPlus`, `Ban`, `Eye`, `MoveUp`, `MoveDown`, `MoveLeft`, `MoveRight`, `ZoomIn`, `FlipVertical2`, `RotateCcw`. (`EllipsisVertical`, `Rows3`, `PanelBottomOpen`, `ListPlus`, `Sparkle` de bu oturumda doğrulandı ama §1-3 kararlarında KULLANILMADI — yalnızca alternatif olarak not edilir; `MoreHorizontal`/`MoreVertical` bu lucide sürümünde MEVCUT DEĞİL, `Ellipsis`/`EllipsisVertical` onların yerini alan isimler.)

---

## 6. Kapsan dışı (netlik için)

Bu doküman şunları TANIMLAMAZ: `ContentBlockCard`in kontrol çubuğu (5 buton, taşma sorunu RAPORLANMADI — DOKUNULMAZ), `RevealEffectSettings`in nihai zod şeması (backend-agent + architect), `LayoutPresetPopoverGrid`in `presets`/`columns` prop'larının TAM TypeScript imzası (frontend-agent), `pb-reveal-flip-up`in 3B `perspective`/`rotateX` değerlerinin tüm tarayıcılarda GÖRSEL cilası (frontend-agent, gerekirse `backface-visibility: hidden` gibi ek CSS ekleyebilir — bu doküman yalnızca başlangıç/bitiş transform DEĞERLERİNİ önerir).
