# Tasarım Notu — İçerik Listesi "Hızlı Düzenle" Formu: Kart Yapısı + Bug #1

**Kapsam:** `frontend/src/components/admin/content-list/content-list-table.tsx` — masaüstü tablo satırı (~135-199) ve mobil kart formu (~322-394). Ortak bileşen: hem Blog hem Sayfalar (hem de şu an kullanmasa da Portfolyo/Ürün) listelerinde kullanılıyor.

**Önkoşul:** Bu dosya `.claude/design-notes-quick-edit-row.md` ile AYNI görsel dile (Minimal/Flat — düz `bg-card`/`bg-muted`, ince border, blur/glow yok) ve aynı renk/spacing tokenlerine (`--primary`, `--danger`, `--muted`, `--border`, `--card`, 4/8/12/16 ölçeği) sadıktır; oradaki kararlarla ÇELİŞMEZ, onları BASE ALIR (özellikle `bg-primary/8` + `border-l-4 border-l-primary` dış çerçeve ve `animate-in fade-in-0 slide-in-from-top-1 duration-200` giriş animasyonu — bunlara dokunulmuyor).

---

## Bölüm A — Bug #1: Kategori/Etiket çakışması

### A.1) Kök neden — onaylandı, tekrarlanabilir bir pattern

`frontend/src/components/ui/select.tsx` (satır 9-21) — base `<select>` elemanı hiçbir `display` class'ı taşımıyor, bu yüzden tarayıcı varsayılanı olan `display: inline-block` geçerli kalıyor. `w-full` genişliği %100 yapsa da, kutu yine de **inline-level** kalıyor; hemen ardından gelen bir `inline-flex`/`inline` sibling (`category-select.tsx` satır 158-165'teki "+ Yeni Kategori Oluştur" butonu) aynı inline formatting context'te select'in kutusunun bittiği noktadan devam etmeye çalışıyor ve container dışına taşıyor.

**Bu Select'e ÖZGÜ bir hata değil — `ui/select.tsx`'in KENDİSİNDE `block` yok**, dolayısıyla Select'i çağıran HERHANGİ bir yerde, hemen ardından bir inline/inline-flex sibling render edilirse (buton, link, span) AYNI bug tekrarlanabilir.

### A.2) Kapsam taraması — global fix güvenli mi?

Projedeki TÜM `<Select>` kullanım noktaları (29 dosya) tarandı (`Grep "<Select"`, ±3 satır context). Sonuç: **CategorySelect dışında hiçbir yerde** Select, aynı block-level container içinde bir inline-level sibling'in HEMEN ardından/önünde değil. Tüm diğer kullanımlar şu üç kalıptan birine giriyor (hepsi zaten Select'i fiilen "blockify" ediyor veya izole ediyor, dolayısıyla `display` değeri fark yaratmıyor):

- `flex`/`flex-wrap` container içinde (`content-list-bulk-bar.tsx`, `orders/page.tsx`, `users/page.tsx`, `webhook-deliveries-dialog.tsx`, `date-range-filter.tsx`) — flex item'lar CSS spec gereği "blockify" edilir, `inline-block` belirtilmiş olsa da olmasa da fark etmez.
- `grid` container içinde (`import-preview-panel.tsx`, `content-list-table.tsx` Durum hücresi) — aynı gerekçe, grid item'lar da blockify edilir.
- `Field` render-prop / tek başına `<div>` içinde, sonrasında hiçbir inline sibling YOK (`create-export-dialog.tsx`, `new-user-dialog.tsx`, `api-key-form-dialog.tsx`, `members/page.tsx`, `products/[productId]/page.tsx`, `navigation/page.tsx`, `media/page.tsx`).

**Sonuç: `ui/select.tsx`'in base class'ına `block` eklemek YAN ETKİSİZ** — mevcut hiçbir kullanım inline-block davranışına bağımlı değil (hiçbiri Select'i bilinçli olarak metin akışı içine gömmüyor).

### A.3) Karar — fix, base component'te (global), scoped değil

**Dosya:** `frontend/src/components/ui/select.tsx`, satır 12.

**Değişiklik:**
```
- "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none",
+ "block h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none",
```
(Sadece `block` class'ı class listesinin başına eklendi — başka hiçbir class/davranış değişmiyor.)

**Neden scoped (`category-select.tsx`'e tek başına `className="block"` eklemek) DEĞİL, global:** Scoped fix sadece BU tekil noktayı düzeltir; aynı pattern (Select + hemen ardından inline sibling) gelecekte başka bir yerde tekrar oluşursa (örn. Ürün/Portföy'ün kendi taxonomy select'i ileride benzer bir "+ Yeni X Oluştur" linkiyle eklenirse) aynı bug SESSİZCE geri gelir. A.2'deki tarama global fix'in güvenli olduğunu kanıtladığından, kök nedeni component seviyesinde kapatmak (defans katmanı, "bir daha asla" garantisi) daha doğru mühendislik kararı. `category-select.tsx`'te AYRICA bir değişiklik GEREKMİYOR — Select artık `block` olduğundan kendi satırını kapatacak, `button`'ın `inline-flex` olması sorun yaratmayacak (block bir önceki kardeşten sonra otomatik satır başı yapar).

### A.4) Karar — TagSelect'e kalıcı "+ Yeni Etiket Oluştur" linki EKLENMEYECEK (seçenek a, YETERLİ)

**Karar: (a) — sadece CSS akış bug'ı düzeltilecek, TagSelect'in API/UX'i DEĞİŞMEYECEK.**

**Gerekçe:**
1. CategorySelect'in kalıcı linki, kategori listesinin TEK SEVİYELİ ve küçük olması nedeniyle mantıklı (dropdown zaten tüm liste açık, "oluştur" ayrı/nadir bir ikincil eylem).
2. TagSelect ZATEN farklı bir (ve büyük etiket setleri için daha doğru) pattern kullanıyor: arama input'u + inline öneri dropdown'u, yazınca içinde beliren `"X" için yeni etiket oluştur` seçeneği (satır 189-202). Buna EK olarak kalıcı bir link koymak REDUNDANT olur ve aynı bileşende "oluşturmanın iki yolu" kafa karışıklığı yaratır (hangisi "doğru" akış belirsizleşir).
3. Mevcut, ÇALIŞAN ve TEST EDİLMİŞ bir sözleşmeyi (`frontend/tests/unit/tag-select.test.tsx`, `frontend/tests/e2e/admin-blog-tags.spec.ts`) değiştirmenin maliyeti, kazanılacak tutarlılık faydasından yüksek — bu değişikliğin gerçek bir kullanıcı şikayeti/ihtiyacı yok, salt "görsel simetri" için yapılırdı.
4. Kullanıcının ekran görüntüsündeki "yanlış link" izlenimi zaten A.1-A.3'teki CSS bug'ının bir SONUCUYDU (CategorySelect'in linki TagSelect'in placeholder'ının üzerine TAŞIYORDU) — kök neden düzeltilince bu görsel karışıklık zaten ortadan kalkacak, ayrı bir UX değişikliğine gerek yok.

---

## Bölüm B — Kart/konteyner yapısı (Görev #2)

### B.1) Üç mantıksal grup, iç içe "kart" katmanı

**Karar — üç ayrı kart:**
- **Kart 1 — İçerik:** Başlık + Slug (dikey, Slug Başlık'ın HEMEN ALTINDA — yan yana değil).
- **Kart 2 — Sınıflandırma:** `quickEditExtraFields` prop'u VARSA render edilir (şu an sadece Blog: Kategori + Etiketler yan yana). Prop YOKSA (Sayfalar, ve şu an Portfolyo/Ürün) bu kart HİÇ RENDER EDİLMEZ — boş/hayalet kart YOK, koşul: `{quickEditExtraFields && <QuickEditCard>...</QuickEditCard>}`.
- **Kart 3 — Durum:** Tek alan (Durum select'i).

### B.2) Kart görsel token'ları

**Karar:**
```
rounded-lg border border-border/60 bg-card p-3
```

**Gerekçe (renk katmanlama mantığı):** Dış çerçeve (`TableRow`/mobil `div`) zaten `bg-primary/8` (soluk primary tint) + `border-l-4 border-l-primary` taşıyor (bkz. design-notes-quick-edit-row.md §3) — bu PRIMARY vurgusunu kartlar İÇİNDE TEKRARLAMIYORUZ. Bunun yerine iç kartlar OPAK `bg-card` (tablo/sayfanın kendi nötr temel rengi — dark'ta `#12121a`) kullanıyor. Sonuç: dış primary/8 tint, kartların ARASINDAKİ boşluklarda (gap) ve TableCell'in `p-4` kenar payında görünür kalırken, kartların İÇİ nötr/opak bir "panel" gibi öne çıkıyor — Stripe/Linear'daki "renkli zemin üzerinde duran form paneli" hissi budur. `border-border/60` (tam opak `--border` değil, `/60`) zaten bu dosyada AYNI amaçla kullanılan bir emsal var (satır 481: mobil kart meta bölücüsü `border-t border-border/60 pt-3`) — yeni bir token icat edilmedi, mevcut "ikincil ayraç" opaklığı tekrar kullanıldı.

**Radius farkı (`rounded-lg`, 8px, dış çerçevenin `rounded-xl` (tablo wrapper) / kesintisiz blok (TableRow, radius yok) yerine):** İç içe geçmiş elemanlarda küçük→büyük radius hiyerarşisi (nested radius küçük olmalı) — `rounded-lg` (8px) `rounded-xl`'den (12px) bir kademe küçük, "bu daha içeride/ikincil" hissini pekiştiriyor.

**`p-3` (12px iç padding):** Dış `TableCell`'in `p-4`'ünden (16px) bir kademe küçük — dış→iç azalan padding (16px→12px) yine hiyerarşiyi netleştiriyor, projenin 4/8/12/16 ölçeğinde kalıyor.

**Gölge yok (`shadow-none`, hiçbir shadow class'ı eklenmiyor):** Minimal/Flat dilinde çoklu gölge katmanı ("kart üstüne kart üstüne gölge") kaçınılması gereken bir "ucuz görünüm" belirtisi — ayrım tamamen renk (bg-card vs bg-primary/8) ve border ile sağlanıyor, gölgeye gerek yok.

### B.3) Kart içi spacing

**Karar — DEĞİŞTİRİLMEYEN, mevcut ölçekten devralınan değerler:**
- Kart içinde alan grupları arası: `space-y-3` (12px) — Kart 1'de Başlık↔Slug arası bu.
- Label→Input: `space-y-1` (4px) — değişmedi (row-notes §2 ile birebir aynı).
- Kartlar arası (grid gap): `gap-3` (12px) — bkz. Bölüm C.

Yeni bir spacing değeri İCAT EDİLMEDİ — 4/12/16 üçlüsü zaten proje ölçeğinde var, tekrar kullanıldı.

### B.4) Slug alanı — "küçük/ikincil" görsel muamele

**Karar:** Slug alanının `<label>`'ı DİĞER label'larla AYNI kalır (`block text-xs font-medium text-foreground/60` — tutarlılık/tarama kolaylığı için etiket boyutu değişmiyor). İkincillik SADECE input'un kendi stiline ve (opsiyonel) bir prefiks ikonuna yansıtılıyor:

```
<InputGroup className="h-8">
  <InputGroupAddon align="inline-start">
    <Link2 className="h-3.5 w-3.5 text-foreground/40" />
  </InputGroupAddon>
  <InputGroupInput
    id={...}
    className="font-mono text-xs md:text-xs text-foreground/80"
    value={quickEditValues.slug}
    onChange={...}
  />
</InputGroup>
```

**Değerler ve gerekçe:**
- `font-mono` — slug bir "teknik/sistem" alanı (URL parçası), monospace bu kimliği görsel olarak imler (GitHub/Vercel'de aynı pattern).
- `text-xs md:text-xs` — **ikisi de gerekli**: `Input`/`InputGroupInput`'un base class'ı `text-base md:text-sm` taşıyor (mobil zoom-önleme + masaüstü küçültme). `tailwind-merge` class çakışmasını VARYANT+GRUP bazında çözer; sadece `text-xs` eklemek `text-base`'i (varyantsız grup) override eder ama `md:text-sm`'i (ayrı varyant grubu) ETMEZ — bu yüzden `md:text-xs` da AYRICA eklenmeli, yoksa masaüstünde `md:text-sm` geri kazanır.
- `text-foreground/80` — normal input metninden (`text-foreground`, opaklık belirtilmemiş) biraz soluk, ikincilliği pekiştirir ama okunabilirliği bozacak kadar değil (WCAG AA için yeterli kontrast — `/80` opaklık dark/light ikisinde de `--muted-foreground`'dan daha koyu/net kalır).
- `Link2` ikonu (lucide-react, `h-3.5 w-3.5` = 14px, tek ikon kaynağı kuralına uygun) — projenin zaten sahip olduğu `InputGroup`/`InputGroupAddon` bileşen ailesi kullanılıyor (bkz. `frontend/src/components/ui/input-group.tsx`), YENİ bir bileşen icat edilmedi.
- Bu ikon+InputGroup katmanı **opsiyonel bir görsel iyileştirme** — frontend-agent zaman/karmaşıklık kısıtı nedeniyle bunu atlarsa, minimum karar `font-mono text-xs md:text-xs text-foreground/80` class'ının düz `Input`'a eklenmesidir (InputGroup/ikon olmadan da "ikincil" hissi byüyük ölçüde korunur).

---

## Bölüm C — `QuickEditGrid` / `QuickEditCard` (Görev #3)

### C.1) Neden iki ayrı component (Grid + Card)

`QuickEditGrid` SADECE grid container'ı (sütun şablonu + gap) yönetir; `QuickEditCard` SADECE kart görselini (B.2'deki `bg-card`/`border-border/60`/`rounded-lg`/`p-3`) ve grid içindeki `span` davranışını taşır. Ayrım, gelecekte "kart görünümü aynı ama farklı bir grid düzeni" veya tam tersi ihtiyaçlarında iki component'i bağımsız yeniden kullanılabilir kılar.

### C.2) `QuickEditGrid` prop arayüzü

```ts
interface QuickEditGridProps {
  /**
   * Her breakpoint'te İZİN VERİLEN maksimum sütun sayısı. Gerçek kart sayısı (children)
   * bundan azsa (örn. Sayfalar'da 2 kart, columns.xl=3 varsayılanına rağmen) grid xl'de de
   * 2 sütunlu şablona düşer — çağıran taraf `columns` değerini kart sayısına göre KENDİSİ set eder,
   * component "children sayısına göre otomatik keşif" YAPMAZ (bkz. C.4 — Tailwind JIT kısıtı).
   */
  columns?: { base?: 1; md?: 1 | 2; xl?: 1 | 2 | 3 };
  children: ReactNode;
  className?: string;
}
```
**Varsayılan:** `{ base: 1, md: 2, xl: 3 }` (Blog / gelecekte 3-kartlı her entity için doğru varsayılan).

### C.3) `QuickEditCard` prop arayüzü

```ts
interface QuickEditCardProps {
  children: ReactNode;
  className?: string;
  /**
   * Grid'de kaç sütun kaplayacağı, breakpoint bazlı. SADECE 3-kartlı düzendeki Kart 3 (Durum)
   * için gerekli: md'de (henüz xl değilken) tam genişlik, xl'de tekrar tek sütun.
   */
  span?: { md?: 1 | 2; xl?: 1 | 2 };
}
```

### C.4) Somut Tailwind değerleri — sabit lookup tablosu (Tailwind JIT kısıtı UYARISI)

**ÖNEMLİ (frontend-agent için):** Tailwind, class isimlerini derleme zamanında STATIK STRING olarak tarar — `` `md:grid-cols-${n}` `` gibi runtime'da string interpolasyonu ile üretilen class'lar JIT tarafından YAKALANMAZ ve derlemeye dahil edilmez. Bu yüzden `columns`/`span` değerlerinden Tailwind class'ına eşleme SABİT bir lookup objesiyle yapılmalı (tüm olası class string'leri kaynak kodda LITERAL olarak yazılı bulunmalı):

```ts
const GRID_MD_CLASS = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-[2fr_1fr]",
} as const;

const GRID_XL_CLASS = {
  1: "xl:grid-cols-1",
  2: "xl:grid-cols-[2fr_1fr]",
  3: "xl:grid-cols-[2fr_1fr_1fr]",
} as const;

const SPAN_MD_CLASS = { 1: "", 2: "md:col-span-2" } as const;
const SPAN_XL_CLASS = { 1: "xl:col-span-1", 2: "xl:col-span-2" } as const;
```

`QuickEditGrid` kök class'ı: `grid grid-cols-1 gap-3 ${GRID_MD_CLASS[columns.md ?? 2]} ${GRID_XL_CLASS[columns.xl ?? 3]}`.
`QuickEditCard` kök class'ı: `rounded-lg border border-border/60 bg-card p-3 ${SPAN_MD_CLASS[span?.md ?? 1]} ${SPAN_XL_CLASS[span?.xl ?? 1]}`.

### C.5) Breakpoint davranışı — somut senaryolar

**Blog (3 kart — Kart1 İçerik, Kart2 Sınıflandırma, Kart3 Durum):**
```tsx
<QuickEditGrid columns={{ base: 1, md: 2, xl: 3 }}>
  <QuickEditCard>{/* İçerik: Başlık + Slug */}</QuickEditCard>
  <QuickEditCard>{/* Sınıflandırma: Kategori + Etiketler */}</QuickEditCard>
  <QuickEditCard span={{ md: 2, xl: 1 }}>{/* Durum */}</QuickEditCard>
</QuickEditGrid>
```
- **Mobil (`<768px`):** `grid-cols-1` — 3 kart alt alta.
- **Orta (`768–1279px`, `md:` ama `xl:` değil):** `md:grid-cols-[2fr_1fr]` → Kart1(İçerik, 2fr) + Kart2(Sınıflandırma, 1fr) ÜSTTE yan yana; Kart3(Durum) `md:col-span-2` ile ALTTA TAM GENİŞLİK bir satır. **Bu, görevde sorulan "İçerik+Sınıflandırma üstte, Durum altta tam genişlik mi" sorusunun KARARI: EVET, bu dağılım.** Gerekçe: İçerik (başlık, en sık düzenlenen alan) ve Sınıflandırma (kategori+etiket, ikisi de "içerik ne hakkında" sorusuna cevap veriyor, birbirine anlamsal olarak yakın) üstte eşleşiyor; Durum (yayın durumu, ayrı bir "iş akışı" kararı) görsel olarak ayrışsın diye kendi satırında.
- **Geniş (`≥1280px`, `xl:`):** `xl:grid-cols-[2fr_1fr_1fr]`, Kart3 `xl:col-span-1` ile tekrar tek sütuna döner — 3 kart yan yana.

**Kart3 (Durum) içindeki select'in genişlik taşması:** Kart3 `md:col-span-2` iken tam genişlik bir satır kaplıyor ama İÇERİĞİ (select) o genişliğe GERMİYORUZ — Durum kartının içeriği `<div className="max-w-56">` (224px) ile sarmalanmalı, select `min-w-36` (row-notes §1 ile aynı, 144px) alt sınırıyla birlikte 144-224px aralığında sabit kalır, geniş boş bir kart-içi alan oluşmaz. Bu kural HEM `md:col-span-2` (geniş) HEM `xl:col-span-1` (dar) durumunda AYNI class ile çalışır — breakpoint'e göre koşullu ekstra class GEREKMEZ.

**Sayfalar / Portfolyo / Ürün (2 kart — Kart1 İçerik, Kart2 Durum; `quickEditExtraFields` YOK):**
```tsx
<QuickEditGrid columns={{ base: 1, md: 2, xl: 2 }}>
  <QuickEditCard>{/* İçerik: Başlık + Slug */}</QuickEditCard>
  <QuickEditCard>{/* Durum */}</QuickEditCard>
</QuickEditGrid>
```
- `columns.xl` BİLEREK `3` DEĞİL `2` — çünkü sadece 2 kart var, `xl:grid-cols-[2fr_1fr_1fr]` şablonu kullanılırsa üçüncü sütun BOŞ KALIR ve satır sağda "kesik/dengesiz" görünür (görevde belirtilen "boşluk/kırılma garip görünmemeli" riski TAM OLARAK bu). `columns.xl: 2` ile `md:` ve `xl:` AYNI `[2fr_1fr]` şablonunu kullanır (768px'ten itibaren sabit, `xl:` ayrı bir class ÜRETMEZ/gerekmez — `GRID_XL_CLASS[2]` zaten `md:`dekiyle birebir aynı `[2fr_1fr]` oranını veriyor, iki breakpoint'te de görsel SÜREKLİLİK sağlanıyor).
- Kart2 (Durum) burada `span` prop'u ALMAZ (varsayılan `1/1` — zaten 2 sütunlu grid'de tam sığıyor), içindeki select yine `max-w-56` ile sınırlı kalır.

**Gelecekte Portfolyo/Ürün'e `quickEditExtraFields` eklenirse:** Çağıran sayfa (`portfolio/page.tsx`/`products/page.tsx`) sadece `columns={{ base:1, md:2, xl:3 }}` verip 3. kartı (Sınıflandırma) render etmeye başlar — `QuickEditGrid`/`QuickEditCard`'ın KENDİSİNDE hiçbir değişiklik gerekmez, bu iki bileşen zaten kart-sayısı-agnostik tasarlandı (C.2'deki `columns` prop'u caller tarafından set edildiği için).

### C.6) Mobil (`<768px`) — AYRI render yolu, kart-içinde-kart KULLANILMAYACAK

**Karar: Mobil kendi tek-sütun akışını korur, `QuickEditGrid`/`QuickEditCard` mobilde KULLANILMAZ.** Sadece mantıksal gruplar arasına, kart değil, İNCE BİR AYRAÇ eklenir:

```
<div aria-hidden className="border-t border-border/60" />
```
Bu, mevcut mobil wrapper'ın (`grid grid-cols-1 gap-3`) NORMAL bir grid child'ı olarak eklenir — Başlık/Slug grubundan sonra (Kart2 varsa ondan önce), Kart2'den sonra (varsa, Durum'dan önce) veya Kart2 yoksa doğrudan Başlık/Slug'dan sonra Durum'dan önce. Grid'in mevcut `gap-3` (12px) mekanizması değişmeden kalır, ayraç sadece kendi satırında ince bir çizgi render eder.

**Gerekçe:**
1. Dar viewport'ta (320-767px) 2-3 adet ayrı border+bg+padding'li kart üst üste dizilirse ("kart içinde kart içinde kart") toplam dikey alan israfı ve görsel gürültü ("kutucuk yorgunluğu") oluşur — mobilde bilgi yoğunluğu öncelik, masaüstündeki grid-driven gruplama ihtiyacı mobilde YOK (zaten tek sütun, gruplama görsel olarak "hangi satır nereye ait" belirsizliği yaratmıyor).
2. `border-border/60` zaten bu dosyanın mobil kartında AYNI amaç için kullanılan bir token (satır 481, normal görünüm/Görüntülenme ile meta bilgi arasındaki ayraç) — yeni bir pattern icat edilmedi, mevcut olan yeniden kullanıldı.
3. Alan etiketleri (Kategori/Etiketler/Durum) zaten kendi `<label>`'larını taşıdığından ayrı bir "Sınıflandırma" grup başlığı/caption EKLENMEDİ — redundant olurdu, Minimal/Flat'ın "gereksiz chrome ekleme" ilkesiyle çelişirdi.

**Mobil Slug alanı:** B.4'teki `font-mono text-xs md:text-xs text-foreground/80` (+ opsiyonel `InputGroup`/`Link2`) AYNEN mobilde de uygulanır — masaüstü/mobil arası görsel dilde fark YARATILMAZ, sadece input `h-11` (mobil dokunma hedefi, zaten mevcut kural) kalır.

---

## Özet — Uygulanacak Somut Değerler

| Öğe | Değer |
|---|---|
| Bug #1 fix konumu | `frontend/src/components/ui/select.tsx` satır 12 — `block` class'ı eklenir (GLOBAL, tüm Select kullanımlarını etkiler, taramaya göre GÜVENLİ) |
| Bug #1 — `category-select.tsx` | Değişiklik GEREKMİYOR (global Select fix'i yeterli) |
| Bug #1 — TagSelect kalıcı link | EKLENMEYECEK (karar: a — sadece CSS bug'ı düzeltilir) |
| Kart arka plan/border | `rounded-lg border border-border/60 bg-card p-3` (primary tonu TEKRARLANMAZ, dış çerçeve zaten taşıyor) |
| Kart2 (Sınıflandırma) render koşulu | `quickEditExtraFields` prop'u VARSA render, YOKSA hiç render edilmez |
| Kart içi alanlar arası | `space-y-3` (12px) — değişmedi |
| Label→Input | `space-y-1` (4px) — değişmedi |
| Kartlar arası grid gap | `gap-3` (12px) |
| Slug input stili | `font-mono text-xs md:text-xs text-foreground/80` (+ opsiyonel `InputGroup` + `Link2` ikonu, `h-3.5 w-3.5 text-foreground/40`) |
| `QuickEditGrid` varsayılan columns | `{ base: 1, md: 2, xl: 3 }` |
| 3-kart md şablonu | `md:grid-cols-[2fr_1fr]` + Kart3 `md:col-span-2` (İçerik+Sınıflandırma üstte, Durum altta tam genişlik) |
| 3-kart xl şablonu | `xl:grid-cols-[2fr_1fr_1fr]` + Kart3 `xl:col-span-1` |
| 2-kart md/xl şablonu | `md:grid-cols-[2fr_1fr]` (xl AYNI, `columns.xl: 2` set edilir — 3. sütun asla açılmaz) |
| Durum kartı içerik genişliği | `max-w-56` (224px) sarmalayıcı + select `min-w-36` (144px) — her iki breakpoint'te de sabit |
| Mobil kart-içinde-kart | KULLANILMAZ — mevcut tek-sütun `grid-cols-1 gap-3` akışı korunur, gruplar arası `border-t border-border/60` ince ayraç eklenir |
| Tailwind JIT kısıtı | `columns`/`span` → class eşlemesi SABİT lookup objesiyle yapılmalı, dinamik string interpolasyonu KULLANILMAMALI |
