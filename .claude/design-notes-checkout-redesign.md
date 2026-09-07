# Tasarım Notları — Checkout Yeniden Tasarımı (2 Sütunlu Akış)

Durum: v1 (2026-09-07) · Sahibi: ui-designer
Girdi: `.claude/architect-scope-checkout-redesign.md` §6.1 (BAĞLAYICI — rota/kontrat/veri
kararları burada tekrar edilmez, yalnızca görsel karar üretilir).
Uygulayıcı: frontend-agent. Kod YAZILMAMIŞTIR — bu dosya sadece karar setidir.

**Görsel yön:** Proje zaten **A) Minimal/Flat** — `Card` (`bg-surface/70` + `border-border/60` +
`backdrop-blur-xl`, hafif bir yüzey blur'u var ama sistemik bir "cam" estetiği DEĞİL),
`Button`/`Input`/`Checkbox` düz kenarlıklı base-ui primitifleri. Bu doküman bu dili KIRMAZ —
yeni gradient, ambient `blur-xl` glow, yeni renk tonu İCAT EDİLMEZ. `(site)` scope'u
`.site-scope` altında olduğu için `--primary`/`--ring`/`--accent` zaten `--site-primary`/
`--site-accent`'e bağlı (`globals.css:504-520`) — mağaza sahibinin marka rengini otomatik
miras alır, ayrı bir "checkout rengi" TANIMLANMAZ. `--site-radius` kontratı (`design-notes-
ecommerce-storefront.md` §0) burada da geçerlidir: her buton/kart-benzeri interaktif yüzeyde
`rounded-[var(--site-radius)]` override zorunludur.

**Kaynak bulgular (bu doküman bunları icat etmiyor, mevcut kod tabanından devşiriyor):**
`components/ui/{card,field,input,alert,button,checkbox,accordion,dialog,tabs,badge}.tsx`,
`components/site/{cart-drawer,free-shipping-progress}.tsx`, `design-notes-ecommerce-
storefront.md` (§0, §5, §6, §7), `design-notes-customer-portal.md` (§3, §8).

---

## 0. Önemli bir netleştirme — "Kargo Yöntemi" bölümü YOKTUR

Görev tanımında sol sütun bölümleri arasında "kargo yöntemi" sayılıyor, ancak architect scope
§6.2'nin bağlayıcı dosya listesinde (`contact-section.tsx`, `shipping-address-section.tsx`,
`billing-section.tsx`, `order-summary-card.tsx`, `legal-consent-section.tsx`,
`preliminary-info-modal.tsx`) bir kargo bölümü/component'i YOK — çünkü kargo hesap mantığı
(`computeShipping`) DEĞİŞMİYOR (§2 tablosu, "Kargo hesabı → DEĞİŞMEZ") ve kullanıcının seçtiği
birden fazla taşıyıcı/yöntem KONTRATTA yok, tek bir hesaplanmış ücret var. **Karar: ayrı bir
"Kargo Yöntemi" Card/bölüm EKLENMEZ.** Kargo bilgisi yalnızca sipariş özeti kartında (§5) bir
satır olarak gösterilir. Sol sütun **3 bölümden** oluşur: İletişim, Teslimat Adresi, Fatura
Bilgileri.

---

## 1. Kırılma noktası, grid, konteyner

**Konteyner:** `mx-auto max-w-6xl px-4 py-10 sm:px-6` — mevcut `max-w-lg` tek-kutu
konteynerinin yerini alır (2 sütun için gerekli genişlik). Boş sepet / yükleniyor durumları
DEĞİŞMEZ, onlar hâlâ `mx-auto max-w-lg px-4 py-16 sm:px-6` (tek, ortalanmış mesaj — 2 sütun
gerektirmiyor).

**Grid:**
```
<div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-10">
  <div className="space-y-6">{/* sol sütun: 3 Card */}</div>
  <div className="lg:sticky lg:top-24 lg:self-start">{/* sağ sütun */}</div>
</div>
```

- Kırılma noktası **`lg`** (1024px) — mevcut PDP (`product-purchase-panel.tsx:41`) ve katalog
  sidebar'ının (`catalog-sidebar.tsx:88`) AYNI kırılma noktası ve **birebir aynı sticky ofseti**
  (`lg:sticky lg:top-24 lg:self-start`) — projede zaten "header'ın altında sabitlenen sağ panel"
  için kurulu bir örüntü, yeni bir değer İCAT EDİLMEDİ.
- Sağ sütun genişliği **`420px`** — architect'in önerisi `380px`'ti (§6.1, bağlayıcı değil,
  "sen kendi kararını ver" diye bırakılmış). **Bilinçli sapma:** projede zaten iki yerde
  oturmuş bir "sağ panel" ölçüsü var — sepet çekmecesi `sm:max-w-[420px]`
  (`design-notes-ecommerce-storefront.md` §6) ve appearance panel önizleme sütunu
  `lg:w-[420px]` (`design-notes-appearance-panel.md` §0). Üçüncü bir sağ-panel ölçüsü
  (380px) eklemek yerine mevcut 420px'e katılmak tutarlılığı artırır.
- Sol sütun matematik kontrolü: `1152px (max-w-6xl) − 420px (sağ) − 40px (gap-10) ≈ 692px` —
  form okunabilirliği için uygun (ne PDP kadar dar ne katalog kadar geniş).
- Mobil (`< lg`): tek sütun, sağ sütun sticky DEĞİL, DOM sırasına göre sol sütunun ALTINA akar
  (CSS Grid `grid-cols-1`'de ek bir `order-*` sınıfı GEREKMEZ — JSX'te sağ sütun zaten sol
  sütundan SONRA yazılır).

---

## 2. Mobilde sipariş özetine erken erişim — Accordion "peek"

Mevcut sayfa bugün formdan ÖNCE bir "Ara Toplam" `Card`'ı gösteriyor (`page.tsx:95-100`) — bu
davranışsal emsal tamamen kaldırılmaz, **Accordion'a** (mevcut `components/ui/accordion.tsx`
primitifi, yeni bir collapse mekanizması İCAT EDİLMEZ) taşınır:

```
<div className="lg:hidden">
  <Accordion>
    <AccordionItem>
      <AccordionTrigger>
        <span className="flex flex-1 items-center justify-between pr-2">
          <span>Sipariş Özeti ({itemCount} ürün)</span>
          <span className="font-semibold text-foreground">{formatPriceFromCents(cart.totalCents, ...)}</span>
        </span>
      </AccordionTrigger>
      <AccordionPanel className="border-t border-border/60 p-4">
        {/* FreeShippingProgress + ürün satırları + ara toplam/kargo/toplam — §5'in AYNISI,
            legal checkbox'lar ve CTA HARİÇ */}
      </AccordionPanel>
    </AccordionItem>
  </Accordion>
</div>
```

Bu blok sayfanın EN ÜSTÜNDE, İletişim bölümünden ÖNCE, yalnızca `lg:hidden` (masaüstünde sağ
sütun zaten görünür durumda, ikinci bir kopya GEREKMEZ). Varsayılan durum **kapalı**
(`defaultValue` boş) — kullanıcı formu doldururken içerik tıkanmasın. Bu, tam detaylı sipariş
özetinin sayfanın SONUNDA (§5, sağ sütun, mobilde sol sütunun altına akan blok) yeniden
göründüğü anlamına gelir — bu **bilinçli bir tekrar**, ilki "hızlı hatırlatma", ikincisi "ödeme
öncesi son onay" işlevi görür (Shopify/Stripe Checkout'un ikisinde de aynı ikili patern var).

---

## 3. Sol sütun — bölüm ritmi

3 ayrı `Card` (mevcut primitif, ekstra prop yok), aralarında `space-y-6` (24px, `Card`'ın
kendi `p-6`'sıyla aynı ölçek basamağı). Her Card başlığı **numaralı rozet + h2** — tek adımlı
bir formda bile kullanıcıya "neredeyim" hissi verir (Stripe/Vercel'in yoğun formlarında standart):

```
<div className="mb-4 flex items-center gap-2.5">
  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
    1
  </span>
  <h2 className="text-base font-semibold text-foreground">İletişim</h2>
</div>
```

Card içi alan aralığı `space-y-4` (16px) — mevcut checkout formunun bugünkü `space-y-4`'üyle
AYNI, yeni bir ölçek İCAT EDİLMEDİ. İki alanın yan yana durduğu satırlar (ad soyad/telefon,
il/ilçe) `grid grid-cols-1 gap-4 sm:grid-cols-2` — `design-notes-customer-portal.md` §3'teki
adres formu deseniyle BİREBİR aynı.

**Kart 1 — İletişim** (`contact-section.tsx`):
- `customerEmail` (`Field id="customerEmail"`, required)
- `customerName` (`Field id="customerName"`, opsiyonel)
- Telefon BURADA YOK — kontrat telefonu her adres bloğunun kendi `phone` alanı olarak taşıyor
  (§5.2), İletişim yalnızca e-posta/ad soyad'tan sorumlu (bugünkü sayfayla birebir aynı kapsam).

**Kart 2 — Teslimat Adresi** (`shipping-address-section.tsx`), alan sırası (id'ler §5.2'deki
Zod yollarıyla BİREBİR — `error.details` eşlemesi bunlara bağlı):
1. `shippingAddress.fullName` + `shippingAddress.phone` (2-kolon)
2. `shippingAddress.city` + `shippingAddress.district` (2-kolon)
3. `shippingAddress.neighborhood` (tek satır)
4. `shippingAddress.addressLine1` (tek satır)
5. `shippingAddress.addressLine2` (tek satır, `hint="Opsiyonel."`)
6. `shippingAddress.postalCode` — dar genişlik, `<div className="sm:max-w-[200px]"><Field .../></div>`
   (posta kodu 5 haneli, tam genişlik gereksiz — `design-notes-customer-portal.md` §3 madde 3
   ile AYNI karar)
7. `country` alanı FORMDA GÖSTERİLMEZ (backend `"TR"` varsayılanı — customer-portal §3 madde 4
   ile BİREBİR aynı gerekçe: v1 çok ülkeli akış yok, salt-okunur bir alan bile gereksiz yük).

**Kart 3 — Fatura Bilgileri** (`billing-section.tsx`) — bkz. §4.

---

## 4. Bireysel/Kurumsal seçici + "aynı adres" checkbox

**Karar: segmented control GÖRÜNÜMÜNDE bir radio grubu** — mevcut `Tabs`/`TabsList`
bileşeninin KENDİSİ DEĞİL (Tabs, ARIA `tablist` semantiğiyle bağımsız içerik panelleri
değiştirmek içindir; burada gerçek, zorunlu bir form alanı — `billing.billingType` —
seçiliyor, `role="tab"` semantiği yanıltıcı olur). Bunun yerine `TabsList`'in **varsayılan
(`default`) varyantının görsel dili native `<input type="radio">` üzerine giydirilir** —
projede ayrı bir `RadioGroup` primitifi henüz yok, en yakın kurulu görsel dil budur:

```
<div role="radiogroup" aria-label="Fatura Tipi" className="flex h-8 w-full items-center rounded-lg bg-muted p-[3px]">
  <label className={cn(
    "relative flex h-[calc(100%-1px)] flex-1 cursor-pointer items-center justify-center rounded-md text-sm font-medium transition-all",
    "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
    isIndividual ? "bg-background text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground"
  )}>
    <input type="radio" value="INDIVIDUAL" className="peer sr-only" {...register("billing.billingType")} />
    Bireysel
  </label>
  <label className={/* aynı desen, isCorporate */}>
    <input type="radio" value="CORPORATE" className="peer sr-only" {...register("billing.billingType")} />
    Kurumsal
  </label>
</div>
```

Native `<input>` `sr-only` olduğundan klavye odağı `peer-focus-visible:ring-3
peer-focus-visible:ring-ring/50` ile **etikete** taşınır — `Input`/`Button`'daki `ring-3
ring-ring/50` odak halkasıyla AYNI token, yeni bir odak stili İCAT EDİLMEDİ. İki segment de
`flex-1` (tam genişlik, eşit pay) — mobil/masaüstü aynı.

**"Fatura adresim teslimat adresimle aynı" checkbox'ı** — segmented control'ün ÜSTÜNDE,
Kart 3'ün en başında (kullanıcı önce "aynı mı değil mi" kararını verir, sonra fatura TİPİNİ
seçer — mantıksal akış sırası budur, adres tipi/adres alanları fatura TİPİNDEN bağımsızdır):

```
<label className="mb-5 flex items-center gap-2.5 text-sm font-medium text-foreground">
  <Checkbox checked={sameAsShipping} onCheckedChange={...} />
  Fatura adresim teslimat adresimle aynı
</label>
```

Varsayılan **işaretli** (`true`) — backend'in `sameAsShipping !== false` varsayılan davranışıyla
(§5.3 madde 3) tutarlı. **İşaret kaldırıldığında** ("değil" durumu), Teslimat Adresi Kartı'ndaki
BİREBİR aynı 7 alan seti (§3 Kart 2, ama `billing.address.*` id'leriyle) belirir:

```
<div className="mt-4 space-y-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
  {/* billing.address.fullName + billing.address.phone (2-kolon) → city+district (2-kolon)
      → neighborhood → addressLine1 → addressLine2 → postalCode (dar) */}
</div>
```

`animate-in fade-in-0 slide-in-from-top-1 duration-200` — YENİ bir animasyon İCAT EDİLMEDİ,
`design-notes-appearance-panel.md:220`'deki "seçiliyken açılan ek alanlar" deseninin BİREBİR
aynısı (proje genelinde koşullu form alanı açılışı için zaten kurulu tek konvansiyon). Bu blok
`bg-surface-muted` kutusuna SARILMAZ (aşağıdaki kurumsal blok'tan farklı olarak) — çünkü bunlar
"asıl" zorunlu adres alanları, ikincil bir detay kümesi değil; Teslimat Adresi kartındaki
alanlarla AYNI görsel ağırlıkta durmalı.

**Segmented control'ün ALTINDA, seçime göre koşullu alanlar:**

`CORPORATE` seçiliyken (§5.2 kural 1 — zorunlu alanlar):
```
<div className="mt-4 space-y-4 rounded-lg border border-border/60 bg-surface-muted/50 p-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
  <Field id="billing.companyName" label="Firma Unvanı" required .../>
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <Field id="billing.taxOffice" label="Vergi Dairesi" hint="Opsiyonel." .../>
    <Field id="billing.taxNumber" label="Vergi No" required .../>
  </div>
</div>
```
Aynı `animate-in`/`slide-in-from-top-1` deseni, ama `rounded-lg border border-border/60
bg-surface-muted/50 p-4` KUTUSUYLA — 3 alanlık bir "ek bilgi kümesi" olduğu için appearance
panelindeki `BANNER` bloğuyla (`design-notes-appearance-panel.md:223`) BİREBİR aynı kutulama.

`INDIVIDUAL` seçiliyken (§5.2 — opsiyonel, PII, kutu YOK, tek alan hafif kalsın):
```
<div className="mt-4 animate-in fade-in-0 slide-in-from-top-1 duration-200">
  <Field id="billing.nationalId" label="T.C. Kimlik No" hint="Fatura için girebilirsiniz (opsiyonel)." .../>
</div>
```
Kutu YOK — tek, opsiyonel bir alanı 3-alanlık kurumsal bloğuyla AYNI görsel ağırlıkta sunmak
yanlış bir önem sinyali verirdi.

---

## 5. Sipariş özeti kartı (sağ sütun, `order-summary-card.tsx`)

Tek `Card`, iç yapı (üstten alta):

```
┌ "Sipariş Özeti" başlığı + "Sepeti düzenle" linki (sağda) ─────┐
├ (submitError varsa) Alert variant="error" ─────────────────────┤
├ FreeShippingProgress (yalnızca shipping.configured) ───────────┤
├ Ürün satırları (salt okunur — adet steppera YOK) ───────────────┤
├ Ara Toplam / Kargo / Toplam ─────────────────────────────────┤
├ (legal-consent-section.tsx) 2 onay checkbox'ı ─────────────────┤
├ CTA butonu + güven mikro-metni ─────────────────────────────────┤
└──────────────────────────────────────────────────────────────┘
```

**Başlık satırı:**
```
<div className="mb-4 flex items-center justify-between">
  <h2 className="text-base font-semibold text-foreground">Sipariş Özeti</h2>
  <Link href={localize("/cart")} className="text-sm text-primary hover:underline">Sepeti düzenle</Link>
</div>
```

**Hata (`Alert`) yerleşimi:** başlığın HEMEN ALTINDA, kartın en görünür noktası — bu kartın
tamamı zaten "ödeme öncesi son bakış" alanı, 409/ağ hatası burada kaçırılmamalı. Mevcut
`Alert variant="error"` birebir (`AlertCircle` ikonu, bugünkü sayfadaki desenin AYNISI).

**Ürün satırları** — `cart-drawer.tsx:123-177`'deki satır düzeninin SALT-OKUNUR versiyonu (adet
+/− butonları YOK, çünkü sepeti değiştirmek bu sayfanın işi değil — "Sepeti düzenle" linki bu
işlevi zaten `/cart`'a devrediyor):
```
<div className="flex gap-3 border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0">
  <img src={item.product.coverImageUrl} className="h-16 w-16 shrink-0 rounded-[var(--site-radius)] object-cover" />
  <div className="min-w-0 flex-1">
    <p className="truncate text-sm font-medium text-foreground">{item.product.title}</p>
    {item.variantLabel && <p className="text-xs text-foreground/60">{item.variantLabel}</p>}
    <p className="text-xs text-foreground/60">Adet: {item.quantity}</p>
  </div>
  <span className="shrink-0 text-sm font-semibold text-foreground">{formatPriceFromCents(item.lineTotalCents, ...)}</span>
</div>
```
(`cart-drawer.tsx`'teki `p-4 border-b` yerine `py-3 border-b` — kart zaten kendi `p-6`
dolgusuna sahip, ikinci bir yatay dolgu GEREKMEZ.)

**Ara Toplam / Kargo / Toplam** — `cart-drawer.tsx:182-200` ile AYNI hiyerarşi, tek fark:
Toplam satırı checkout'ta ödeme anının son onayı olduğu için biraz daha güçlü:
```
<div className="space-y-2 border-t border-border pt-4">
  <div className="flex items-center justify-between text-sm text-foreground/70">
    <span>Ara Toplam</span><span>{formatPriceFromCents(cart.subtotalCents, ...)}</span>
  </div>
  {cart.shipping.configured && (
    <div className="flex items-center justify-between text-sm text-foreground/70">
      <span>Kargo</span>
      <span className={cart.shipping.feeCents === 0 ? "font-medium text-success" : undefined}>
        {cart.shipping.feeCents === 0 ? "Ücretsiz" : formatPriceFromCents(cart.shipping.feeCents, ...)}
      </span>
    </div>
  )}
  <div className="flex items-center justify-between border-t border-border pt-2 text-foreground">
    <span className="text-base font-semibold">Toplam</span>
    <span className="text-lg font-bold">{formatPriceFromCents(cart.totalCents, ...)}</span>
  </div>
</div>
```
`shipping.configured === false` → Kargo satırı HİÇ render edilmez (mevcut kural, regresyon
qa-agent §9.9 madde 9 ile birebir). `FreeShippingProgress`, ürün satırlarının ÜSTÜNDE
(`cart-drawer.tsx`'teki AYNI konum — header'ın altı, listenin üstü).

---

## 6. Yasal onay satırları (`legal-consent-section.tsx`)

**Bu bileşen kendi `Card`'ını AÇMAZ** — Sipariş Özeti Card'ının İÇİNE, toplam bloğunun ALTINA,
bir ayraçla yerleştirilir (`border-t border-border/60 pt-4 mt-1`). İki dosya ayrı olsa da
(architect §6.2 dosya listesi) tek bir görsel "onayla ve öde" alanı oluştururlar.

İki checkbox, her biri `Checkbox` primitifi + satır içi link:

```
<div className="space-y-3 border-t border-border/60 pt-4">
  <label className="flex items-start gap-2.5 text-sm text-foreground/80">
    <Checkbox className="mt-0.5" {...register("distanceSalesApproved")} />
    <span>
      <Link href={distanceSalesPageHref} target="_blank" className="text-primary underline-offset-4 hover:underline">
        Mesafeli Satış Sözleşmesi
      </Link>
      'ni okudum, onaylıyorum.
    </span>
  </label>
  {errors.distanceSalesApproved && (
    <p role="alert" className="pl-6 text-xs text-danger">{errors.distanceSalesApproved.message}</p>
  )}

  <label className="flex items-start gap-2.5 text-sm text-foreground/80">
    <Checkbox className="mt-0.5" {...register("preliminaryInfoApproved")} />
    <span>
      Ön Bilgilendirme Formu'nu okudum, onaylıyorum.{" "}
      <button type="button" onClick={openPreliminaryModal} className="text-primary underline-offset-4 hover:underline">
        (Özeti görüntüle)
      </button>
    </span>
  </label>
  {errors.preliminaryInfoApproved && (
    <p role="alert" className="pl-6 text-xs text-danger">{errors.preliminaryInfoApproved.message}</p>
  )}
</div>
```

**Link stili:** `text-primary underline-offset-4 hover:underline` — `Button`'ın `variant="link"`
sınıflarıyla BİREBİR aynı token seti, yeni bir link stili İCAT EDİLMEDİ. Sayfa bulunamazsa
(`resolveDistanceSalesPage` `null` dönerse) link RENDER EDİLMEZ, metin düz kalır (`legal-
pages.ts`'in `resolveReturnsPolicyPage` felsefesiyle BİREBİR aynı — §3.6 mimari kararı).

**Hata metni:** Field bileşeninin `error` paragrafıyla (`field.tsx:42-46`) AYNI sınıflar
(`text-xs text-danger`, `role="alert"`) manuel olarak tekrarlanır — **`Field` SARMALAYICISI
KULLANILMAZ** (checkbox+link kombinasyonu `Field`'ın `children` render-prop şekline uymuyor,
tek bir input elemanı beklüyor). Bu, görev tanımının 8. maddesindeki "yeni hata stili
tanımlama" kısıtına UYAR — stil aynı, sadece kullanım yeri Field dışı. `pl-6` girintisi
checkbox genişliği (`size-4`) + `gap-2.5` ile hizalanır, hata metni link/checkbox'ın
ALTINDA değil metnin başladığı noktanın hizasında durur.

### "Ön Bilgilendirme Özeti" modalı (`preliminary-info-modal.tsx`)

Mevcut `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter` primitifleri
kullanılır (`customer-portal`'daki adres formu modalıyla AYNI aile), ama varsayılan
`max-w-sm` (384px) bir "özet" için dar — `className="sm:max-w-lg"` ile genişletilir
(`design-notes-customer-portal.md` §3'teki adres formu modalıyla AYNI genişletme kararı).

```
<DialogContent className="sm:max-w-lg">
  <DialogHeader>
    <DialogTitle>Ön Bilgilendirme Özeti</DialogTitle>
    <DialogDescription>Onayınız öncesinde sipariş bilgilerinizi gözden geçirin.</DialogDescription>
  </DialogHeader>

  <div className="max-h-[60vh] space-y-1 overflow-y-auto text-sm">
    {/* dinamik "makbuz" listesi — frontend'in ürettiği, mimari karar §3.6 */}
    <div className="flex justify-between border-b border-border/60 py-1.5">
      <span className="text-foreground/60">Alıcı</span><span className="text-foreground">{fullName}</span>
    </div>
    <div className="flex justify-between border-b border-border/60 py-1.5">
      <span className="text-foreground/60">Teslimat Adresi</span>
      <span className="text-right text-foreground">{addressOneLine}</span>
    </div>
    <div className="flex justify-between border-b border-border/60 py-1.5">
      <span className="text-foreground/60">Fatura Tipi</span><span className="text-foreground">{billingType === "CORPORATE" ? "Kurumsal" : "Bireysel"}</span>
    </div>
    <div className="flex justify-between border-b border-border/60 py-1.5">
      <span className="text-foreground/60">Kargo</span><span className="text-foreground">{shippingLabel}</span>
    </div>
    <div className="flex justify-between py-1.5 font-semibold">
      <span>Toplam</span><span>{formatPriceFromCents(cart.totalCents, ...)}</span>
    </div>
  </div>

  {preliminaryInfoPage && (
    <a href={buildPageUrl(preliminaryInfoPage)} target="_blank" rel="noreferrer"
       className="flex items-center gap-3 rounded-[var(--site-radius)] border border-border p-3 hover:border-primary/40 transition-colors">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--site-radius)] bg-accent/10 text-accent">
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{preliminaryInfoPage.title}</span>
      <ExternalLink className="h-4 w-4 shrink-0 text-foreground/40" />
    </a>
  )}

  <DialogFooter>
    <DialogClose render={<Button variant="outline" />}>Kapat</Button>
  </DialogFooter>
</DialogContent>
```

**Neden tam sözleşme metni GÖMÜLMÜYOR:** §3.6 "bağlantı verilen sözleşme metni" ifadesi —
sözleşmenin kendisi zaten bir LİNKTİR, admin'in `Page` içeriğini (page-builder blokları) bir
modal içinde yeniden render etmek ayrı bir render motoru gerektirir ve mimari kararla
çelişmez ama gereksiz karmaşıklık ekler. Link kartı `design-notes-ecommerce-storefront.md`
§8'deki "PDF döküman kartı" deseninin BİREBİR aynısı (`FileText` ikon kutusu, `bg-accent/10
text-accent`) — yeni bir kart stili İCAT EDİLMEDİ. `preliminaryInfoPage === null` ise bu blok
HİÇ render edilmez (link atlanır, §3.6 kararı).

---

## 7. CTA — "Güvenli Ödemeye Geç"

**Sabit alt bar YOK** (mobil dahil) — gerekçe: mobilde tam detaylı Sipariş Özeti kartı zaten
sayfanın SONUNDA (§1/§2), form dolduruktan hemen sonra doğal akışta karşılaşılıyor; ikinci bir
sabit çubuk (a) `design-notes-ecommerce-storefront.md` §7'nin zaten işaret ettiği
`cookie-consent-banner.tsx` `z-50`/`bottom-0` çakışma riskini checkout gibi kritik bir sayfada
tekrar açar, (b) mobildeki erken Accordion "peek" (§2) zaten kullanıcıya toplamı erken gösterme
ihtiyacını karşılıyor — üçüncü bir yüzey gereksiz.

```
<Button type="submit" size="lg" loading={isSubmitting} className="mt-4 w-full rounded-[var(--site-radius)]">
  <Lock className="h-4 w-4" />
  Güvenli Ödemeye Geç
</Button>
<p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-foreground/50">
  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
  256-bit SSL ile şifrelenmiş güvenli ödeme
</p>
```

- `size="lg"` (mevcut `Button` varyantı, `h-9` — projedeki en büyük buton boyutu, yeni bir
  boyut İCAT EDİLMEDİ), `variant="default"` (solid, `--site-primary`), tam genişlik.
  `rounded-[var(--site-radius)]` override ZORUNLU (§0 kontratı).
- İkon `Lock` (lucide) — mevcut `CreditCard` yerine: "ödeme" değil "güvenli onay" anını
  vurgular (bu artık bir ödeme formu değil, adres/onay formu — asıl kart bilgisi girişi
  Stripe'ta).
- Güven mikro-metni (`ShieldCheck` + küçük gri metin) — Stripe/Vercel'in ödeme CTA'larının
  altında standart olan "güven sinyali" deseni; YENİ bir renk/ikon YOK, mevcut `text-foreground/50`
  ikincil metin tonu.
- Buton `disabled` DEĞİL onay kutuları işaretlenmeden — `type="submit"` her zaman aktif kalır,
  eksik onay 422/RHF `required` validasyonuyla checkbox altında (§6) gösterilir (disabled buton
  "neden tıklanamıyor" sorusunu cevapsız bırakır — `ecommerce-storefront.md` §7'deki "Seçenek
  Seç" kararıyla AYNI ilke).

---

## 8. Hata/odak durumları — özet (yeni stil İCAT EDİLMEDİ)

| Yüzey | Kullanılan mevcut stil | Not |
|---|---|---|
| Düz metin alanları (email, ad soyad, adres, firma/vergi) | Mevcut `Field` `error`/`hint` + `Input`'un `aria-invalid:border-destructive aria-invalid:ring-3` | Değişiklik yok — 422 `error.details` → `setError(path, {message})` → `Field` otomatik kırmızı gösterir |
| Segmented control (Bireysel/Kurumsal) | `peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50` (native radio `sr-only`, halka etikete taşınır) | Yeni bir "seçim hatası" stili YOK — `billingType` zaten `z.enum` varsayılanlı, boş kalamaz |
| Checkbox'lar (aynı adres, 2 yasal onay) | Mevcut `Checkbox` (zaten `focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive`) + Field'ın hata paragrafı stili MANUEL tekrarlanır (`text-xs text-danger`, `role="alert"`) | `Field` SARMALAYICISI kullanılmaz (§6) |
| Genel gönderim hatası (409 stok, ağ, rate limit) | Mevcut `Alert variant="error"` | Konum: Sipariş Özeti kartının başlığının hemen altı (§5) — eski sayfada sayfa üstüydü, artık "aksiyon alanı"na taşındı |
| CTA butonu | Mevcut `Button` `disabled`/`loading` prop'ları | disabled edilmez (yukarıdaki gerekçe) |

---

## Özet — Uygulanacak Somut Değerler

| Öğe | Değer |
|---|---|
| Konteyner (form dolu) | `mx-auto max-w-6xl px-4 py-10 sm:px-6` |
| Konteyner (boş/yükleniyor) | `mx-auto max-w-lg px-4 py-16 sm:px-6` (değişmedi) |
| Grid | `grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-10` |
| Sağ sütun sticky | `lg:sticky lg:top-24 lg:self-start` (PDP/katalog ile aynı) |
| Sol sütun Card aralığı | `space-y-6` (24px) |
| Card içi alan aralığı | `space-y-4` (16px) |
| 2-kolon alan grubu | `grid grid-cols-1 gap-4 sm:grid-cols-2` |
| Bölüm başlığı | numaralı rozet (`h-6 w-6 rounded-full bg-primary text-primary-foreground`) + `h2 text-base font-semibold` |
| "Kargo Yöntemi" ayrı bölüm | YOK (§0) — kargo yalnızca sipariş özetinde bir satır |
| Fatura tipi seçici | native radio + `TabsList` default görsel dili (`bg-muted p-[3px]`, seçili `bg-background shadow-sm`) |
| Koşullu alan animasyonu | `animate-in fade-in-0 slide-in-from-top-1 duration-200` (appearance panel emsali) |
| Kurumsal alan kutusu | `rounded-lg border border-border/60 bg-surface-muted/50 p-4` |
| Bireysel (TCKN) alan kutusu | YOK — tek opsiyonel alan, hafif kalır |
| sameAsShipping checkbox | Kart 3 başında, varsayılan işaretli, kaldırılınca 7 alanlık fatura adresi bloğu açılır |
| Sipariş özeti satırı (salt okunur) | `flex gap-3 border-b border-border/60 py-3`, görsel `h-16 w-16 rounded-[var(--site-radius)]` |
| Kargo satırı (ücretsiz) | `text-success font-medium`, "Ücretsiz" |
| Toplam satırı | `text-lg font-bold` (drawer'dan daha güçlü — son onay anı) |
| Mobil "peek" | `Accordion` (mevcut primitif), `lg:hidden`, kapalı varsayılan |
| Legal consent yerleşimi | Sipariş Özeti Card'ının içinde, `border-t border-border/60 pt-4` ile ayrılmış |
| Legal link stili | `text-primary underline-offset-4 hover:underline` (Button `link` varyantıyla aynı) |
| Ön Bilgilendirme modalı | `Dialog` + `className="sm:max-w-lg"`, içerik `max-h-[60vh] overflow-y-auto` |
| Modal içi belge linki | ecommerce-storefront §8 "PDF döküman kartı" deseni (`FileText` ikon kutusu) |
| CTA | `Button size="lg" variant="default"`, `Lock` ikonu, `rounded-[var(--site-radius)]`, tam genişlik, DISABLED edilmez |
| CTA altı güven metni | `ShieldCheck` + `text-xs text-foreground/50`, ortalanmış |
| Sabit alt CTA barı | YOK (§7 gerekçesi) |
| Yeni hata stili | YOK — mevcut `Field`/`Input`/`Checkbox`/`Alert` stilleri yeniden kullanılır (§8) |
