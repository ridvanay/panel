# Tasarım Notları — Açık Tema Paleti + "Yeni Sayfa" Formu

Yazan: ui-designer. Kapsam: SADECE tasarım kararları/token değerleri. Kod implementasyonu frontend-agent'a aittir (bu dosyadaki hiçbir CSS/TSX bloğu doğrudan kopyala-yapıştır "patch" değil, "bu değeri/deseni kullan" talimatıdır).

---

## J) Açık tema — palet doğrulaması + Ayarlar sayfası tema-duyarlılığı

### J.1 — Palet doğrulaması: değişiklik GEREKMİYOR

Kök neden zaten doğru tespit edilmiş (media-query leak, `globals.css` satır 127-144). **Palet değişikliği gerekmiyor** — sorun renk değerlerinde değil, hangi mekanizmanın (`prefers-color-scheme` vs `.dark` class) hangi token'ları kontrol ettiğinde. Frontend-agent şunu yapmalı: satır 127-144'teki `@media (prefers-color-scheme: dark) { :root { ... } }` bloğunu ya tamamen kaldırsın ya da (genel/public site için bilinçli olarak korunuyorsa, satır 129-131'deki yorum bunu açıklıyor) admin paneli `:root` üzerinde hiçbir surface/primary/viz token'ını ezmeyecek şekilde kapsamını daraltsın (örn. `.admin-shell` içindeki her şeyi hariç tutacak bir seçici kullanamaz çünkü `:root` zaten en üst seviye — pratik çözüm: bu bloğu tamamen silip genel site için de `--surface`/`--primary` gibi token'ları `:root`'ta SABİT açık tema değerleriyle bırakmak, çünkü genel sitede zaten ayrı bir tema anahtarı yok ve `:root` varsayılanı zaten açık tema). Bu, benim kararım değil — architect/frontend-agent'ın kapsam kararı; ben sadece rengin kendisinin sorunsuz olduğunu onaylıyorum.

Doğrulanan çiftler (mevcut değerler, DEĞİŞTİRİLMEYECEK):

| Token çifti | Açık (`:root`) | Koyu (`.dark .admin-shell`) | Kontrast | Sonuç |
|---|---|---|---|---|
| `--surface` + `--foreground` üzeri metin | `#ffffff` + `oklch(0.145 0 0)` (~#252525) | `#12121a` + `#f2f2f7` | ~18.5:1 (açık) / ~16.8:1 (koyu) | AA geçer, bol marj var |
| `--surface-muted` + `--foreground` | `#f8fafc` + `oklch(0.145 0 0)` | `#1a1a24` + `#f2f2f7` | ~17.9:1 / ~15.9:1 | AA geçer |
| `--primary` + `--primary-foreground` | `#4f46e5` + `oklch(0.985 0 0)` (~#fbfbfb) | `--primary` runtime accent (`--accent-600`, vars.: fallback `#4f46e5`) + aynı foreground | ~8.6:1 (indigo-600/beyaz) | AA (ve AAA) geçer |
| `--danger` `/10` Badge kompoziti | `#b91c1c` üzerinde `bg-danger/10` (beyaza yakın kompozit) | `#f87171` | 4.98:1 (açık, satır 25 yorumunda doğrulanmış) / dark zaten 8-9:1 | AA geçer |
| `--success` `/10` Badge kompoziti | `#166534` | `#4ade80` | 6.00:1 (açık) | AA geçer |
| `--warning` `/10` Badge kompoziti | `#92400e` | `#fbbf24` | 6.08:1 (açık) | AA geçer |

**Sonuç: J.1 için aksiyon yok — sadece media-query kapsam/leak düzeltmesi (frontend-agent), token değerlerine dokunma.**

### J.2 — `admin/settings/page.tsx` bento estetiği — KARAR: Seçenek 1 (token'a bağla, bento'yu koru)

**Karar:** Seçenek 1 — mevcut bento/glass görsel dilini (gradient ikon rozeti, `backdrop-blur-xl` kart, ambient radial glow, sticky footer) koru, ama tüm hardcoded `white/NN` / `#05050a` değerlerini yeni bir `--bento-*` token setine bağla ve bu sete hem açık hem koyu değerler tanımla.

**Gerekçe:**
1. Projenin genel görsel yönü zaten saf "Minimal/Flat" değil — paylaşılan `Card` bileşeni (`frontend/src/components/ui/card.tsx` satır 28: `bg-surface/70 ... backdrop-blur-xl`) ve `useMouseGlow` interactive hover glow'u projede halihazırda **B) Glassmorphism/Glow** yönünde. Settings sayfasını düz `Card`'a indirgemek (Seçenek 2) mevcut en zengin/prodüksiyon-kalitesinde ekranı sıradanlaştırır ve geriye dönük bir görsel gerileme olur.
2. Seçenek 2 (Card'a taşı) daha az iş gibi görünse de, "Genel/Sayfa Ayarları/Görünüm" bento grid'i + gradient rozetler + sticky glass footer gibi özel etkileşimleri kaybeder — bu davranış deseni hiçbir yerde "Yapmaz" değil, sadece token bağlamıyor.
3. Token'a bağlamak (Seçenek 1) hem sorunu (tema-duyarsızlık) çözer hem de görsel kimliği korur — bu yüzden tercih edilen çözüm.

**Yeni token seti** (aşağıdaki satırlar `globals.css`'e eklenecek — frontend-agent uygular):

`:root` bloğuna (satır ~7-20 civarına, açık tema değerleri):
```css
--bento-bg: #f6f6fb;                          /* sayfa arka planı: çok açık, hafif lavanta tonlu gri — düz --background beyazından kasıtlı olarak ayrışır */
--bento-surface: rgba(15, 15, 35, 0.035);      /* kart dolgusu: açık zemin üzerinde ince koyu-tonlu cam */
--bento-surface-muted: rgba(15, 15, 35, 0.02); /* disabled/placeholder alan dolgusu (örn. SMTP inputları) */
--bento-border: rgba(15, 15, 35, 0.08);
--bento-border-hover: rgba(15, 15, 35, 0.14);
--bento-glow-1: rgba(var(--accent-rgb-500), 0.08);  /* sol-üst ambient glow, sağ-alt --bento-glow-2 aynı formülle 0.06 opaklık */
--bento-glow-2: rgba(var(--accent-rgb-500), 0.06);
```

`.dark .admin-shell` bloğuna (satır ~169-210 civarına, koyu tema değerleri — MEVCUT görünümü BİREBİR korur, sadece hardcoded değerler token'a taşınıyor):
```css
--bento-bg: #05050a;
--bento-surface: rgba(255, 255, 255, 0.03);
--bento-surface-muted: rgba(255, 255, 255, 0.02);
--bento-border: rgba(255, 255, 255, 0.1);
--bento-border-hover: rgba(255, 255, 255, 0.2);
--bento-glow-1: rgba(var(--accent-rgb-500), 0.16);
--bento-glow-2: rgba(var(--accent-rgb-500), 0.12);
```

Metin opaklık skalası için **yeni token TANIMLAMAYA gerek yok** — `color-mix` ile `--foreground`'dan türetilecek, böylece açık/koyu için ayrı ayrı hardcode gerekmez (zaten doğru kontrastlı `--foreground` otomatik ters çevriliyor). `@theme inline` bloğuna (satır ~72-125 civarına, `--color-danger` gibi diğer eşlemelerin yanına) eklenecek:
```css
--color-bento-bg: var(--bento-bg);
--color-bento-surface: var(--bento-surface);
--color-bento-surface-muted: var(--bento-surface-muted);
--color-bento-border: var(--bento-border);
--color-bento-border-hover: var(--bento-border-hover);

--color-bento-fg-80: color-mix(in oklch, var(--foreground) 80%, transparent);
--color-bento-fg-60: color-mix(in oklch, var(--foreground) 60%, transparent);
--color-bento-fg-50: color-mix(in oklch, var(--foreground) 50%, transparent);
--color-bento-fg-40: color-mix(in oklch, var(--foreground) 40%, transparent);
--color-bento-fg-30: color-mix(in oklch, var(--foreground) 30%, transparent);
--color-bento-fg-20: color-mix(in oklch, var(--foreground) 20%, transparent);
```
(Bu `@theme inline` kaydı yapıldığında Tailwind otomatik olarak `bg-bento-surface`, `text-bento-fg-60`, `border-bento-border` gibi utility class'ları üretir — projede `--color-danger` → `text-danger`/`bg-danger` zaten aynı mekanizmayla çalışıyor, satır 83-87.)

**Eşleme tablosu** (`admin/settings/page.tsx` içindeki hangi hardcoded class hangi yeni class ile değişecek — frontend-agent için birebir kılavuz):

| Eski (hardcoded) | Yeni | Nerede |
|---|---|---|
| `bg-[#05050a]` (sayfa arka planı, 3 yerde: satır 318, 329, 336) | `bg-bento-bg` | Loading/error/ana wrapper |
| `border-white/10` (kart border) | `border-bento-border` | `BentoCard`, tabs, inputlar, footer |
| `hover:border-white/20` | `hover:border-bento-border-hover` | `BentoCard` hover |
| `bg-white/[0.03]` (kart dolgusu) | `bg-bento-surface` | `BentoCard` |
| `bg-white/[0.02]` (disabled input dolgusu) | `bg-bento-surface-muted` | SMTP disabled inputlar |
| `bg-white/5` (input/buton dolgusu, aktif) | `bg-bento-surface` *(veya biraz daha belirgin olması isteniyorsa `--bento-surface`'in 2 katı bir yeni ara ton — pratikte aynı token yeterli, gözle ayırt edilmez fark yaratmaz)* | inputlar, "Yükle" butonu, tabs list |
| `text-white` (başlıklar, %100 opaklık) | `text-foreground` (YENİ token gerekmiyor — zaten var olan, doğru şekilde tema-duyarlı token) | `h1`, `h2` başlıkları |
| `text-white/80` | `text-bento-fg-80` | `DarkField` label |
| `text-white/60` | `text-bento-fg-60` | açıklamalar, hint'ler |
| `text-white/50` | `text-bento-fg-50` | alt açıklama metni |
| `text-white/40` | `text-bento-fg-40` | disabled input metni, chevron ikonu |
| `text-white/30` | `text-bento-fg-30` | placeholder |
| `text-white/20` | `text-bento-fg-20` | en düşük öncelikli metin |
| `bg-[radial-gradient(circle_at_10%_0%,rgba(var(--accent-rgb-500),0.16),transparent_45%)]` | aynı gradient, `0.16` yerine `var(--bento-glow-1)` | sayfa arka plan glow (üst) |
| `bg-[radial-gradient(circle_at_90%_100%,rgba(var(--accent-rgb-500),0.12),transparent_50%)]` | aynı gradient, `0.12` yerine `var(--bento-glow-2)` | sayfa arka plan glow (alt) |
| `<option style={{backgroundColor:"#0a0a12", color:"#fff"}}>` (satır 449, 453) | `style={{backgroundColor:"var(--popover)", color:"var(--popover-foreground)"}}` | native `<select>` içindeki `<option>` — bu iki token zaten tema-duyarlı (`--popover`/`--popover-foreground`, hem `:root` hem `.dark .admin-shell`'de tanımlı) |

**Değişmeyecek olanlar** (zaten tema-agnostik/doğru): accent gradient rozetler (`bg-[linear-gradient(...,var(--accent-500),var(--accent-700))]`), accent glow shadow'ları (`shadow-[0_0_25px_rgba(var(--accent-rgb-400),0.55)]`), `border-red-500/30 bg-red-500/10 text-red-300` / `border-emerald-500/30 ... text-emerald-300` / `border-amber-400/30 ... text-amber-300` gibi durum renkleri (bunlar zaten proje genelinde `Alert`'in `--danger`/`--success`/`--warning` tonlarıyla aynı aile, doğrudan Tailwind red/emerald/amber-300 kullanıyor — açık modda bu spesifik tonlar biraz düşük kontrast verebilir ama bu J.2'nin kapsamı dışında bir Alert/durum-rengi detayı; istenirse ayrı bir turda `--danger`/`--success`/`--warning` token'larına geçirilebilir, şimdilik dokunma).

---

## H) "Yeni Sayfa" formu zenginleştirme

Dosya: `frontend/src/app/admin/pages/new/page.tsx`. Mevcut bileşenler (`Card`, `Field`, `Input`, `Button`, `Alert`) korunacak, aşağıdaki YENİ alanlar eklenecek.

### H.1 — Slug/URL alanı

**Karar:** `InputGroup` + `InputGroupAddon` ile sabit `/` prefix'i (proje zaten bu bileşene sahip: `frontend/src/components/ui/input-group.tsx`, aynı desen `frontend/src/app/admin/pages/page.tsx` satır 109-119'da arama kutusunda `InputGroupAddon` + ikon olarak kullanılıyor — burada ikon yerine sabit metin `/` kullanılacak). Ayrı bir "önizleme satırı + Düzenle linki" YOK — gereksiz dolaylılık, tek satırlık doğrudan-düzenlenebilir alan daha az tıklama gerektirir ve sayfa düzenleme ekranındaki (`pages/[pageId]/page.tsx` satır 321-323) mevcut `Field id="slug" label="Slug (URL)"` deseniyle tutarlı.

Somut yapı:
```
<Field id="slug" label="Slug (URL)" required hint="Boş bırakılırsa başlıktan otomatik oluşturulur.">
  {(inputProps) => (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>/</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput {...inputProps} value={slug} onChange={...} placeholder="ornek-sayfa-slug" />
    </InputGroup>
  )}
</Field>
```
- Label metni: `"Slug (URL)"` — `pages/[pageId]/page.tsx` ile birebir aynı (tutarlılık).
- Davranış (frontend-agent implementasyonu için spesifikasyon, kod değil): `slug` state'i başlangıçta boş. Kullanıcı `title` yazdıkça, EĞER kullanıcı `slug` alanını henüz elle DÜZENLEMEDİYSE (bir `slugManuallyEdited` boolean flag ile takip edilir — WordPress/Notion'daki standart "dirty flag" deseni), `slug` otomatik olarak `title`'dan türetilir (küçük harfe çevir, Türkçe karakterleri ASCII'ye indir — ç→c, ş→s, ğ→g, ü→u, ö→o, ı→i — boşlukları `-` yap, `[a-z0-9-]` dışını at). Kullanıcı `slug` alanına manuel dokunduğu an bu flag `true` olur ve otomatik türetme o oturum için durur.
- Görsel stil: `InputGroupAddon` zaten `text-muted-foreground` rengiyle geliyor (bileşenin kendi tanımı), ekstra bir stil eklemeye gerek yok — mevcut bileşen birebir kullanılacak.

### H.2 — Durum seçimi (Taslak/Yayında)

**Karar:** Segmented toggle button çifti (radio/select DEĞİL). Gerekçe: sadece 2 seçenek var, radio grubu 2 seçenek için gereksiz dikey yer kaplar, `select` ise tek tıkla karşılaştırma imkanı vermez. Proje zaten aynı deseni `pages/[pageId]/page.tsx` satır 50-66'daki `LocaleToggle` bileşeninde kullanıyor (TR/EN için) — aynı iskeleti, Badge tone renkleriyle uyumlu şekilde durum için tekrar kullan.

Somut yapı (yeni, örn. `StatusToggle` adında küçük bir yerel bileşen):
```
<div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface-muted p-1">
  <button type="button" aria-pressed={status === "DRAFT"}
    className={cn(
      "inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors",
      status === "DRAFT" ? "bg-warning/10 text-warning" : "text-foreground/60 hover:text-foreground hover:bg-surface"
    )}>
    Taslak
  </button>
  <button type="button" aria-pressed={status === "PUBLISHED"}
    className={cn(
      "inline-flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors",
      status === "PUBLISHED" ? "bg-success/10 text-success" : "text-foreground/60 hover:text-foreground hover:bg-surface"
    )}>
    Yayında
  </button>
</div>
```
- Renk eşlemesi `pages/page.tsx` satır 157-158'deki `Badge tone={status === "PUBLISHED" ? "success" : "warning"}` ile BİREBİR aynı (`bg-warning/10 text-warning` = Badge'in `warning` tonu, `bg-success/10 text-success` = Badge'in `success` tonu — `badge.tsx` satır 9-11'deki `toneClasses` ile aynı class'lar, ayrı bir token gerekmiyor).
- Varsayılan durum: `DRAFT` (Taslak) — yeni oluşturulan bir sayfa varsayılan olarak yayında olmamalı (backend'in mevcut varsayılanıyla tutarlı olmalı, kontrol edilmeli ama tasarım açısından varsayılan seçili segment "Taslak").
- Field label'ı: `"Durum"` düz metin `<p className="text-sm font-medium text-foreground">Durum</p>` yeterli, `Field` bileşenini zorlamaya gerek yok çünkü bu bir input değil buton grubu (a11y: `role="group"` + `aria-label="Durum"` container'a eklenmeli).

### H.3 — SEO alanları (katlanabilir bölüm)

**Karar:** Native `<details>/<summary>` DEĞİL (proje genelinde tutarlı focus-ring/hover stilini `<summary>`'nin native marker'ı üzerinde tutarlı şekilde stillendirmek daha zahmetli ve tarayıcılar arası tutarsız). Bunun yerine `useState` tabanlı basit bir disclosure + hafif `framer-motion` height/opacity transition (proje zaten `framer-motion` kullanıyor, örn. bu dosyanın kendisi ve `settings/page.tsx` — ek bağımlılık yok).

Kapalı başlangıç durumu başlık metni: **"SEO ayarları (opsiyonel)"** — parantez içi "(opsiyonel)" ibaresi kullanıcıya bu alanların zorunlu olmadığını, formu tamamlamadan atlayabileceğini baştan bildirir.

Somut yapı:
```
<div className="border-t border-border pt-4">
  <button type="button" onClick={() => setSeoOpen((v) => !v)} aria-expanded={seoOpen}
    className="flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-sm font-medium text-foreground transition-colors hover:text-primary">
    <span className="flex items-center gap-2">
      <Search className="h-4 w-4 text-foreground/50" />
      SEO ayarları (opsiyonel)
    </span>
    <ChevronDown className={cn("h-4 w-4 text-foreground/50 transition-transform duration-200", seoOpen && "rotate-180")} />
  </button>
  <AnimatePresence initial={false}>
    {seoOpen && (
      <motion.div
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="overflow-hidden"
      >
        <div className="space-y-4 pt-4">
          <Field id="seoTitle" label="SEO başlığı" hint={`${seoTitle.length}/60 karakter`}>
            {(inputProps) => <Input {...inputProps} value={seoTitle} onChange={...} />}
          </Field>
          <Field id="seoDescription" label="SEO açıklaması" hint={`${seoDescription.length}/155 karakter`}>
            {(inputProps) => <Textarea {...inputProps} rows={2} value={seoDescription} onChange={...} />}
          </Field>
        </div>
      </motion.div>
    )}
  </AnimatePresence>
</div>
```
- İkonlar: `Search` (SEO için proje genelinde zaten kullanılan ikon — `pages/[pageId]/page.tsx` satır 293 SEO sekmesinde, `seo-preview.tsx` satır 3 Google ikonunda) ve `ChevronDown` (proje genelinde disclosure/dropdown ikonu olarak zaten kullanılıyor — `settings/page.tsx` satır 19).
- Label'lar: `"SEO başlığı"` / `"SEO açıklaması"` — `pages/[pageId]/page.tsx` satır 362 ve 373 ile BİREBİR aynı metin (tutarlılık, kullanıcı iki farklı ekranda aynı terimi görsün).
- Karakter sayacı limitleri: **60 / 155** — rastgele değil, projede zaten var olan `frontend/src/components/admin/seo-preview.tsx` satır 8-9'daki `GOOGLE_TITLE_LIMIT = 60` / `GOOGLE_DESCRIPTION_LIMIT = 155` sabitleriyle BİREBİR aynı (bu form daha sonra `pages/[pageId]/page.tsx`'te aynı `seoTitle`/`seoDescription` alanlarını `SeoPreview` bileşenine besleyecek — sayı tutarlılığı şart). Yeni Sayfa formunda tam `SeoPreview` panelini (Google/Sosyal Medya sekmeli önizleme) GÖSTERME — bu, hızlı oluşturma akışı için fazla ağır; sadece basit `"{length}/{limit} karakter"` metni `Field`'ın mevcut `hint` prop'u üzerinden yeterli. Limit aşımı için ayrı bir kırmızı/amber renk değişikliği EKLEME (bu formda sert bir "hata" değil, sadece bilgi amaçlı sayaç — `Field`'ın varsayılan `hint` stili `text-xs text-foreground/60` yeterli, `seo-preview.tsx`'teki amber-500 uyarı rengi tam önizleme panelinde daha anlamlı, burada gereksiz görsel gürültü).

### H.4 — Validasyon görsel geri bildirimi

**Karar:**
- **Buton disabled durumu:** `Button` bileşeni zaten `disabled` prop'unu destekliyor (`frontend/src/components/ui/button.tsx` satır 49, 57) ve `buttonVariants` içinde `disabled:pointer-events-none disabled:opacity-50` (satır 8) tanımlı — YENİ bir stil gerekmiyor, olduğu gibi kullan: `<Button type="submit" loading={creating} disabled={!title.trim()}>`.
- **Başlık karakter sınırı:** YOK — sadece boş-değil (`title.trim()`) validasyonu yeterli. Gerekçe: projede "düz başlık" alanları (bu form, `blog/new/page.tsx` satır 86-90, `pages/[pageId]/page.tsx` satır 309-320) hiçbirinde karakter sayacı kullanmıyor; karakter sayacı SADECE SEO alanlarında (`seo-preview.tsx`) var çünkü onun somut bir dış sınırı var (Google'ın kırpma davranışı). Sayfa başlığı için böyle bir dış sınır yok, sayaç eklemek tutarsız/gereksiz karmaşıklık olur.
- Boş alan durumunda `Field`'ın `error` prop'u ile kırmızı `"Başlık gerekli"` mesajı GÖSTERME (submit denemeden) — sadece buton disabled kalması yeterli, agresif erken hata mesajı UX'i bozar. `noValidate` + `Field`'ın `error` mekanizması sadece submit sonrası backend hatası için kullanılmaya devam etsin (mevcut `Alert variant="error"` deseni zaten var, satır 54-61, değişmeyecek).

---

## Özet — frontend-agent için uygulama sırası önerisi
1. `globals.css`: media-query leak düzeltmesi (frontend-agent kararı) + J.2'deki `--bento-*` token'ları ekle.
2. `admin/settings/page.tsx`: J.2 eşleme tablosundaki class'ları değiştir.
3. `admin/pages/new/page.tsx`: H.1-H.4'ü uygula (slug `InputGroup`, durum segmented toggle, SEO disclosure + `framer-motion`, disabled buton).
