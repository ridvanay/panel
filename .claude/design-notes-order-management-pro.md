# Design Notes — Sipariş Yönetimi Profesyonelleştirme (`/admin/orders/[orderId]`)

> ui-designer çıktısı. Bağlayıcı karar dokümanı: `.claude/architect-scope-order-management-pro.md`
> (özellikle §3, §5.2–§5.4, §7.1). Bu doküman o dokümanın §7.1 maddesini karşılar ve
> frontend-agent'ı (§7.2) doğrudan yönlendirir. Kod implementasyonu frontend-agent'ındır —
> **istisna:** `frontend/src/components/ui/button.tsx`'e yeni `success` varyantı BEN ekledim
> (aşağıda §1), architect §10 tablosundaki tek yetkilendirme budur.

---

## 1. "Siparişi Onayla" için yeşil eylem — `success` varyantı EKLENDİ

`frontend/src/components/ui/button.tsx`'e `destructive`/`warning` ile **birebir aynı desende**
yeni bir `success` varyantı eklendi:

```ts
success:
  "bg-success/10 text-success hover:bg-success/20 focus-visible:border-success/40 focus-visible:ring-success/20 dark:bg-success/20 dark:hover:bg-success/30 dark:focus-visible:ring-success/40",
```

Kullanılan tokenlar `--success`/`--success-foreground` (`globals.css:33,41` light / `:290-291` dark)
**ZATEN mevcut** ve `@theme` üzerinden `--color-success`/`--color-success-foreground` olarak
Tailwind'e bağlı (`globals.css:94-95`) — `bg-success`/`text-success` sınıfları `badge.tsx` ve
`alert.tsx`'te zaten kullanılıyor, yeni bir token TANIMLANMADI.

**Gerekçe (architect §7.1 madde 1 ile birebir):** `default` (primary) KULLANILMADI çünkü primary
site sahibinin değiştirebildiği aksan rengidir; "onay = yeşil" semantiği garanti edilemez. Mevcut
bir varyanta (`outline` vb.) eşlemek yerine yeni varyant eklendi çünkü "Siparişi Onayla" projede
**net bir olumlu/geri-dönüş eylemi** ve gelecekte başka onay eylemlerinde de (ör. yorum onayı,
başvuru onayı) tekrar kullanılabilecek bir birinci sınıf varyant olmalı — `destructive`/`warning`
projede zaten bu şekilde ayrı varyantlar olarak var, `success` üçlüyü tamamlıyor.

**Kullanım (frontend-agent için):**
```tsx
<Button variant="success" onClick={...}>
  <PlayCircle className="h-4 w-4" />
  Siparişi Onayla
</Button>
```

Ham hex renk kodu YAZILMADI — yalnızca mevcut CSS custom property zinciri kullanıldı.

---

## 2. `ON_HOLD` için Badge tonu — `"warning"`

`frontend/src/lib/order-status.ts::ORDER_STATUS_TONE` içine:

```ts
ON_HOLD: "warning",
```

**Gerekçe:** `PENDING` ve `PAID` de `"warning"` kullanıyor — bu üçü ortak bir aile: "sürüyor, admin
takibi altında, henüz kapanmamış" durumlar. `ON_HOLD` bunlardan biri: askıya alınmış bir sipariş
**hata değildir** (o `"danger"` — `FAILED` içindir) ve **bitmiş de değildir** (o `"success"` —
yalnızca `FULFILLED`). `ON_HOLD` = "dikkat gerektiren, aktif operasyon" → `warning` ailesiyle aynı
görsel dil. Yeni bir `Tone` değeri İCAT EDİLMEDİ (`Tone` union'ı `badge.tsx:4`'te sabit).

Diğer 8 mevcut etiket/ton **DEĞİŞMEZ** — yalnızca `ORDER_STATUS_LABELS.ON_HOLD = "Askıya Alındı"`
ve `ORDER_STATUS_TONE.ON_HOLD = "warning"` eklenir (§3.1 tek sözlük kuralı).

---

## 3. Üst eylem çubuğu — gruplama, sıralama, taşma, mobil

### 3.1 Buton–varyant–ikon eşlemesi (TAM liste)

| Buton | Varyant | İkon (`lucide-react`) | Görünür olduğu durum | Rol |
|---|---|---|---|---|
| İptal Et | `destructive` | `XCircle` | `PENDING`, `ON_HOLD` | ADMIN |
| Askıya Al | `warning` | `PauseCircle` | `PAID` | ADMIN |
| İade Et | `outline` | `RotateCcw` | `PAID`, `SHIPPED`, `FULFILLED`, `ON_HOLD` | ADMIN + MANAGER (değişmez) |
| Kargoya Ver | `outline` | `Truck` | `PAID` | ADMIN + MANAGER (değişmez) |
| Siparişi Onayla | `success` | `PlayCircle` | `ON_HOLD` | ADMIN |
| Tamamlandı Olarak İşaretle | `default` | `CheckCircle2` | `PAID`, `SHIPPED` | ADMIN + MANAGER (değişmez) |

`PlayCircle`/`PauseCircle` **kasıtlı bir çift**: "Askıya Al" siparişi durdurur (`PauseCircle`),
"Siparişi Onayla" onu yeniden oynatır/devam ettirir (`PlayCircle`, askıdan çıkarma = `ON_HOLD →
PAID`, §3.3). Bu, mevcut `CheckCircle2`'yi (zaten "Tamamlandı Olarak İşaretle" anlamında kullanılan
farklı bir eylem) yeniden kullanıp anlam çakışması yaratmaktan daha nettir — architect §7.1 madde 5
"CheckCircle2 **veya benzer**" ifadesiyle bu seçime izin veriyor. `İptal Et` mevcut `XCircle`'ı
`ON_HOLD` bağlamında da AYNEN kullanır (aynı eylem, aynı ikon — sayfada iki state birbirini
dışladığı için çakışma yok).

### 3.2 Sıralama ve gruplama — "risk soldan, ileri-akış sağdan"

Butonlar DOM sırasında **her zaman şu sabit sırayla** render edilir (görünürlük duruma göre
koşullu, ama sıra sabit kalır):

```
[İptal Et] [Askıya Al] [İade Et]  |  [Kargoya Ver] [Siparişi Onayla] [Tamamlandı Olarak İşaretle]
   — istisnai / riskli grup —          — operasyonel / ileri-akış grubu —
```

Gerekçe: mevcut `ConfirmDialog`/`DialogFooter` deseni zaten "Vazgeç (sol, outline) → asıl eylem
(sağ, vurgulu)" ilkesini kullanıyor (`confirm-dialog.tsx:81-93`, sayfadaki ship/refund dialog'ları).
Aynı ilke eylem çubuğuna taşınır: soldaki grup istisnai/geri-dönüşü zor eylemler (`destructive`/
`warning`), sağdaki grup siparişi ileri taşıyan/kapatan operasyonel eylemler (`outline`/`success`/
`default`). Bu iki grup ARASINA, her iki grupta da en az bir görünür buton varsa, dikey bir ayraç
konur:

```tsx
<div className="hidden sm:block h-6 w-px shrink-0 bg-border" />
```

(`hidden sm:block` — mobilde gizlenir, §3.3.) İki gruptan biri tamamen boşsa (ör. `SHIPPED`
durumunda yalnızca "İade Et" görünür) ayraç da render edilmez — koşul: sol grupta ≥1 VE sağ grupta
≥1 görünür buton varsa göster.

En kalabalık iki durum bu sırayla şöyle görünür:
- **`ON_HOLD` (3 buton):** İptal Et · İade Et | Siparişi Onayla
- **`PAID` (4 buton):** Askıya Al · İade Et | Kargoya Ver · Tamamlandı Olarak İşaretle

### 3.3 Taşma ve mobil davranış

Mevcut `flex flex-wrap gap-2` **yetersizdir** çünkü 4 buton + ayraç dar ekranda (< 640px) yamuk
(ragged) bir saç örgüsü gibi sarar ve `justify-between` üstteki başlık satırıyla çarpışır. Karar:

- **`≥ 640px` (`sm` ve üstü):** mevcut desen korunur — üst satır `flex flex-wrap items-center
  justify-between gap-3` (başlık solda, eylemler sağda), eylem grubu `flex items-center gap-2`
  (+ §3.2 ayracı).
- **`< 640px`:** eylem grubu kendi satırına düşer ve **2 sütunlu grid**'e geçer:
  ```tsx
  className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center"
  ```
  Ayraç mobilde `hidden` (grid zaten görsel gruplamayı satır sırasıyla veriyor: risk grubu üstte,
  operasyonel grup altta — DOM sırası §3.2 ile aynı olduğu için grid otomatik doğru satırlara
  düşer, ek bir `order-*` sınıfı GEREKMEZ).
- Buton metinleri **hiçbir breakpoint'te kısaltılmaz/ikon-only yapılmaz** — bunlar mali/durum
  değiştiren eylemler, tıklama sonucunun ne olduğu her zaman yazıyla görünür kalmalı (finansal ve
  geri dönüşü zor eylemlerde ikon-only kabul edilmez).
- Buton `size` her yerde `default` (`h-8`) kalır — 6 olası buton için `sm`'e düşürmek dokunma
  hedefini küçültür, gerek yok (aynı anda en fazla 4 tanesi görünüyor).

---

## 4. İptal modalının uyarı hiyerarşisi

Mevcut `refundDialogOpen` `Dialog` deseniyle **aynı bileşen ailesi** (`Dialog`/`DialogContent`/
`DialogHeader`/`DialogFooter`), `ConfirmDialog` KULLANILMAZ çünkü zorunlu Textarea + iki checkbox +
koşullu uyarı bloğu `ConfirmDialog`'un tek-amaçlı (başlık+açıklama+onay) API'sini aşıyor — sayfadaki
mevcut `shipDialogOpen`/`refundDialogOpen` `Dialog` kalıbı zaten bu tarz "form içeren" diyaloglar
için kullanılıyor, aynı kalıp burada da kullanılır.

**Diyalog içeriği, yukarıdan aşağıya sabit sıra:**

1. `DialogTitle`: "Siparişi iptal et" · `DialogDescription`: `"${order.orderNumber}" numaralı
   siparişi iptal etmek istediğinize emin misiniz?`

2. **Zorunlu neden alanı** — mevcut `refundReason` Textarea deseniyle AYNI görsel (`Field` +
   `Textarea rows={3}`), ama:
   - `Field` `required` prop'u `true` (kırmızı `*` çıkar, `field.tsx:30-34` zaten destekliyor).
   - `hint`: **"Bu metin müşteriye gönderilecek e-postada aynen yer alır."** (mevcut hint stiliyle
     aynı — `text-xs text-foreground/60`).
   - `maxLength={500}` (backend `cancellationReason` 1..500, §5.2).
   - Boşsa `Field error` ile "İptal nedeni zorunludur." gösterilir (backend 422 mesajıyla BİREBİR
     aynı metin — istemci/sunucu hata sözlüğü ayrışmasın).

3. **"Müşteriye e-posta gönderilsin" checkbox'ı** — varsayılan **işaretli** (`sendCustomerEmail`
   varsayılan `true`, §5.2). Mevcut `Checkbox` bileşeni + `billing-section.tsx:62-66`'daki
   `label htmlFor + Checkbox` deseniyle AYNI:
   ```tsx
   <label htmlFor="sendCustomerEmail" className="flex items-center gap-2.5 text-sm font-medium text-foreground">
     <Checkbox id="sendCustomerEmail" checked={sendCustomerEmail} onCheckedChange={setSendCustomerEmail} />
     Müşteriye e-posta gönderilsin
   </label>
   ```

4. **`order.paidAt != null` iken KOŞULLU kırmızı uyarı bloğu** — mevcut `Alert variant="error"`
   BİREBİR reddedildi çünkü `Alert` tek satırlık kısa mesajlar için tasarlanmış (bkz. sayfadaki
   `order.errorSummary` kullanımı); burada başlık + gövde + zorunlu checkbox birlikte gerekiyor.
   Bunun yerine `confirm-dialog.tsx:67-79`'daki "tone ikonu + başlık" mikro-deseni **genişletilerek**
   kullanılır — kendi kutusu:
   ```tsx
   <div className="space-y-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
     <div className="flex items-start gap-2.5">
       <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
       <p className="text-sm text-danger">
         Bu siparişin ödemesi alınmış. İptal etmek parayı <strong>otomatik iade etmez</strong> —
         önce &quot;İade Et&quot; ile Stripe iadesi yapın (durum &quot;İade Edildi&quot; olur) veya
         iadeyi kendiniz yürüteceğinizi aşağıda onaylayın.
       </p>
     </div>
     <label htmlFor="confirmWithoutRefund" className="flex items-center gap-2.5 pl-6 text-sm font-medium text-danger">
       <Checkbox id="confirmWithoutRefund" checked={confirmWithoutRefund} onCheckedChange={setConfirmWithoutRefund} />
       Parayı kendim/başka bir yolla iade edeceğimi onaylıyorum
     </label>
   </div>
   ```
   Metin backend'in 409 mesajıyla (§3.5, `.claude/architect-scope-order-management-pro.md:179-180`)
   **birebir aynı** tutulur — istemci tarafı ön-uyarı ile sunucu hata mesajı ayrışmasın (istemci
   kontrolü tek savunma değil, backend zaten reddediyor — ama kullanıcı submit ETMEDEN önce aynı
   gerçeği görmeli).
   - Bu blok yalnızca `order.paidAt != null` iken render edilir.
   - `confirmWithoutRefund` checkbox'ı işaretlenmeden **"İptal Et" submit butonu `disabled`**
     (yalnızca sunucu 409'una güvenilmez, §architect 7.2 son cümle).

5. `DialogFooter`: `Vazgeç` (`outline`) · `İptal Et` (`variant="destructive"`, `loading` state,
   `disabled` koşulu: `!reason.trim() || (order.paidAt != null && !confirmWithoutRefund)`).

**Renk/ikon tutarlılığı:** kırmızı uyarı bloğu `border-danger/30 bg-danger/10 text-danger` —
`alert.tsx:7` (`variant="error"`) ile **aynı token seti**, farklı bir kırmızı İCAT EDİLMEDİ.
`AlertTriangle` ikonu `confirm-dialog.tsx:3`'te zaten kullanılan ikonla aynı.

---

## 5. Düzenleme modu, `adminNotes` kartı, aktivite günlüğü

### 5.1 Görüntüle ↔ Düzenle geçişi: **INLINE**, modal DEĞİL

`/hesabim/adreslerim` sayfası adres düzenlemede `Dialog` kullanıyor (`page.tsx:71-73`) — ama o
tekil, bağımsız bir `Address` varlığıdır (7-8 alan). Buradaki `PATCH /admin/orders/{orderId}`
(§5.3) tek istekte **üç farklı alt-nesneyi** (iletişim + teslimat adresi TAM nesne + fatura TAM
nesne, `sameAsShipping` YOK → iki ayrı tam form) birden taşıyabiliyor — toplam ~20 alana kadar
çıkabilir. Bunu bir `Dialog`'a sıkıştırmak (scroll içinde scroll, küçük viewport'ta kullanılamaz)
mevcut `Dialog` boyut dilini zorlar. **Karar: inline düzenleme** — kartlar yerinde form'a döner,
sayfa yönlendirmesi/modal YOK.

**Kart yapısı ve sıralama** (mevcut "Müşteri" kartının hemen ardına, "Kargo Takip Numarası"
kartından ÖNCE — bugün bu iki yeni kart HİÇ render edilmiyor, bu görevle birlikte eklenir):

```
[Müşteri]  →  [Teslimat Adresi]  →  [Fatura Bilgisi]  →  (Kargo Takip Numarası, mevcut) → ...
```

Üç kart **tek bir `editMode` state'iyle birlikte** görüntüle/düzenle arası geçer (bağımsız
toggle'lar YOK — backend zaten tek `PATCH` isteğinde hepsini kabul ediyor, §5.3).

**"Düzenle" butonu konumu:** "Müşteri" kartının başlık satırının sağında, `variant="outline"
size="sm"`, ikon `Pencil`:
```tsx
<div className="flex items-center justify-between">
  <h2 className="admin-h2">Müşteri</h2>
  {isAdmin && canEditOrder && (
    <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
      <Pencil className="h-4 w-4" />
      Düzenle
    </Button>
  )}
</div>
```
`canEditOrder = order.status === "PENDING" || order.status === "PAID" || order.status === "ON_HOLD"`
(§5.3 ön koşulu). `canEditOrder === false` iken buton yerine küçük bir ipucu metni (backend'in 409
mesajıyla BİREBİR aynı, §5.3):
```tsx
<p className="text-xs text-foreground/50">
  Kargoya verilmiş veya kapanmış bir siparişin iletişim/adres bilgisi değiştirilemez.
</p>
```

**Görüntüle modu içerikleri:**
- *Müşteri*: mevcut (`customerName` / `customerEmail`) — DEĞİŞMEZ.
- *Teslimat Adresi*: `order.shippingAddress === null` ise `Card` içinde `text-sm text-foreground/50`
  ile `"Bu sipariş için adres kaydı yok."` (eski siparişler, §4.2/OrderAddressSnapshot notu). Doluysa
  `/hesabim/adreslerim/page.tsx:259-265`'teki format **BİREBİR AYNI** kalıpla:
  ```tsx
  <p className="text-sm font-medium text-foreground">{shippingAddress.fullName}</p>
  {shippingAddress.phone && <p className="text-sm text-foreground/60">{shippingAddress.phone}</p>}
  <p className="mt-1.5 text-sm leading-relaxed text-foreground/70">
    {shippingAddress.addressLine1}
    {shippingAddress.addressLine2 && `, ${shippingAddress.addressLine2}`}
    <br />
    {[shippingAddress.neighborhood, shippingAddress.district, shippingAddress.city].filter(Boolean).join(" / ")}
    {shippingAddress.postalCode && ` ${shippingAddress.postalCode}`}
  </p>
  ```
- *Fatura Bilgisi*: `order.billing === null` ise aynı boş-durum metni. Doluysa: `billingType`
  rozeti (`Badge tone="neutral"`, "Bireysel"/"Kurumsal"), `CORPORATE` ise `companyName` +
  `taxOffice`/`taxNumber`, `INDIVIDUAL` ise `nationalId` (varsa), altında **aynı adres formatı**
  (yukarıdaki blok, `billing.address` için).

**Düzenle modu içerikleri:**
- *Müşteri*: `customerName`, `customerEmail` → `Field` + `Input` (mevcut `Field`/`Input` deseni).
- *Teslimat Adresi*: `checkout/billing-section.tsx:71-108`'deki alan seti/etiketleri/`grid
  grid-cols-1 sm:grid-cols-2` deseni **BİREBİR** tekrar kullanılır (Ad Soyad, Telefon, İl, İlçe,
  Mahalle, Adres Satırı, Adres Satırı 2, Posta Kodu) — `sameAsShipping` YOK (§5.3, admin iki formu
  ayrı gönderir).
- *Fatura Bilgisi*: `checkout/billing-section.tsx:112-157`'deki **segmented control + koşullu
  alanlar deseni BİREBİR** tekrar kullanılır (`role="radiogroup"`, `SEGMENT_LABEL_CLASSES`,
  Bireysel/Kurumsal), YALNIZCA `sameAsShipping` checkbox'ı (satır 58-67) ve ona bağlı koşullu blok
  (69-110) **DAHİL EDİLMEZ** — fatura adresi her zaman görünür/düzenlenebilir tam form olarak durur
  (backend `sameAsShipping` bayrağını tanımıyor, §5.3).
- Ortak `DialogFooter` YOK (modal değil); üç kartın **altında, sayfa akışında** tek bir eylem
  satırı:
  ```tsx
  <div className="flex justify-end gap-2">
    <Button variant="outline" onClick={() => setEditMode(false)} disabled={savingOrder}>Vazgeç</Button>
    <Button onClick={handleSaveOrder} loading={savingOrder}>Kaydet</Button>
  </div>
  ```
  Burada `variant="default"` (primary) KULLANILIR — bu "kaydet" jenerik bir eylemdir, §1'deki
  "onay = yeşil" semantiği bağlamıyla ÇAKIŞMAZ (sipariş DURUMUNU değiştirmiyor, yalnızca alan
  günceller).

### 5.2 `adminNotes` kartı — BAĞIMSIZ, `editMode`'a BAĞLI DEĞİL

`adminNotes` her durumda düzenlenebilir (§5.3: "her durumda") — §5.1'deki `canEditOrder` koşuluna
**tabi değildir**. Bu yüzden ayrı, kendi kaydetme akışına sahip bir kart olarak tasarlanır (üç kart
grubuna dahil EDİLMEZ), konumu: aktivite kartından ÖNCE, ürün tablosu/toplam kartlarından SONRA.

```tsx
<Card className="space-y-3">
  <div className="flex items-center gap-2">
    <NotebookPen className="h-4 w-4 text-foreground/50" />
    <h2 className="admin-h2">Dahili Not</h2>
  </div>
  {isAdmin ? (
    <>
      <Textarea rows={4} maxLength={5000} value={notesDraft} onChange={...} placeholder="Bu sipariş hakkında dahili not…" />
      <div className="flex justify-end">
        <Button size="sm" disabled={notesDraft === (order.adminNotes ?? "")} loading={savingNotes} onClick={handleSaveNotes}>
          Kaydet
        </Button>
      </div>
    </>
  ) : (
    <div className="rounded-lg border border-border bg-surface-muted p-3 text-sm whitespace-pre-wrap text-foreground/80">
      {order.adminNotes || <span className="text-foreground/40">Not girilmemiş.</span>}
    </div>
  )}
</Card>
```
- ADMIN: `Textarea` + dirty-state "Kaydet" (metin `order.adminNotes` ile aynıysa buton `disabled`)
  — ayrı bir görüntüle/düzenle toggle'ı GEREKMEZ, serbest metin düşük riskli bir alandır.
- MANAGER: salt okunur kutu — "Kargo Takip Numarası" kartındaki (`border-border bg-surface-muted
  p-3`) kutuyla AYNI görsel dil, farklı bir stil İCAT EDİLMEZ.
- `handleSaveNotes` yalnızca `{ adminNotes }` gövdesiyle `PATCH /admin/orders/{orderId}` çağırır —
  §5.1'deki büyük düzenleme isteğinden AYRI bir çağrı (frontend-agent karar verir, backend zaten
  tüm alanları opsiyonel kabul ediyor).

### 5.3 Aktivite günlüğü kartı — `/admin/logs` deseninin BİREBİR tekrar kullanımı

Yeni bir liste görünümü İCAT EDİLMEZ: `frontend/src/app/admin/logs/page.tsx:37-41` (`STATUS_CONFIG`)
+ `:164-205` (kart/satır markup'ı) **birebir aynı** kalıp burada da kullanılır — ikon/renk durumla
(`status: SUCCESS | FAILURE | FORBIDDEN`) eşlenir, eylemle DEĞİL:

| `status` | İkon | Sınıf |
|---|---|---|
| `SUCCESS` | `CheckCircle2` | `bg-success/10 text-success` |
| `FAILURE` | `XCircle` | `bg-danger/10 text-danger` |
| `FORBIDDEN` | `ShieldAlert` | `bg-warning/10 text-warning` |

```tsx
<Card className="space-y-3">
  <div className="flex items-center gap-2">
    <History className="h-4 w-4 text-foreground/50" />
    <h2 className="admin-h2">Aktivite Günlüğü</h2>
  </div>
  <div className="divide-y divide-border rounded-lg border border-border">
    {activity.map((entry) => {
      const config = STATUS_CONFIG[entry.status]; // logs/page.tsx ile AYNI harita
      const Icon = config.icon;
      return (
        <div key={entry.id} className="flex items-start gap-3 p-3">
          <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", config.className)}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{ORDER_ACTIVITY_LABELS[entry.action] ?? entry.action}</p>
              <span className="shrink-0 text-xs text-foreground/50">{dateFormatter.format(new Date(entry.createdAt))}</span>
            </div>
            <p className="mt-0.5 text-xs text-foreground/60">{entry.actorEmail ?? "Sistem"}</p>
            {/* metadata satırı — aşağıya bakınız */}
          </div>
        </div>
      );
    })}
  </div>
</Card>
```

**`action` etiket sözlüğü** — YENİ `frontend/src/lib/order-activity.ts` (architect §7.2'de zaten
listelenmiş dosya), TEK sözlük kuralı (CLAUDE.md):
```ts
export const ORDER_ACTIVITY_LABELS: Record<string, string> = {
  "order.status_change": "Durum değiştirildi",
  "order.update": "Sipariş güncellendi",
  "order.refund": "İade işlendi",
  "order.cancel_email": "İptal e-postası",
};
```

**`metadata` satırı** (ikinci, küçük, `text-xs text-foreground/50` satır — allow-list §5.4'teki
anahtarlarla sınırlı, gösterim kuralları):
- `order.status_change`: `from`/`to` varsa → `{ORDER_STATUS_LABELS[from]} → {ORDER_STATUS_LABELS[to]}`
  (`ArrowRight` ikonu `h-3 w-3 inline` ile araya). `from`/`to` `OrderStatus` DIŞI bir değer taşıma
  riskine karşı bilinmeyen değer ham metin olarak basılır (savunmacı fallback).
- `order.update`: `fields: string[]` varsa → `"Değişen alanlar: " + fields.map(FIELD_LABEL).join(", ")`.
  Aynı `order-activity.ts` dosyasında küçük bir `ORDER_UPDATE_FIELD_LABELS` haritası (`customerEmail:
  "E-posta"`, `customerName: "Müşteri Adı"`, `shippingAddress: "Teslimat Adresi"`, `billing: "Fatura
  Bilgisi"`, `adminNotes: "Dahili Not"`) — bilinmeyen anahtar ham haliyle basılır.
- `order.refund`: `reason`/`stripeRefundId` varsa `reason` gösterilir (varsa).
- `order.cancel_email`: `emailDelivered` → `true` ise `"E-posta gönderildi"`, `false` ise
  `"E-posta gönderilemedi"` (kırmızı `text-danger`, diğerleri `text-foreground/50`).

`ipAddress` bu ekranda **HİÇ gösterilmez** — zaten API bunu döndürmüyor (§5.4), UI tarafında da
gösterilecek bir alan yok (uyum otomatik).

### 5.4 İkon envanteri (bu görevle eklenenler)

`lucide-react` içinden: `PlayCircle`, `PauseCircle`, `Pencil`, `NotebookPen`, `History`,
`ShieldAlert`, `ArrowRight`. Mevcut sayfadan devralınanlar: `AlertCircle`, `CheckCircle2`,
`ChevronLeft`, `Copy`, `RotateCcw`, `Truck`, `XCircle`, `AlertTriangle` (`ConfirmDialog` içinden
zaten geliyor). Tek kaynak `lucide-react` — başka bir ikon seti KARIŞTIRILMAZ.

---

## Frontend-agent için özet dosya/bileşen listesi

| Konu | Nereden alınacak | Not |
|---|---|---|
| `success` buton varyantı | `components/ui/button.tsx` (ui-designer tarafından eklendi) | Hazır, direkt kullan |
| İptal modalı | Mevcut `Dialog`/`DialogContent`/`DialogFooter` + `Field`/`Textarea`/`Checkbox` | §4 |
| Düzenleme formları (adres/fatura) | `components/site/checkout/billing-section.tsx` deseni | §5.1 — segmented control + grid alan seti BİREBİR |
| Adres görüntü formatı | `app/[lang]/(site)/hesabim/adreslerim/page.tsx:259-265` | §5.1 — BİREBİR format string |
| Aktivite kartı | `app/admin/logs/page.tsx:37-41,164-205` (`STATUS_CONFIG` + satır markup'ı) | §5.3 — BİREBİR tekrar kullan |
| `adminNotes` salt-okunur kutu | Sayfadaki mevcut "Kargo Takip Numarası" kutu stili (`border-border bg-surface-muted p-3`) | §5.2 |
