# Tasarım Notları — Müşteri & E-Ticaret Alanı (`/hesabim`)

Durum: v1 (2026-08-24) · Sahibi: ui-designer
Girdi: `.claude/architect-scope-customer-portal.md` (BAĞLAYICI — rota/guard kararları burada tekrar edilmez)
Uygulayıcı: frontend-agent. Kod YAZILMAMIŞTIR — bu dosya sadece karar setidir.

**Görsel yön:** Bu proje zaten **A) Minimal/Flat** diliyle üretimde (`Card`: `bg-surface/70` +
`border-border/60` + `backdrop-blur-xl` — hafif bir cam efekti var ama glow/gradient temelli bir dil
DEĞİL, düz yüzey üstünde ince blur). Yeni bileşenler bu dili KIRMAZ: yeni gradient, `blur-xl` ambient
glow, yeni ton paleti İCAT EDİLMEZ. Tüm renk/spacing kararları aşağıda **mevcut token'lara** bağlanır
(`--primary`, `--success`, `--danger`, `--warning`, `--border`, `--surface`, `--surface-muted`,
`--foreground`), yeni bir CSS custom property TANIMLANMAZ.

---

## 1. `/hesabim` sekmeli kabuk düzeni

**Konteyner:** mevcut `mx-auto max-w-3xl px-4 py-10 sm:px-6` kalıbı sekmeli kabukla **genişler**:
`mx-auto max-w-5xl px-4 py-10 sm:px-6` (iki kolonlu düzen 3xl'de sıkışır). İçerik kolonunun kendisi
(sağ taraf) `max-w-2xl` ile sınırlı kalır ki formlar mevcut hesabım kartlarıyla aynı okuma genişliğinde
kalsın.

**Masaüstü (`md:` ve üstü) — sol sabit sekme + sağ içerik:**

```
<div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
  <h1 .../> (mevcut "Hesabım" başlık bloğu, layout.tsx'te bir kez render edilir)
  <div className="mt-6 flex flex-col gap-6 md:flex-row md:items-start">
    <nav className="md:w-56 md:shrink-0"> ... sekme listesi ... </nav>
    <div className="min-w-0 flex-1 max-w-2xl">{children}</div>
  </div>
</div>
```

- Sol sekme genişliği **sabit `md:w-56` (224px)** — mevcut spacing ölçeğinde (4/8px) 56 = 224px, admin
  sidebar'ın `w-56`/`w-60` aralığıyla tutarlı büyüklük sınıfı.
- Sekme listesi bir `Card`'a SARILMAZ (mevcut `Card` `p-6` + `shadow-sm` içerik kartları için; sol nav
  daha "yassı" durmalı) — düz bir `<nav>` içinde dikey buton listesi, `space-y-1`.
- Her sekme öğesi:
  ```
  <Link className={cn(
    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-primary/10 text-primary"
      : "text-foreground/70 hover:bg-surface-muted hover:text-foreground"
  )}>
    <Icon className="h-4 w-4 shrink-0" />
    {label}
  </Link>
  ```
  Bu, `Badge tone="primary"` ile AYNI `bg-primary/10 text-primary` çiftini kullanır — projede zaten
  "aktif/vurgulu" anlamı için kurulu bir token eşleşmesi, yeni bir "aktif sekme" rengi İCAT EDİLMEZ.
- İkon eşlemesi (hepsi `lucide-react`, projede zaten kullanılan set):
  | Sekme | İkon |
  |---|---|
  | Profilim & Güvenlik | `UserRound` (mevcut `hesabim/page.tsx`'te zaten import edili) |
  | Adreslerim | `MapPin` |
  | Siparişlerim | `Receipt` (mevcut `siparislerim/page.tsx`'te zaten kullanılıyor) |
  | Favori Ürünlerim | `Heart` |

**Mobil (`< md`) — üstte yatay kaydırılabilir sekme çubuğu (dropdown DEĞİL):**

Gerekçe: 2-4 arası az sayıda, sabit sekme için açılır menü ekstra bir tıklama katmanı ekler; admin
sidebar'ın mobildeki "sheet/drawer" davranışı burada GEREKSİZ karmaşıklıktır (o, 15+ öğelik tam bir
navigasyon ağacı için var). `Table` bileşeninin zaten kullandığı `overflow-x-auto` deseniyle tutarlı:

```
<nav className="flex gap-2 overflow-x-auto pb-1 md:hidden [-webkit-overflow-scrolling:touch]">
  {tabs.map(tab => (
    <Link className={cn(
      "flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
      active
        ? "border-primary/30 bg-primary/10 text-primary"
        : "border-border text-foreground/70 hover:bg-surface-muted"
    )}>
      <Icon className="h-4 w-4" />{label}
    </Link>
  ))}
</nav>
```

Kaydırma çubuğu görünmez tutulur (native momentum scroll yeterli, `scrollbar-hide` utility'si zaten
yoksa eklenmez — tarayıcı varsayılanı kabul edilir, yeni bir global CSS kuralı gerekmiyor). Masaüstü
`<nav>` (dikey) `hidden md:flex` ile, mobil `<nav>` (yatay) `flex md:hidden` ile karşılıklı gizlenir —
iki ayrı DOM ağacı, tek `isModuleEnabled`/aktif-sekme hesaplamasından beslenir.

---

## 2. Dinamik sekme gizleme — 2 sekmeli denge

`products` kapalıyken liste 4→2'ye düşer (Siparişlerim/Favorilerim DOM'dan tamamen kalkar, mevcut
`filterVisibleNavItems` desenindeki gibi bir filtre fonksiyonu — bkz. `admin/sidebar.tsx`).

**Karar: sol sekme genişliği/hizası SABİT kalır, otomatik ortalama/genişletme YAPILMAZ.**
- `md:w-56` değişmez, 2 öğe de aynı `space-y-1` dikey listede üstte durur (`items-start`, dikeyde
  ortalama yok). Sebep: genişlik "sekme sayısına göre" değişirse kullanıcı modül açıldığında/kapandığında
  (nadir de olsa admin ayar değiştirdiğinde) düzenin "zıplamasını" görür; sabit iskelet her zaman
  aynı yerde durur — bu, admin sidebar'ın rol filtrelemesiyle AYNI ilke (§8.2 yorumu: "gizleme
  kullanılabilirlik amaçlıdır", genişlik hesaplaması buna dahil değil, sabit kalması daha öngörülebilir).
- Sağ içerik kolonu da sabit `max-w-2xl` kalır — 2 sekmeli haldeyken formun aniden genişlemesi/`Card`
  boyutunun oynaması İSTENMEZ.
- Mobil yatay çubukta 2 öğe varken `justify-start` (SOL hizalı) kullanılır, `justify-around`/`justify-center`
  KULLANILMAZ — az öğeli haldeyken ortalanmış 2 sekme "eksik/kırık" bir görünüm verir; sol hizalı akış
  4 öğeliyken de 2 öğeliyken de aynı okuma davranışını korur.
- Alt boşluk: kısa listenin altında kalan boş alan DOLDURULMAZ (yeni bir dekoratif kart/illüstrasyon
  eklenmez) — sade/flat dilde boş alan sorun değildir, yapay doldurma daha kötü bir sinyal verir.

---

## 3. Adres kartı / formu

**Liste sayfası (`/hesabim/adreslerim`):** başlık bloğu mevcut desende (`h1` + açıklama), sağında birincil
buton `+ Yeni Adres Ekle` (`<Button><Plus className="h-4 w-4"/>Yeni Adres Ekle</Button>`, `flex-wrap
items-start justify-between` — `hesabim/page.tsx`'teki 2FA kart başlığıyla AYNI hizalama deseni).

**Kart ızgarası:** `grid gap-4 sm:grid-cols-2` (20 adres sınırı var, sayfalama yok → 2 kolon en fazla
10 satır eder, kabul edilebilir). Her adres bir `Card` (mevcut `Card` bileşeni, ekstra prop yok,
`interactive` KULLANILMAZ — glow efekti bir liste kartı için gürültü):

```
<Card className="space-y-3">
  <div className="flex items-start justify-between gap-2">
    <div>
      <p className="text-sm font-semibold text-foreground">{address.title}</p>
      <p className="text-sm text-foreground/60">{address.fullName} · {address.phone}</p>
    </div>
    {address.isDefault && (
      <Badge tone="primary">
        <CheckCircle2 className="mr-1 h-3 w-3" />Varsayılan
      </Badge>
    )}
  </div>
  <p className="text-sm leading-relaxed text-foreground/70">
    {address.addressLine1}{address.addressLine2 && `, ${address.addressLine2}`}<br/>
    {[address.neighborhood, address.district, address.city].filter(Boolean).join(" / ")}
    {address.postalCode && ` ${address.postalCode}`}
  </p>
  <div className="flex items-center gap-1 pt-1">
    <Button variant="ghost" size="sm"><Pencil className="h-4 w-4"/>Düzenle</Button>
    <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10"><Trash2 className="h-4 w-4"/>Sil</Button>
    {!address.isDefault && (
      <Button variant="outline" size="sm" className="ml-auto">Varsayılan Yap</Button>
    )}
  </div>
</Card>
```

`Badge tone="primary"` + `CheckCircle2` — Session tablosundaki "Bu cihaz" `Badge tone="primary"` ile
AYNI görsel dil (zaten "bu satır özel/aktif" anlamında kurulu bir ton). Silme, mevcut destructive Button
varyantı yerine burada **ghost + `text-danger`** kullanır (kart içinde ikinci bir dolu-destructive buton
görsel ağırlığı fazla kaçırır); asıl "tehlikeli aksiyon" onayı zaten `ConfirmDialog` ile gelir (mevcut
oturum sonlandırma deseniyle AYNI: `ConfirmDialog` + `destructive` prop, `title="Adresi sil"`).

Boş durum (0 adres): mevcut `EmptyState` bileşeni, `icon={MapPin}`,
`title="Henüz kayıtlı adresiniz yok"`, `description="Sipariş verirken kullanmak üzere bir adres ekleyin."`,
`action` = aynı `+ Yeni Adres Ekle` butonu.

**Form — Dialog içinde, bölümlü (appearance panelindeki gibi):** Yeni ekleme VE düzenleme AYNI `Dialog`
(mevcut `Dialog/DialogContent/DialogHeader/DialogFooter` — 2FA kurulum modalıyla birebir aynı primitive'ler,
`max-w-lg`). Inline sayfa-içi form KULLANILMAZ (kart ızgarasıyla karışır, modal daha temiz bir "tek görev"
akışı verir ve mevcut hesabım sayfasındaki tüm ikincil akışlar zaten modal).

Alan sırası/gruplama (her grup başlığı appearance panelindeki alt-başlık deseni:
`text-xs font-medium tracking-wide text-foreground/50 uppercase`, gruplar arası `space-y-5`):

1. **"Adres Başlığı"** — `title` (Field, placeholder "Ev, İş…", `maxLength` makul bir üst sınır ör. 40).
2. **"Alıcı Bilgileri"** — `fullName`, `phone` (`grid grid-cols-1 gap-4 sm:grid-cols-2` — iki alan yan
   yana, appearance panelindeki iki-kolonlu form satırlarıyla aynı desen).
3. **"Adres"** — `city`, `district` (`sm:grid-cols-2` yan yana) → `neighborhood` (opsiyonel, tek satır)
   → `addressLine1` (tek satır, `textarea` DEĞİL `Input` — mevcut sistemde çok satırlı bir Textarea
   bileşeni bu dosyalarda görülmedi; frontend-agent projede `Textarea` varsa onu addressLine1/2 için
   tercih edebilir, yoksa `Input` yeterlidir) → `addressLine2` (opsiyonel) → `postalCode` (opsiyonel,
   dar genişlik: `sm:grid-cols-2` içinde `district` ile aynı satırda DEĞİL, ayrı tek-alan satırda —
   posta kodu nadiren doldurulur, öne çıkarılmaz).
4. **`country` alanı FORMDA GÖSTERİLMEZ.** Backend `TR` varsayılanını kullanıyor (§5.1) ve v1'de
   çok ülkeli bir akış yok; formda salt-okunur/disabled bir "Türkiye" alanı bile gereksiz görsel
   yüktür. Gövdede alan hiç gönderilmez, backend varsayılanı uygular (bu bir frontend-agent implementasyon
   detayıdır, burada sadece "gösterme" kararı verilir).
5. En altta **"Varsayılan adresim olsun"** — checkbox değil, mevcut sistemde checkbox bileşeni
   görülmedi; bunun yerine küçük bir metin + `Button variant="outline" size="sm"` YERİNE basit bir
   `<label className="flex items-center gap-2 text-sm text-foreground/80"><input type="checkbox" ...
   className="h-4 w-4 rounded border-border accent-primary" />Varsayılan adresim olsun</label>` —
   `accent-primary` native checkbox'ı marka rengine bağlar, yeni bir bileşen İCAT ETMEZ.

Footer: `DialogFooter` → `Vazgeç` (outline) + `Kaydet`/`Adresi Ekle` (`loading` prop, mevcut Button
deseni).

---

## 4. Sipariş durumu rozetleri + kargo takip bilgisi

**`ORDER_STATUS_TONE` genişlemesi:** `Badge` bileşeninin `Tone` union'ında **`"info"` YOKTUR**
(`neutral | primary | success | danger | warning`). Yeni bir `"info"` tonu Badge'e EKLEMEK yerine
(yeni renk = yeni token = mevcut palet dışına çıkmak), **`SHIPPED` mevcut `"primary"` tonunu kullanır.**
`primary` zaten projede "vurgulu ama nötr-pozitif, henüz 'başarı' değil" anlamında kurulu
(`Badge tone="primary"` → Session'da "Bu cihaz", yukarıda adres kartında "Varsayılan") — `PAID`
(success/sarı-yeşil aralığı) ile `FULFILLED` (success/yeşil) arasında ayrışan üçüncü bir görsel kimlik
verir, istekteki "PAID ile FULFILLED arası bir aşama hissi" beklentisini karşılar, YENİ bir renk
tanımlamadan.

| Enum | Etiket (§6, architect kararı — DEĞİŞTİRİLMEZ) | `ORDER_STATUS_TONE` | Gerekçe |
|---|---|---|---|
| `PENDING` | Ödeme Bekleniyor | `warning` | değişmedi |
| `PAID` | Hazırlanıyor | `warning` | **DEĞİŞTİ** (eski: `success`) — "Hazırlanıyor" artık bitmiş bir eylem değil, sürüyor; `success` burada yanıltıcı olur. `warning` = "dikkat/aktif süreç" |
| `SHIPPED` | Kargoda | `primary` | **YENİ** — ara aşama, `Badge` tone genişletmesi gerektirmez |
| `FULFILLED` | Teslim Edildi | `success` | değişmedi (terminal başarı) |
| `FAILED` | Başarısız | `danger` | değişmedi |
| `CANCELLED` | İptal Edildi | `neutral` | değişmedi |
| `EXPIRED` | Süresi Doldu | `neutral` | değişmedi |
| `REFUNDED` | İade Edildi | `neutral` | değişmedi |

**Not (frontend-agent'a):** `PAID` tonunun `success`→`warning` değişimi bu görevin doğal bir parçası
(etiket "Ödendi"den "Hazırlanıyor"a değiştiği için ton da anlamıyla birlikte değişiyor) — admin sipariş
listesi de AYNI sözlüğü kullandığından (`order-status.ts` tek kaynak, CLAUDE.md "ortak terminoloji")
admin tarafında da bu ton değişir, ayrı bir admin-özel ton YOK.

**Sipariş detay sayfası (`/hesabim/siparislerim/[orderId]`) — kargo takip bloğu:**
`PAID`/erken durumlarda blok hiç render edilmez. `SHIPPED`/`FULFILLED` durumunda, mevcut
`ApiKeyRevealDialog`'daki "kopyalanabilir kod bloğu" deseni birebir tekrarlanır:

```
<div>
  <p className="mb-1.5 text-sm font-medium text-foreground">Kargo Takip Numarası</p>
  <div className="flex items-center gap-2">
    <div className="break-all rounded-lg border border-border bg-surface-muted p-3 font-mono text-sm text-foreground/90">
      {order.trackingNumber}
    </div>
    <Button type="button" variant="outline" size="icon" onClick={copyTracking} aria-label="Takip numarasını kopyala">
      <Copy className="h-4 w-4" />
    </Button>
  </div>
  {order.shippingCarrier && (
    <p className="mt-1.5 text-sm text-foreground/60">Taşıyıcı: {order.shippingCarrier}</p>
  )}
</div>
```

`shippingCarrier` DÜZ METİN (kopyalanabilir kutu değil — taşıyıcı adı zaten kısa/serbest metin,
kopyalama ihtiyacı yok, sadece takip NUMARASI kopyalanabilir olmalı). `shippedAt`/`deliveredAt` varsa
mevcut `dateFormatter` (`Intl.DateTimeFormat("tr-TR", {dateStyle:"medium", timeStyle:"short"})`,
`siparislerim/page.tsx`'te zaten tanımlı) ile aynı formatta, takip bloğunun altında ikinci satır
(`text-sm text-foreground/60`) olarak eklenir, ayrı bir bileşen İCAT EDİLMEZ.

Sipariş kalemleri, ara toplam/KDV/toplam blokları mevcut `Card` + `Table` bileşenleriyle,
`siparislerim/page.tsx`'teki tablo başlık stiliyle (`TableHead`/`TableCell`) birebir aynı kalıpta kurulur
— yeni bir "fatura şablonu" bileşeni tasarlanmaz.

---

## 5. Favori ürün kartı

Temel: `components/site/product-card.tsx` (mevcut ürün kartı — görsel + başlık + fiyat düzeni).
Favoriler sayfası için bu kart **genişletilir, yeniden yazılmaz**: aynı görsel/başlık/fiyat bloğu
korunur, altına bir aksiyon şeridi eklenir. Yeni bir kart bileşeni İCAT ETMEK yerine
`ProductCard`'ın `footer`/`actions` slotu opsiyonel bir prop olarak eklenmesi frontend-agent'a önerilir
(prop tasarımı frontend-agent'ın kararı — burada sadece görsel sonuç tanımlanır):

```
<div className="overflow-hidden rounded-lg border border-border">
  {/* ProductCard'ın mevcut görsel+başlık+fiyat bloğu, Link SARMALAYICISI OLMADAN
      (kart tıklaması ürün sayfasına gider, ama alttaki aksiyon şeridi kartın DIŞINDA
      ayrı bir etkileşim alanı olmalı — link'in içine buton koymak a11y açısından sorunludur) */}
  <div className="p-4 pt-3 flex items-center gap-2 border-t border-border">
    <Button size="sm" className="flex-1" onClick={addToCart}>
      <ShoppingCart className="h-4 w-4" />Sepete Ekle
    </Button>
    <Button
      variant="ghost"
      size="icon"
      aria-label="Favorilerden çıkar"
      className="text-danger hover:bg-danger/10"
      onClick={removeFromWishlist}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  </div>
</div>
```

- Kalp ikonu DEĞİL, **`Trash2`** kullanılır: bu sayfa zaten "favorilerim" listesi, üstündeki her ürün
  favori — dolu kalp ikonu burada artık bir "durum" değil "aksiyon" ifade eder, `Trash2` niyeti daha net
  anlatır (`ProductCard`'ın kendisinde/ürün detayında kalp ikonu toggle olarak KALIR, o ayrı bir yüzey).
- Stokta yok (`soldOut`) durumunda `ProductCard`'ın mevcut "Tükendi" rozeti korunur, "Sepete Ekle"
  butonu `disabled` olur (mevcut `Button` `disabled` stiliyle, ekstra bir stil gerekmez).
- Izgara: `grid gap-4 sm:grid-cols-2 lg:grid-cols-3` (ürün listesi sayfalarında kullanılan tipik
  ızgara ölçeğiyle tutarlı — spacing 16px/4px ölçeğinde `gap-4`).
- Boş durum: `EmptyState` `icon={Heart}`, `title="Henüz favori ürününüz yok"`,
  `description="Beğendiğiniz ürünleri favorilerinize ekleyin."`, `action` → `/products`'a giden
  `Button` (mevcut "Ürünlere göz at" linkiyle AYNI metin/stil, `siparislerim/page.tsx`'teki boş durum
  CTA'sıyla tutarlı).

---

## 6. Header'daki sepet/favori ikonları — modül kapalıyken

`SiteHeader`'daki `<div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">` zaten bir
**flex + `gap`** düzenidir (grid/fixed-width değil) — sepet ve favori ikonları `{productsModuleEnabled &&
(...)}` ile koşullu render edildiğinde `gap-x-5` otomatik olarak kapanır, dangling boşluk/hizasızlık
OLUŞMAZ (mevcut `{locales && activeLocale && <LanguageSwitcher/>}` deseniyle AYNI mekanizma — bu zaten
header'da kanıtlanmış bir örüntü). Ekstra bir `w-9` yer tutucu/placeholder EKLENMEZ.

Yeni favori (kalp) ikonu, sepet ikonuyla AYNI buton kalıbında eklenir (`h-9 w-9 rounded-lg` ikon-buton,
`hover:bg-surface-muted`) — sepetin solunda, aralarında mevcut `gap-x-5` boşluğu:

```
{productsModuleEnabled && status === "authenticated" && (
  <Link href={localize("/hesabim/favorilerim")} aria-label="Favorilerim"
    className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-surface-muted hover:text-foreground">
    <Heart className="h-5 w-5" />
  </Link>
)}
```

Rozet (adet sayacı) EKLENMEZ — sepetteki gibi bir sayısal rozet favori için gerekli değil (favori adedi
işlem hızını etkilemez, sepetteki gibi "ne kadar harcayacağım" kaygısı yaratmaz); görsel gürültüyü
azaltmak için bilinçli fark.

---

## 7. Bilgilendirme/toast metinleri (öneri, zorunlu değil)

| Senaryo | Metin | Ton |
|---|---|---|
| `/login?next=` ile başarılı girişten sonra korumalı bir `/hesabim/*` sayfasına dönüş | (toast YOK — sessiz yönlendirme; giriş sonrası her başarılı girişte toast göstermek gürültü olur, mevcut login akışında böyle bir toast örneği de yok) | — |
| CUSTOMER/USER `/admin`'e gidip `/hesabim/profil`'e yönlendirildiğinde | `"Bu alana erişim yetkiniz yok, hesap sayfanıza yönlendirildiniz."` | `toast.error` (mevcut `sonner` — `friendlyErrorMessage` akışlarında kullanılan aynı kütüphane) |
| `/hesabim/siparislerim` veya `/hesabim/favorilerim`'e modül kapalıyken doğrudan gidildiğinde | `"Bu bölüm şu anda kullanılamıyor."` | `toast.info`'nun karşılığı olmadığından (`sonner`'da `toast()` nötr varsayılan) düz `toast("Bu bölüm şu anda kullanılamıyor.")` — hata rengi (`toast.error`) KULLANILMAZ, bu bir hata değil bir durum bilgisidir |

Bu üç metin frontend-agent tarafından ilgili `redirect`/`router.replace` çağrısının yanında
tetiklenebilir; toast göstermek §4.3/§7.3'teki guard mantığını DEĞİŞTİRMEZ, salt bilgilendirme
katmanıdır — architect dokümanındaki yönlendirme kararlarıyla çelişmez.

---

## 8. Spacing/tipografi özeti (tekrar, tek yerde toplu)

- Kart iç boşluk: mevcut `Card` `p-6` (24px) korunur, kart-içi bölüm aralığı `space-y-4`/`space-y-6`
  (16/24px) — hesabım sayfasındaki mevcut ölçekle AYNI, yeni bir ölçek İCAT EDİLMEZ.
  Adres kartı gibi daha yoğun liste kartlarında `space-y-3` (12px) kabul edilir (mevcut ölçekte zaten
  var, bkz. `Card className="space-y-4"` örnekleri + Tailwind'in 3=12px basamağı).
  Form grupları arası `space-y-5` (20px) — mevcut `Field` bileşeninin kendi `space-y-1.5` (label-input
  arası) ile çakışmayan bir üst seviye ayraç.
- İkon boyutu: `h-4 w-4` satır-içi/buton ikonları, `h-5 w-5` header ikon-butonları, `h-10 w-10`/`h-11 w-11`
  boş durum ikon rozetleri — hepsi mevcut kod tabanında zaten kullanılan üç sabit boyut, dördüncüsü
  eklenmez.
- Köşe yuvarlama: `rounded-lg` (kart/buton/input, mevcut varsayılan), `rounded-full` (Badge/rozet,
  mevcut varsayılan) — değişmez.
