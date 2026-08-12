# Compliance Notes — Çok Dillilik (i18n)

> **Kapsam:** `.claude\architect-scope-i18n.md` §9 "compliance-agent" bölümündeki 4 madde +
> mevcut KVKK/gizlilik içeriğinin i18n etkisi (görev madde 5).
> **Rol hatırlatması:** Bu ajan hukuki tavsiye vermez; KVKK/GDPR genel ilkelerini teknik
> gereksinime çevirir. **Nihai hukuki onay için gerçek bir hukuk danışmanına
> yönlendirilmelidir** — aşağıdaki değerlendirmeler bağlayıcı teknik gereksinimlerdir,
> hukuki görüş yerine geçmez.

---

## Özet

| # | Konu | Sonuç |
|---|---|---|
| 1 | `Locale` / `ContentSlug` PII içeriyor mu? | **Doğrulandı: İçermiyor.** (architect'in iddiası doğru) |
| 2 | `adminLocale` (`localStorage`) sınıflandırması | **Kesinlikle gerekli/işlevsel, rıza gerekmez.** Envanterde listelenmeli. |
| 3 | Ziyaretçi dil çerezi (gelecek senaryo) | **Koşullu ön-onay verildi** — aşağıdaki 5 koşulu karşılamayan tasarım için ayrıca compliance-agent'a dönülmeli. |
| 4 | Hukuki metinlerde §5 fallback istisnası | **Onaylandı, hatta KVKK/GDPR açısından ZORUNLU.** Ek gereksinim: "hukuki sayfa" işaretleme mekanizması eksik — açık uygulama gereksinimi olarak ekleniyor. |
| 5 | Mevcut KVKK/gizlilik içeriği | Bulundu: `SiteSettings.cookieBanner*` alanları + `Page` tabanlı "Gizlilik Politikası" linki. **İki ayrı bulgu/uyarı var** (aşağıda). |

---

## 1. `Locale` ve `ContentSlug` — PII doğrulaması

Şema taslağını (`architect-scope-i18n.md` §2.1-2.2) ve `ContentEntityType` enum'ını
(`backend/prisma/schema.prisma:76-81`, yalnızca `PAGE | BLOG_POST | PRODUCT |
PORTFOLIO_ITEM`) inceledim.

**`Locale`** — `code, label, nativeLabel, isDefault, enabled, sortOrder, hreflang,
createdAt, updatedAt`. Tamamen editör tarafından girilen taksonomi verisi (dil adları).
Herhangi bir kullanıcıyı/ziyaretçiyi tanımlayan alan yok. **PII içermez.**

**`ContentSlug`** — `id, entityType, entityId, locale, slug, createdAt, updatedAt`.
`entityType` yalnızca içerik türlerine (`PAGE`/`BLOG_POST`/`PRODUCT`/`PORTFOLIO_ITEM`)
işaret ediyor; bir `User`/hesap kaydına polimorfik referans **mümkün değil** (enum'da yok).
`entityId` bir içerik kaydının UUID'si, kullanıcı kimliği değil. **PII içermez.**

**Tek ince nüans (yeni bir risk DEĞİL, mevcut durumun devamı):** `slug` değeri editörün
girdiği başlıktan türetilir; bir blog yazısının/sayfanın başlığı teorik olarak bir kişinin
adını içerebilir (ör. "Ahmet Yılmaz ile Röportaj"). Bu risk **`ContentSlug` ile
yaratılmıyor** — bugün de aynı slug tek bir kolonda (`Page.slug` vb.) zaten var ve aynı
şekilde herkese açık. `ContentSlug` bunu yalnızca dil başına çoğaltıyor (aynı editöryel
karar, N dilde). Yeni bir veri kategorisi veya yeni bir ifşa yüzeyi açmıyor; **onay
kapsamındaki genel editöryel içerik moderasyonu sorumluluğu** (kişisel veri içeren başlık
girilmemesi) değişmeden devam ediyor.

**Sonuç: architect'in "düşük etki, PII yok" değerlendirmesi doğrulandı.** Şema
taslağında değişiklik istenmiyor.

---

## 2. `adminLocale` (`localStorage`) sınıflandırması

`frontend/src/context/i18n-context.tsx` incelendi. Özellikleri:
- Yalnızca kimlik doğrulaması **arkasındaki** admin panelinde çalışıyor.
- `localStorage` içinde tutuluyor (bir çerez değil — otomatik olarak her HTTP isteğine
  eklenmiyor, üçüncü taraf tarafından okunamıyor).
- Tek değeri var: `"tr" | "en"` (panel arayüz dili tercihi).
- §7.4 (bağlayıcı): `adminLocale` **hiçbir zaman** backend'e `?locale=` olarak
  gönderilmiyor — içerik isteklerinden tamamen ayrı.
- İzleme/analitik/profilleme amacı yok; ziyaretçi davranışını değil, bir editörün UI
  tercihini taşıyor.

**Sınıflandırma: Kesinlikle Gerekli / İşlevsel (Strictly Necessary / Functional).**
Rıza/çerez onayı **gerekmez** — aynı gerekçeyle projede zaten var olan `refresh_token` ve
`cart_token` httpOnly çerezleri de (`backend/src/lib/cookies.ts`) işlevsel kategoride
rıza almadan kullanılıyor; `adminLocale` bunlardan daha düşük risklidir (çerez bile
değil, PII de değil).

**Gereksinim (envanter):** Rıza gerekmese de **şeffaflık yükümlülüğü** devam eder — bu
alan, ileride oluşturulacak bir "Çerez ve Yerel Depolama Envanteri" tablosunda şu satırla
yer almalıdır:

| Ad | Tür | Amaç | Süre | Kategori | Rıza |
|---|---|---|---|---|---|
| `adminLocale` | `localStorage` | Admin panel arayüz dili tercihi | Kullanıcı temizleyene/değiştirene kadar kalıcı | Kesinlikle gerekli/işlevsel | Gerekmez |

Bu envanter dosyası bugün proje kökünde yok (`DATA_INVENTORY.md` bulunamadı) — bu i18n
görevi kapsamında **oluşturulması zorunlu değil**, ancak envanter ileride açıldığında bu
satırın eklenmesi gerektiği not edilir.

---

## 3. Ziyaretçi dil tercihinin çerezle hatırlanması (gelecek senaryo)

Architect'in mevcut kararı (`§4.3`): **Accept-Language ile otomatik yönlendirme YOK**,
dil seçimi yalnızca dil değiştirici tıklamasıyla yapılıyor, kök `/` her zaman varsayılan
dili gösteriyor. Bunu **gizlilik açısından doğru ve tercih edilen** yaklaşım olarak
onaylıyorum: `Accept-Language` başlığından pasif olarak dil çıkarıp saklamak, ziyaretçinin
açık bir eylemi olmadan tarayıcı sinyalinden profil çıkarmaya başlamaktır — bundan
kaçınmak izleme yüzeyini büyütmüyor, iyi bir varsayılan.

**Eğer frontend-agent ileride "dil değiştirici tıklamasını bir çerezle hatırlama" önerirse**
(örn. `preferred_locale` çerezi, sonraki ziyarette otomatik o dile götürmek için), bu
architect'in de belirttiği gibi **izleme sınırına yaklaşan bir karar** ve önceden
compliance-agent onayı gerektiriyor (§9 madde 3, bağlayıcı). Aşağıda **koşullu ön-onay**
veriyorum — bu 5 koşulun HEPSİ karşılanırsa ayrıca tekrar onay istemeye gerek yok; herhangi
biri karşılanmazsa **tasarım compliance-agent'a tekrar getirilmeli**:

1. **Yalnızca açık kullanıcı eylemi sonrası set edilir** — dil değiştiriciye tıklandığında.
   İlk ziyarette, geo-IP'den veya başka bir çıkarımdan otomatik set edilemez.
2. **Tek amaçlı, tek değerli** — yalnızca seçilen `locale` kodunu taşır; başka bir
   tanımlayıcı, oturum kimliği veya davranışsal veri ile birleştirilmez.
3. **Birinci taraf, `httpOnly` değil ama yalnızca sunucuya `locale` çözümlemesi için
   gönderilir** — üçüncü taraf analitik/reklam scriptine paylaşılmaz.
4. **Makul son kullanma süresi** — öneri: 1 yıl. Kalıcı/silinemeyen bir "fingerprint" gibi
   davranmamalı; kullanıcı dil değiştiriciyi tekrar kullanarak üzerine yazabilmeli.
5. **Çerez/gizlilik politikasında beyan edilir** — rıza istenmese de (bkz. gerekçe) "hangi
   çerezleri neden kullanıyoruz" listesine eklenir.

**Gerekçe (neden rıza gerekmeyebilir):** Yalnızca kullanıcının **kendi açık talebiyle**
("İngilizce'ye geç" tıklaması) tetiklenen ve o talebi bir sonraki ziyarette yerine
getirmeye yarayan bir çerez, GDPR ePrivacy istisnasındaki "kullanıcının açıkça talep
ettiği bir hizmeti sağlamak için kesinlikle gerekli" kategorisine girer (dil tercihi
çerezleri birçok veri koruma otoritesi tarafından bu şekilde sınıflandırılır). **Ancak**
koşul (1) ihlal edilirse — yani çerez kullanıcı hiçbir şey tıklamadan, örn. sayfa
yüklenirken otomatik set edilirse — bu istisna geçerliliğini yitirir ve **çerez onay
bandı (cookie banner) üzerinden ön-onay zorunlu hale gelir**.

**Ek not:** Böyle bir çerez eklenirse, mevcut `SiteSettings.cookieBannerEnabled` alanı
`true` yapılmalı VE (bkz. §5 aşağıda) bugün bu banner'ın public sitede **render edilen bir
karşılığı yok** — önce o boşluk kapatılmalı, aksi halde "onay bandı var" görünümü yanıltıcı
olur.

---

## 4. Hukuki metinlerde §5 "sessiz fallback" istisnası — DEĞERLENDİRME

Architect'in kararı (§5 ve §9 madde 4): normal içerikte alan-bazında sessiz fallback
uygulanır (yarım çeviri, varsayılan dilden tamamlanır), **ama hukuki metinlerde
(KVKK aydınlatma metni, gizlilik politikası, çerez metni) bu kural UYGULANMAZ** — çevrilmemiş
hukuki metin başka dilde gösterilmez, bunun yerine varsayılan dile açık bağlantı verilir.

### Değerlendirme: ONAYLANIYOR — ve normal içerikten farklı olarak bu bir UX tercihi değil, KVKK/GDPR şeffaflık yükümlülüğünün doğrudan sonucu.

**Gerekçe:**
- KVKK m.10 (Aydınlatma Yükümlülüğü) ve GDPR m.12(1) ("concise, transparent, intelligible
  and easily accessible form, using clear and plain language") ilgili kişinin/ziyaretçinin
  **anlayabileceği** bir dilde bilgilendirilmesini gerektirir. `/en/gizlilik` URL'sine giden
  bir ziyaretçiye sessizce Türkçe metin göstermek — ziyaretçi bunun farkında bile
  olmayabilir çünkü URL "en" diyor — bu şeffaflık testini **geçmez**.
- Normal içerikte (ör. bir ürün açıklaması) kısmi/varsayılan dilde fallback bir dönüşüm
  kaybı riskidir; hukuki bir metinde aynı davranış **ilgili kişinin ne'ye rıza gösterdiğini
  veya neyin bilgilendirildiğini kanıtlanamaz hale getirir** — bir denetimde "EN ziyaretçi
  gerçekte ne gördü?" sorusuna verilecek cevap "aslında TR metin, farkında olmadan" ise, bu
  rıza/bilgilendirme temeli **zayıf/tartışmalı** olur.
- Bu nedenle istisna yalnızca "daha iyi UX" değil, **aydınlatma yükümlülüğünün asgari
  koşuludur**: kullanıcıya net biçimde "bu belge şu an [dil] dilinde mevcut değildir,
  Türkçe halini görüntüleyin" denmesi gerekir.

### Ek gereksinimler (bulgular sırasında ortaya çıktı — architect kararında eksik kalan uygulama detayları)

**(a) "Hukuki sayfa" işaretleme mekanizması eksik — bu bağlayıcı bir gereksinim olarak ekleniyor.**
`backend/prisma/schema.prisma` içindeki `Page` modelinde (satır 335+) sayfanın "hukuki
belge" olduğunu belirten hiçbir alan yok (`type`/`category`/`isLegalDocument` benzeri bir
kolon yok — doğrulandı). §5'in genel motoru (backend `applyLocale()`) hangi `Page`
kaydının bu istisnaya tabi olduğunu **bilemez**; slug'a göre sabit kod (`if slug ===
"gizlilik"`) kırılgan ve editör slug'ı değiştirirse sessizce bozulur. **Gereksinim:**
db-agent/backend-agent, `Page` (ve gerekiyorsa gelecekte başka legal içerik türleri) için
açık bir işaretleme alanı eklemeli (ör. `Page.isLegalDocument Boolean @default(false)`
veya editör tarafından ayarlanabilir bir `documentType` enum'ı). Bu, mevcut §2.3'ün
"Page/BlogPost/Product/PortfolioItem yapısal değişiklik YOK" ifadesiyle **çelişiyor** —
architect'e eskale edilmesi gereken tek nokta budur (bu alan yapısal bir değişikliktir).
Bu compliance-agent'ın kendi başına şema kararı veremeyeceği bir husustur; **architect'e
iletiliyor**, backend-agent kendi başına eklemesin.

**(b) Fallback bildirim metninin kendisi de anlaşılır olmalı.** "Bu belge İngilizce
mevcut değil, Türkçesini görüntüleyin" mikro-metni **her dil için sabit/önceden çevrilmiş**
olmalı (içerik editörünün çevirmesine bağlı kalamaz — çünkü tam olarak çeviri eksikken
devreye giren bir mesajdır). Bu, admin chrome sözlüğü (`dictionaries.ts` / namespace
dosyaları, §7.3) gibi **sabit, kod içi bir sözlükte** tutulmalı, `Page.translations`
JSON'unda değil. Öneri anahtarı: `legal.notAvailableInLocale` (parametre: hedef dil adı +
varsayılan dile bağlantı).

**(c) `SiteSettings.cookieBannerText` / `cookieBannerPolicyHref` şu an tek bir `String`
kolonu — locale-aware DEĞİL.** `backend/prisma/schema.prisma:736-738` incelendi:
`cookieBannerEnabled Boolean`, `cookieBannerText String?`, `cookieBannerPolicyHref
String?` — **`Json translations` değil, düz string**. Architect'in i18n kapsamı (§0, §1-8)
`SiteSettings`'e hiç değinmiyor. Bu bir boşluk: banner metni de fiilen bir "hukuki/rıza"
metni olduğundan aynı "sessiz fallback yok" ilkesine tabi olmalı, ama bugünkü şema bunu
**hiçbir dilde ayırt edemiyor** (tek metin, hangi dilde olduğu belirsiz). **Gereksinim:**
banner gerçekten çok dilli hale getirilecekse (§3'teki çerez senaryosu devreye girerse
veya banner ilk kez render edilirse), bu alanların da ya `Json` çeviri alanına dönüşmesi
ya da en azından architect tarafından "kapsam dışı, v1'de yalnızca varsayılan dilde
gösterilir" olarak açıkça karara bağlanması gerekir. Şu an sessizce kapsam dışı
bırakılmış durumda — bunu **açık bir karar** haline getirmek için architect'e iletiliyor.

---

## 5. Mevcut KVKK/gizlilik ile ilgili içerik — inceleme bulguları

Kod tabanında arama yapıldı (`KVKK|GDPR|gizlilik|çerez|cookie|privacy` + `Page`/`footer`/
`navigation` referansları).

**Bulgu 1 — Çerez bandı (cookie banner) yapılandırması VAR ama render edilen bir karşılığı YOK.**
`SiteSettings` modelinde `cookieBannerEnabled/Text/PolicyHref` alanları var
(`backend/prisma/schema.prisma:736-738`), admin `/admin/appearance` ekranında
düzenlenebiliyor (`frontend/src/app/admin/appearance/page.tsx`), ancak **public site
(`frontend/src/app/(site)/**`) içinde bu alanları okuyup gerçekten bir banner bileşeni
render eden hiçbir kod bulunamadı** (`cookieBanner` deseni yalnızca admin dosyalarında
geçiyor). Bu, i18n görevinden **bağımsız, önceden var olan bir boşluktur** — bu görev
kapsamında düzeltilmesi istenmiyor, ancak not ediliyor çünkü:
- Şu an sitede üçüncü taraf izleme/analitik script'i bulunmuyor (yalnızca ilk taraf hata
  izleme — Sentry — tespit edildi; reklam/analitik pikseli yok), dolayısıyla **acil bir
  risk değil**.
- Ama admin panelinde "çerez bandı etkin" görünüp sahada hiç görünmemesi, ileride gerçek
  bir izleme aracı eklendiğinde **yanıltıcı bir uyum görüntüsü** yaratır. §3'teki ziyaretçi
  dil çerezi senaryosu hayata geçerse, banner'ın fiilen render edilmesi **önkoşuldur**.
- **Öneri:** architect'e ayrı (i18n dışı) bir görev olarak iletilsin — bu compliance-agent
  görev kapsamının dışında bir implementasyon eksikliği, sadece flag ediliyor.

**Bulgu 2 — "Gizlilik Politikası" bağlantısı, genel `Page` içerik modeli üzerinden kuruluyor.**
`frontend/tests/unit/a11y-admin-navigation.test.tsx:83` ve
`frontend/src/app/admin/navigation/page.tsx:878` içinde "Gizlilik Politikası" bir
`NavigationItem.href` (`/gizlilik`) olarak geçiyor — yani bu, ayrı bir "hukuki sayfa"
sistemi değil, editörün oluşturduğu **sıradan bir `Page` kaydı**. Bu, doğrudan §4'teki
bulguyu doğruluyor: bu sayfa da diğer `Page` kayıtları gibi `translations Json` alanına
sahip olacak ve **işaretlenmediği sürece** genel §5 sessiz-fallback motoruna tabi olacak.
**Sonuç: §4(a)'daki gereksinim (hukuki sayfa işaretleme) bu bulguyla doğrulandı ve
zorunlu hale geliyor** — mekanizma olmadan, "Gizlilik Politikası" sayfası EN ziyaretçiye
sessizce TR içerikle açılacaktır, bu da architect'in kendi kararını (§9 madde 4) ihlal
eder.

**Bulgu 3 — Kayıt/onay akışlarında KVKK rıza metni bulunamadı.**
`User` modelinde rıza/consent alanı yok (`consent|Consent|marketingOptIn` araması
sonuçsuz), `checkout`/`cart`/`register` akışlarında KVKK aydınlatma metni veya açık rıza
checkbox'ı tespit edilmedi. **Bu, mevcut i18n görevinin kapsamı dışında** (yeni bir alan
eklemek gerektirir, backend-agent + architect kararı gerekir) — ancak genel not olarak
kayda geçiriliyor: eğer ileride bir kayıt/rıza formu eklenirse, o formun metinleri de
aynı "hukuki metin = sessiz fallback yok" kuralına tabi olmalı ve bu görev bittiğinde
yeniden değerlendirilmelidir.

---

## Bağlayıcı gereksinimler (özet — ilgili ajanlar için)

**architect'e eskale:**
- `Page` (ve varsa gelecekte diğer içerik tipleri) için bir "hukuki belge" işaretleme
  alanı gerekiyor (§4a) — bu §2.3'teki "yapısal değişiklik yok" ifadesiyle çelişiyor,
  architect'in karar vermesi gerekiyor (yeni kolon mu, slug konvansiyonu mu, ayrı bir
  `LegalPage` bayrağı mı).
- `SiteSettings.cookieBannerText/PolicyHref`'in çok dilli olup olmayacağı açık karara
  bağlanmalı (§4c) — şu an sessizce kapsam dışı.
- Cookie banner'ın public sitede hiç render edilmediği önceden var olan bir boşluk (§5
  Bulgu 1) — ayrı bir iş olarak değerlendirilmeli.

**frontend-agent için (uygulama zamanı geldiğinde):**
- Hukuki sayfalarda (mekanizma architect'ten netleşince) §5 genel fallback UI'sini
  **kullanma**; bunun yerine sabit, önceden-çevrilmiş bir "bu belge bu dilde mevcut değil,
  [varsayılan dile bağlantı]" bildirimi göster (§4b — `dictionaries.ts`'e
  `legal.notAvailableInLocale` gibi bir anahtar eklenmeli).
- Ziyaretçi dil çerezi önerisi getirilirse, §3'teki 5 koşulu karşıladığından emin ol;
  karşılamıyorsa uygulamadan önce compliance-agent'a tekrar dön.

**backend-agent için:**
- `adminLocale` içerik isteklerine hiçbir zaman `?locale=` olarak geçirilmemeli (zaten
  §7.4'te bağlayıcı — compliance açısından da onaylandı, ekstra bir backend değişikliği
  gerektirmiyor).
- Legal-flag alanı architect tarafından karara bağlandığında, `applyLocale()` ortak
  yardımcısı bu bayrağı görünce §5 yerine §4 davranışını uygulamalı (fallback yapma,
  `translated: false` + varsayılan dile yönlendirme sinyali dön).

---

## Hukuki uyarı

Bu değerlendirme genel KVKK/GDPR prensiplerinin teknik gereksinime çevrilmesidir, hukuki
tavsiye değildir. Özellikle §4'teki "aydınlatma yükümlülüğü" ve §3'teki "çerez istisnası"
yorumları, gerçek bir hukuk danışmanı tarafından (özellikle site canlıya alınmadan ve
gerçek kullanıcı verisi işlenmeden önce) teyit edilmelidir.
