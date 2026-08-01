# Tasarım Notları: `/admin/account` ("Hesabım")

Ajan: ui-designer
Kapsam: Sadece tasarım/UX kararları. Kod implementasyonu **frontend-agent**'a aittir.
Referans: `.claude/architect-scope-toast-and-account.md` §4.B ve §5 (5 açık soru).

Görsel yön (proje geneli hatırlatma): Bu proje **Minimal/Flat** çizgide
(`bg-surface`/`text-foreground`/`border-border` CSS custom property token'ları,
`Card`/`PageHeading` standart yüzeyi). `admin/settings/page.tsx`'in bento/glow
estetiği, `design-notes-media-picker.md` madde 5'te zaten **İSTİSNAİ tek sayfa**
olarak belgelenmiş. Bu doküman o istisnayı GENİŞLETMİYOR.

---

## Karar 1 — `/admin/account` görsel dili: **(a) Standart `Card` + `PageHeading`**

**Architect'in önerisi ONAYLANDI.** Bento (b) REDDEDİLDİ.

Gerekçe:
- `admin/settings/page.tsx`'teki bento estetiği zaten proje genelinde **istisna**
  olarak belgeli (`design-notes-media-picker.md` madde 5: "Ayarlar sayfasının
  bento/glow estetiği İSTİSNAİ bir yüzeydir"). İstisnayı ikinci bir sayfaya
  yaymak onu artık istisna değil, ikinci bir paralel dil yapar — bilgi mimarisi
  tutarlılığını bozar.
- `/admin/account`, bilgi mimarisi olarak `/admin/settings/security`'nin kardeşi
  (ikisi de "kişisel hesap" alanı, site yönetimi değil). Kardeş sayfalar aynı
  görsel dili paylaşmalı; biri bento biri flat olursa kullanıcı "hesabım" ve
  "güvenlik" arasında geçiş yaparken tutarsız bir sıçrama hisseder.
- `ImageUploadField` zaten standart token'larla geliyor (`border-border`,
  `bg-input`, `text-foreground`). Bento'da kullanılırsa `design-notes-media-picker.md`
  madde 7'deki bilinen "dikiş" (seam) sorunu tekrar eder — ve bu sayfada avatar
  ikincil değil, sayfanın **merkezi** öğelerinden biri, dolayısıyla dikiş çok
  daha görünür/rahatsız edici olurdu (Ayarlar'daki tek bir logo alanından farklı
  olarak).
- Bento estetiği motion/glow gerektirir (`useMouseGlow`, `-m-6 min-h-[...] bg-bento-bg`
  full-bleed layout); "Hesabım" gibi sık ziyaret edilen, hızlı tamamlanması
  gereken bir CRUD sayfası için bu görsel ağırlık gereksiz sürtünme yaratır.

**Uygulama:**
- `PageHeading icon={UserCircle} title="Hesabım" description="Profil bilgilerinizi ve hesap güvenliğinizi yönetin."`
  (`lucide-react` `UserCircle` veya `CircleUserRound` — Karar 5'teki dropdown
  "Hesabım" item'ıyla AYNI ikonu kullan, tutarlılık için `User` ikonunu tercih et
  ve `PageHeading`'de de `User` kullan).
- Üç bölüm (Profil / Avatar / Şifre) → üç ayrı `<Card className="space-y-4">`,
  `settings/security/page.tsx`'teki gibi `motion.div` fade-in-up ile
  (`initial={{ opacity: 0, y: 12 }}`, `delay` her kartta +0.05 artan) — sayfa
  zaten bu deseni kullanıyor, `/admin/account` da aynısını tekrarlar.
- Her `Card` içi başlık deseni security page ile birebir: `<h2 className="text-sm font-semibold text-foreground">` + `<p className="mt-1 text-sm text-foreground/60">` açıklama.

---

## Karar 2 — Avatar önizlemesi: **Dairesel, `ImageUploadField`'e opsiyonel `previewShape` prop'u ile**

`ImageUploadField`'in mevcut dikdörtgen önizlemesi DEĞİL. Wrapper/CSS-hack
(`[&_img]:rounded-full` gibi çocuk seçici override'ı) de ÖNERİLMİYOR — bu,
bileşenin iç implementasyon detayına (kendi `<img>` markup'ı) dışarıdan
bağımlılık kurar, iç yapı değişirse sessizce kırılır. Bunun yerine
`ImageUploadField`'e **opsiyonel, varsayılanı mevcut davranışı koruyan** bir
prop eklenmesini öneriyorum:

```ts
interface ImageUploadFieldProps {
  // ...mevcut alanlar
  previewShape?: "square" | "circle"; // varsayılan: "square" (mevcut davranış, DEĞİŞMEZ)
}
```

- `previewShape="square"` (varsayılan) → mevcut `h-32 w-full rounded-md
  border border-border object-cover` AYNEN korunur. Diğer 6 kullanım yeri
  (blog kapak görseli, sayfa kapak görseli, galeri bloğu, ayarlar logosu vb.)
  **hiçbir değişiklik görmez**, prop'u geçmezler.
- `previewShape="circle"` → `h-24 w-24 rounded-full border border-border
  object-cover mx-auto` (kare yerine sabit `96px` dairesel önizleme,
  `Avatar` bileşeninin görsel diliyle — dairesel, ortalanmış — birebir tutarlı).

**Neden madde 7'deki "dikişi kabul et" kararından FARKLI davrandım:**
`design-notes-media-picker.md` madde 7'de bento/border-token seam'i kabul edildi
çünkü etki **kozmetik ve düşük görünürlüktü** (sadece border/metin rengi tonu,
tek bir ayarlar alanı). Buradaki fark **şekil** (kare vs. daire) ve avatar
projede HER YERDE (`components/ui/avatar.tsx`, topbar) dairesel gösteriliyor —
bir profil fotoğrafının kendi düzenleme ekranında dikdörtgen görünmesi
kozmetik değil, **kullanıcı beklentisini doğrudan ihlal eden** bir tutarsızlık
(kullanıcı "bu neden köşeli, benim avatarım yuvarlaktı" diye şüpheye düşer).
Prop'un varsayılanı mevcut davranışı koruduğu ve diğer 6 kullanım yerini
etkilemediği için `ImageUploadField`'i "generic kalmalı" ilkesini de bozmuyor.

**Ek düzen (sadece `circle` modunda, `ImageUploadField` içinde koşullu):**
- Görsel yokken (`!value`) placeholder olarak `components/ui/avatar.tsx`'teki
  `initialsOf` deseniyle tutarlı bir boş daire göster (`bg-primary/10` +
  ortalanmış `UserCircle` ikonu, `text-primary/40`, `h-24 w-24`) — kare modda
  görsel yokken hiçbir placeholder gösterilmiyor (`{value && (...)}`), circle
  modda da aynı davranış (görsel yoksa hiçbir şey render etme) kabul edilebilir;
  placeholder EKLEMEK zorunlu değil, sade tutulabilir. **frontend-agent'a bırakılır
  (opsiyonel), zorunlu görsel dil kararı değil.**
- Buton satırı (`Kütüphaneden Seç` / `Yükle` / URL input) AYNEN kalır — sadece
  önizleme şekli değişiyor, etkileşim modeli (§4.B "Değiştir/Kaldır" ikilisi
  yerine mevcut üç-buton deseni) DEĞİŞMİYOR. Ayrı "Kaldır" butonu eklenmez;
  mevcut URL `Input`'unu temizlemek (veya gelecekte eklenecek bir "Kaldır"
  butonu) zaten `onChange("")` üretiyor, bu da kontrata göre `avatarUrl: null`'a
  çevrilerek gönderiliyor (§2.2, frontend-agent görevi, tasarım kapsamı dışı).

---

## Karar 3 — Şifre bölümünün tonu: **Ön-bilgilendirme YOK (Alert değil), sadece kart açıklaması + toast**

`Alert variant="warning"` KULLANILMAZ — bu variant zaten `components/ui/alert.tsx`'te
**tanımlı değil** (`AlertVariant = "error" | "success" | "info"`); yeni bir
variant eklemek bu tek kullanım için gereksiz genişleme olur.

Karar: 2FA disable dialog'undaki ton (`DialogDescription` içinde düz metin,
Alert kutusu DEĞİL — `settings/security/page.tsx:434-436`'te `disableError`
ayrı bir `Alert variant="error"`, ama oturum-sonlandırma bilgisi sade bir
`<p>` cümlesi) burada da BİREBİR tekrarlanır:

- Kart açıklaması (`<p className="mt-1 text-sm text-foreground/60">`, `h2`'nin
  hemen altında, TÜM zaman görünür — koşullu değil):
  `"Şifrenizi değiştirdiğinizde bu cihaz hariç diğer tüm oturumlarınız kapatılır."`
- Bu metin **Alert kutusu değil**, düz kart açıklaması olarak render edilir —
  2FA disable dialog'u da aynı bilgiyi Alert değil DialogDescription olarak
  veriyor; tutarlılık için aynı görsel ağırlık korunur (kırmızı/sarı renk YOK,
  `text-foreground/60` nötr ton).
- **Neden Alert/warning DEĞİL, sadece hint metni:** Şifre değiştirme, 2FA'yı
  KAPATMAK (güvenliği azaltan, geri dönüşü riskli bir eylem) gibi "tehlikeli"
  bir eylem değil — aksine güvenliği ARTIRAN rutin bir eylem. Renkli
  uyarı kutusu burada orantısız alarm yaratır ("alert fatigue"); nötr
  bilgilendirme yeterli. 2FA disable'da bile bu bilgi bir Alert değil, sade
  bir açıklama cümlesidir — precedent zaten bu yönde.
- Form gönderiminden SONRA (backend 204 dönünce) toast ile PEKİŞTİRİLİR:
  `toast.success("Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı.")`
  (mevcut karar, §4.B'de zaten yazılı — burada sadece onaylanıyor).
- Hata durumunda mevcut desen: `toast.error(friendlyErrorMessage(err))` +
  formun ÜSTÜNDE (Card içinde, buton üstünde) `Alert variant="error"` —
  2FA disable dialog'undaki `disableError` Alert'iyle birebir aynı yerleşim
  (`AlertCircle` ikonlu, `flex items-center gap-2`).

**Özet kural:** Rutin ama yan-etkili işlemler (şifre değişimi) → nötr hint +
toast. Geri dönüşü riskli/güvenliği azaltan işlemler (2FA kapatma, hesap
silme) → kırmızı/destructive vurgulu buton + (gerekirse) Alert. Şifre
değiştirme butonu da `variant="default"` (primary) kalır, `variant="destructive"`
KULLANILMAZ (2FA disable butonu destructive çünkü güvenliği azaltıyor; şifre
değiştirme güvenliği azaltmıyor).

---

## Karar 4 — Toast mikro-kopya standardı: **Zaten `ARCHITECTURE.md §10.6`'da var, aşağıdaki netleştirmelerle sabitleniyor**

`docs/architecture/ARCHITECTURE.md` §10.6 (satır 570-579) genel kuralı zaten
tanımlıyor ("kullanıcı tarafından tetiklenen her mutasyon → tam bir toast",
`toast.success("<Varlık> <fiil geçmiş zaman>.")`, `toast.error(friendlyErrorMessage(err))`).
Bu doğru ve DEĞİŞTİRİLMİYOR ama biçim/ton kuralları açıkça YAZILI değildi —
aşağıdaki ek maddeler bu dokümana **ui-designer eklentisi** olarak sabitlenir
(documentation-agent bir sonraki turda ARCHITECTURE.md §10.6'ya bu maddeleri
ekleyebilir; bu dosya o ana kadar referans kaynaktır):

1. **Dil:** Türkçe.
2. **Çatı:** Edilgen çatı (kullanıcı özne değil, nesne + geçmiş zaman eki
   `-di/-dı` + `-dü/-du`). Doğru: `"Yazı oluşturuldu."` Yanlış: `"Yazıyı oluşturdunuz."`
3. **Kalıp:** `[Nesne] [fiil-geçmiş].` — nesne büyük harfle başlamaz (cümle
   başı hariç), tek cümle, ek açıklama yoksa nokta ile biter ve durur.
   Çok kelimeli ek bilgi gerekiyorsa (örn. oturum kapatma bildirimi) İKİNCİ
   bir cümle eklenebilir, AMA toplam iki cümleyi geçmez: `"Şifreniz değiştirildi.
   Diğer cihazlardaki oturumlarınız kapatıldı."` (mevcut örnek, kurala uygun).
4. **Noktalama:** Her zaman nokta (`.`) ile biter. **Ünlem (`!`) YASAK**
   (aciliyet/heyecan hissi toast'ın nötr bilgilendirme rolüyle çelişir).
5. **Emoji:** YASAK. Sonner zaten `success`/`error` ikonlarını otomatik
   gösteriyor (yeşil check / kırmızı X) — metin içi emoji fazlalık.
6. **Uzunluk:** Tercihen ≤ 60 karakter (tek cümle), istisnai iki-cümle
   durumunda ≤ 100 karakter. Toast kalıcı değil (`sonner` varsayılan
   otomatik-kapanma süresi), uzun metin okunmadan kaybolur.
7. **Hata metni kaynağı:** Her zaman `friendlyErrorMessage(err)` — serbest
   metin YAZILMAZ, backend'in ürettiği kullanıcı-dostu mesaj kullanılır
   (mevcut proje kuralı, değişmiyor).
8. **Varlık isimlendirmesi:** Toast'taki varlık adı, o varlığın Türkçe
   UI etiketiyle birebir eşleşmeli (`"Yazı"` blog için, `"Sayfa"` pages için,
   `"Görsel"` medya için, `"Profiliniz"`/`"Şifreniz"` hesap için — iyelik eki
   kullanıcıya ait kişisel varlıklarda [profil, şifre] kullanılır, paylaşılan/
   yönetimsel varlıklarda [yazı, sayfa, görsel] kullanılmaz).

Bu kurallar `/admin/account` toast'larına DA uygulanır:
- Profil kaydı: `"Profiliniz güncellendi."`
- Şifre değişimi: `"Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı."`
(İkisi de zaten §4.B'de bu şekilde yazılmış — kural ihlali YOK, sadece
gerekçelendiriliyor.)

---

## Karar 5 — Topbar dropdown: **Architect'in önerisi ONAYLANDI**

Avatar + isim ikilisi TEK bir `DropdownMenu` tetikleyicisine dönüştürülür,
ayrı duran "Çıkış Yap" `Button`'ı kaldırılır ve menü içine taşınır.
`AdminLocaleSwitcher` (aynı dosyada, satır 26-52) deseni referans alınır.

**Uygulama detayları (frontend-agent için, birebir uygulanabilir spesifikasyon):**

```tsx
<DropdownMenu>
  <DropdownMenuTrigger
    render={
      <button
        type="button"
        aria-label="Hesap menüsü"
        className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-surface-muted"
      />
    }
  >
    <Avatar name={user.name} src={user.avatarUrl} size={28} />
    <span className="hidden text-sm text-foreground/80 sm:inline">{user.name}</span>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={() => router.push("/admin/account")}>
      <User className="h-4 w-4" />
      Hesabım
    </DropdownMenuItem>
    <DropdownMenuItem onClick={() => router.push("/admin/settings/security")}>
      <ShieldCheck className="h-4 w-4" />
      Güvenlik
    </DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem onClick={() => logout()}>
      <LogOut className="h-4 w-4" />
      Çıkış Yap
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

Gerekçe ve netleştirmeler:
- **İkonlar:** `User` (Hesabım), `ShieldCheck` (Güvenlik — `settings/security`
  sayfasının kendi `PageHeading` ikonuyla AYNI, tutarlılık için), `LogOut`
  (Çıkış Yap — zaten mevcut import, taşınıyor). Tek kaynak `lucide-react`,
  başka ikon seti karıştırılmaz.
- **"Çıkış Yap" `variant="destructive"` DEĞİL, `default`:** Çıkış yapmak
  veri kaybı veya geri dönüşü olmayan bir eylem değil (kullanıcı tekrar giriş
  yapabilir); `DropdownMenuItem`'in `destructive` variant'ı (kırmızı metin/hover)
  DAHA GÜÇLÜ bir "dikkat, tehlikeli" sinyali taşır ve burada yanlış beklenti
  yaratır. Bunun yerine `DropdownMenuSeparator` ile navigasyon item'larından
  (Hesabım, Güvenlik) GÖRSEL OLARAK ayrılması yeterli — ayraç zaten "bu farklı
  bir kategori eylem" mesajını veriyor, renk eskalasyonuna gerek yok.
- **Trigger görünümü:** `AdminLocaleSwitcher`'daki gibi `Button variant="ghost"`
  kullanmak yerine çıplak `<button>` + `hover:bg-surface-muted` tercih edildi,
  çünkü `Avatar` (dairesel görsel) + isim ikilisi zaten kendi görsel ağırlığını
  taşıyor; bir `Button` çerçevesi (border/padding) eklemek görsel gürültü
  yaratır — mevcut topbar'da bu ikili zaten çerçevesiz duruyordu, sadece
  `hover` durumu ve `focus-visible` halkası (Tailwind `focus-visible:ring-2
  focus-visible:ring-ring` varsayılan buton odak deseniyle tutarlı,
  frontend-agent projedeki mevcut `focus-visible` token'ını kullanmalı)
  eklenerek tıklanabilirlik ipucu veriliyor.
- **Topbar dengesi:** Bu değişiklik topbar'ın sağ grubunu ~140px kısaltır
  (ayrı "Çıkış Yap" butonü kalkıyor) — bu KABUL EDİLEBİLİR, hatta İSTENEN bir
  sonuç: topbar sağ grup şu an 6 öğe (`AdminLocaleSwitcher`, `ThemeToggle`,
  `AccentColorPicker`, `NotificationCenter`, Avatar+isim, Çıkış butonu)
  taşıyor; ikisinin birleşmesi 5 öğeye iner, `gap-3` aralığı görsel yoğunluğu
  azaltır. Alternatif düzen (Çıkış Yap ayrı, sadece avatar+isim tıklanabilir)
  REDDEDİLDİ — iki ayrı tıklanabilir hedefin yan yana durması (biri dropdown
  açıyor, diğeri direkt eylem yapıyor) karışıklık yaratır; TEK giriş noktası
  (dropdown) daha öngörülebilir.

---

## Özet — frontend-agent için uygulama kontrol listesi

1. `/admin/account/page.tsx`: `PageHeading icon={User}` + 3× `Card` (Profil,
   Avatar, Şifre), `motion.div` fade-in-up deseni (security page ile aynı).
2. `ImageUploadField`'e `previewShape?: "square" | "circle"` prop'u ekle
   (varsayılan `"square"`, mevcut 6 kullanım yerini ETKİLEME); `circle` modda
   `h-24 w-24 rounded-full border border-border object-cover mx-auto`.
   Hesabım sayfasında `previewShape="circle"` ver.
3. Şifre kartı açıklaması: `"Şifrenizi değiştirdiğinizde bu cihaz hariç diğer
   tüm oturumlarınız kapatılır."` (nötr `text-foreground/60`, Alert kutusu
   değil). Hata: `Alert variant="error"` + `AlertCircle` ikonu (2FA disable
   deseniyle birebir). Kaydet butonu `variant="default"`, DESTRUCTIVE DEĞİL.
4. Toast metinleri Karar 4'teki 8 kurala uysun (edilgen çatı, nokta, emoji/ünlem
   yok, ≤60/100 karakter, `friendlyErrorMessage` kaynaklı hata metni).
5. `topbar.tsx`: Avatar+isim'i `DropdownMenu` tetikleyicisine çevir, "Çıkış
   Yap" `Button`'ını kaldır, menü içine taşı (yukarıdaki kod iskeleti,
   `User`/`ShieldCheck`/`LogOut` ikonları, `DropdownMenuSeparator` ile eylemi
   navigasyondan ayır, `destructive` variant KULLANMA).
