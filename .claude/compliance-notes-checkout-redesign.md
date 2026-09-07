# Compliance Notes — Checkout Yeniden Tasarımı (Adres/Fatura Snapshot)

> **Kapsam:** `.claude/architect-scope-checkout-redesign.md` §7.2 "compliance-agent (BLOKLAYICI)"
> bölümündeki 6 madde. İncelenen implementasyon: `backend/prisma/schema.prisma` (`Order` +
> `BillingType`), `backend/src/lib/pii-mask.ts::maskNationalId`,
> `backend/src/modules/orders/orders.routes.ts` (liste/detay maskeleme),
> `backend/src/modules/checkout/checkout.routes.ts` + `checkout.schemas.ts` (yasal onay yazımı +
> doğrulama kuralları). Frontend tarafı (`frontend/src/components/site/checkout/**`) bu
> değerlendirme anında **henüz yazılmamış** — bu, madde 3'teki bulguyu inşaat ÖNCESİNDE
> düzeltmeyi mümkün kılıyor.
> **Rol hatırlatması:** Bu ajan hukuki tavsiye vermez; KVKK/GDPR genel ilkelerini teknik
> gereksinime çevirir. Aşağıdaki değerlendirmeler bağlayıcı teknik gereksinimlerdir, hukuki
> görüş yerine geçmez — **nihai hukuki onay için gerçek bir hukuk danışmanına
> yönlendirilmelidir**, özellikle gerçek üretim/gerçek kullanıcı verisiyle canlıya alınmadan
> önce.

---

## Özet

| # | Konu | Karar |
|---|---|---|
| 1 | TCKN (`billingNationalId`) | **Onaylanıyor** (hukuki dayanak, opsiyonellik, saklama, maskeleme) — ek gereksinim: field-level amaç açıklaması + saklama gerekçesinin şema yorumuna eklenmesi. |
| 2 | VKN/firma unvanı | **Onaylanıyor** — tüzel kişi verisi KVKK dışı; ancak CORPORATE dalındaki temsilci adı/telefonu KVKK kapsamındadır (zaten aynı rejime tabi, ek değişiklik gerekmiyor). Edge-case notu: şahıs şirketi VKN'si. |
| 3 | Aydınlatma metni | **RELEASE ENGELLEYİCİ (BLOKLAYICI).** Checkout formunda hiçbir noktada genel KVKK Aydınlatma Metni'ne referans/link planlanmamış. Minimum düzeltme aşağıda (§3). |
| 4 | Onay kanıtı yeterliliği | Zaman damgası yaklaşımı **onaylanıyor**. Sözleşme metni sürüm boşluğu **bu fazda kabul edilebilir risk** (blocker DEĞİL), hafif bir iyileştirme önerisiyle. Ayrıca daha kritik bir ikincil bulgu var (§4). |
| 5 | Silme talebi akışı | Mevcut manuel redaksiyon playbook'u (yalnızca `customerEmail`/`customerName`) **yeni ~20 kolonu kapsamıyor — güncellenmesi gerekiyor.** Backend-agent'a somut devir notu var (§5). |
| 6 | (madde 5 db-agent notu) | Doğrulandı: `schema.prisma` satır ~1976 uyarısı fiilen bu duruma işaret ediyor, danışma zorunluluğu bu belgeyle karşılanmış oluyor. |

**Genel sonuç: Release, madde 3'teki minimum düzeltme (bir link + bir kısa metin) yapılmadan
BLOKE'dir.** TCKN'nin kendisi, opsiyonel/koşullu tasarımıyla lawful bulunmuştur — engelleyici
olan TCKN'nin varlığı değil, verinin toplandığı hiçbir noktada aydınlatma yükümlülüğünün
karşılanmamasıdır (bu, TCKN'den bağımsız olarak adres/telefon toplanması için de geçerlidir).

---

## 1. TCKN (`billingNationalId`) KVKK değerlendirmesi

**İncelenen davranış:** `checkout.schemas.ts` — `nationalId` yalnızca `billingType ===
"INDIVIDUAL"` iken kabul edilir, opsiyoneldir, gönderilirse resmî TCKN checksum'ından geçer
(`isValidTcKimlikNo`); `CORPORATE` dalında gönderilmesi 422 ile **reddedilir** (Kural 2).
`pii-mask.ts::maskNationalId` liste görünümünde (`GET /admin/orders`) `123*****901` biçiminde
maskeler, detayda (`GET /admin/orders/:orderId`) ve `GET /users/me/orders*`'ta maskesiz döner.

**Hukuki dayanak:** TCKN, KVKK m.6 anlamında "özel nitelikli kişisel veri" **değildir** (o
kategori sağlık/din/siyasi görüş vb. ile sınırlıdır) — dolayısıyla ayrı bir **açık rıza**
şartı yoktur; genel işleme şartlarından biri yeterlidir. Burada en uygun dayanak **m.5/2-c**
("bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması") ve — fatura
düzenleme eşiği aşılan siparişlerde — **m.5/2-ç** ("veri sorumlusunun hukuki yükümlülüğünün
yerine getirebilmesi için zorunlu olması", VUK kapsamında bireysel faturalarda kimlik bilgisi
talep edilmesi) birleşimidir. Alanın **opsiyonel** olması ve yalnızca müşteri fatura almak
istediğinde doldurulması, bu dayanağı GDPR'daki "contract necessity" ile de uyumlu kılıyor —
zorlama yok, amaç açık (fatura).

**Değerlendirme: ONAYLANIYOR**, aşağıdaki 2 ek gereksinimle:

1. **Amaç şeffaflığı alan seviyesinde eksik.** Şu an TCKN alanının NEDEN istendiğine dair
   planlanan bir mikro-metin yok (architect §6.2 dosya listesinde böyle bir metin belirtilmemiş).
   **Gereksinim (frontend-agent):** `billing-section.tsx`'te TCKN alanının hemen altında/yanında
   sabit bir yardımcı metin gösterilmeli, ör.: *"Bireysel fatura üzerinde T.C. Kimlik No
   gösterilmesini istiyorsanız girin. Bu alan zorunlu değildir."* Bu, hem KVKK m.10'un "açık ve
   anlaşılır" şartını güçlendirir hem de kullanıcının neden böyle bir alanla karşılaştığını
   anlamasını sağlar (bkz. §3'teki genel aydınlatma linkiyle BİRLİKTE, onun YERİNE değil).
2. **Saklama süresi gerekçesi şema yorumunda TCKN'yi kapsamıyor.** `schema.prisma` satır
   1976-1999'daki mevcut yorum yalnızca `customerEmail`/`customerName`'den bahsediyor; TCKN dahil
   yeni kolonlar için AYNI gerekçe (m.5/2-c, m.5/2-ç, tamamlanmış ticari işlem kaydı, muhasebe
   zorunluluğu) geçerli ama METİNDE açıkça YAZILI değil. **Gereksinim (db-agent, dosya sahibi):**
   bu yorumu, TCKN + yeni adres/fatura kolonlarını da kapsayacak şekilde güncelle (bkz. §5'teki
   somut metin önerisi).

**Maskeleme kararı (liste maskeli, detay maskesiz): ONAYLANIYOR** — `customerEmail` ile aynı
gerekçe geçerli (admin detayda gerçek fatura kesmek için tam numaraya ihtiyaç duyar, liste ise
toplu tarama amaçlıdır). **Ek gözlem (blocking değil):** `GET /admin/orders/:orderId` maskesiz
TCKN döndüğü halde bu görüntüleme olayı `logAudit`'e YAZILMIYOR (yalnızca durum değişikliği ve
iade `logAudit` çağırıyor — `orders.routes.ts` satır 146/226; `GET /:orderId` hiç audit
yazmıyor). Bu, `customerEmail` için de önceden var olan bir boşluktu; TCKN eklenmesiyle
hassasiyet arttığından **observability-agent + backend-agent'a** bir görüntüleme-audit'i
eklenmesi öneriliyor (kim, ne zaman, hangi sipariş için maskesiz TCKN görüntüledi) — bu görev
kapsamının BLOKLAYICISI değil, ayrı bir takip maddesi.

---

## 2. VKN/firma unvanı — tüzel kişi verisi değerlendirmesi

`billingCompanyName` ve `billingTaxNumber` (VKN), Türk hukukunda genel kural olarak KVKK
kapsamı DIŞINDADIR — KVKK m.3 "ilgili kişi" tanımı yalnızca **gerçek kişileri** kapsar, tüzel
kişilerin (şirketlerin) verisi kural olarak bu kanunun konusu değildir.

**Ancak dikkat edilmesi gereken 2 nokta:**

1. **CORPORATE dalındaki adres/telefon (temsilci/irtibat bilgisi) KVKK kapsamındadır.**
   `billingType === "CORPORATE"` olduğunda bile `billingAddressFullName`/`billingAddressPhone`
   fiilen bir **gerçek kişinin** (fatura muhatabı/irtibat kişisi) adı ve telefonudur —
   `companyName`/`taxNumber`'ın aksine bu iki alan tüzel kişi verisi değildir. İncelemede bu
   alanların şema/route seviyesinde INDIVIDUAL dalıyla **aynı rejime** tabi olduğu doğrulandı
   (aynı `Order` tablosu, aynı DTO, ayrı bir maskeleme/muafiyet YOK) — bu doğru, **ek bir kod
   değişikliği gerekmiyor**, sadece netlik notu.
2. **Şahıs şirketi (sole proprietorship) edge-case'i.** Türkiye'de bazı şahıs şirketlerinin
   vergi kimlik numarası, işletme sahibinin TCKN'si ile **aynıdır**. Böyle bir durumda
   `billingTaxNumber` alanına girilen değer aslında dolaylı olarak bir gerçek kişiyi tanımlayan
   bir veri haline gelebilir ve "tüzel kişi verisi, KVKK dışı" varsayımı geçersizleşir. Şemadaki
   sabit 10 haneli `taxNumber` regex'i (TCKN 11 hane) bu senaryoda zaten pratik bir sürtünme
   yaratıyor (şahıs şirketi sahibi TCKN'sini 10 haneli alana giremez) — bu **compliance
   kapsamında çözülecek bir konu değil**, ama gözlem olarak not ediliyor: eğer ileride bu tip bir
   ayrım eklenirse (ör. "şahıs şirketi" alt tipi), o zaman VKN alanı da TCKN ile aynı
   hassasiyetle (maskeleme dahil) ele alınmalı.

**Sonuç: ONAYLANIYOR**, ek kod değişikliği gerekmiyor.

---

## 3. Aydınlatma metni — RELEASE ENGELLEYİCİ

**Bulgu:** Architect §6.1 (ui-designer) ve §6.2 (frontend-agent) dosya/görev listesi
incelendi — yalnızca `resolveDistanceSalesPage`/`resolvePreliminaryInfoPage` (mesafeli satış
sözleşmesi + ön bilgilendirme formu, **sözleşme onayı** amaçlı) planlanmış. Checkout formunun
HİÇBİR noktasında (ne `contact-section.tsx`, ne `shipping-address-section.tsx`, ne
`billing-section.tsx`) genel **KVKK Aydınlatma Metni**'ne bir referans/link planlanmamış.
`backend/src/modules/demo-templates/templates/ecommerce-pro.ts` içinde bu sayfa zaten
seed ediliyor (`title: "KVKK Aydınlatma Metni"`, `slug: "kvkk-aydinlatma-metni"`,
`isLegalDocument: true`) ve footer'da linkleniyor — ama **verinin fiilen toplandığı checkout
formunda değil.**

**Neden bu yetersiz/engelleyici:** KVKK m.10 (Aydınlatma Yükümlülüğü) ve GDPR m.13, veri
işlemenin **hangi hukuki dayanağa** oturduğundan bağımsız olarak uygulanır — "sözleşmenin
ifası" dayanağı, aydınlatma yükümlülüğünü ORTADAN KALDIRMAZ, yalnızca ayrı bir açık rıza
gerekliliğini kaldırır. Bugüne kadar bu platform hiç adres/TCKN/vergi no toplamıyordu
(Stripe Hosted Checkout topluyordu, bize hiç gelmiyordu — görev bağlamı); bu görevle birlikte
**ilk kez** bu veriler bizim veritabanımıza yazılıyor. Bu, "ilgili kişinin veri işleme anında
kolayca erişebileceği bir bilgilendirme" beklentisinin en yüksek olduğu andır. Sitenin genel
footer'ında bir yerde link olması KVKK m.10'un asgari şartını marjinal karşılasa bile, iyi
pratik ve ispat edilebilirlik açısından **veri toplama formunun kendisinde** doğrudan bir
referans/link bulunmalıdır — bu, zaten planlanan `resolveDistanceSalesPage`/
`resolvePreliminaryInfoPage` deseniyle birebir aynı maliyette eklenebilir.

**Minimum düzeltme (frontend-agent, mevcut §6.2 dosya listesine ek):**
- `frontend/src/lib/legal-pages.ts`'e üçüncü bir çözümleyici eklenir:
  `resolveKvkkNoticePage(pages)` — `resolveReturnsPolicyPage` ile **birebir aynı** null-safe
  desen (anahtar kelime sezgisi: `kvkk|aydınlatma|gizlilik`; eşleşme yoksa `null`, kırık/uydurma
  bağlantı VERİLMEZ).
- Checkout formunda, kişisel veri toplayan bölümlerin (`shipping-address-section.tsx` ve/veya
  `billing-section.tsx`) üstünde/altında **tek bir kısa not** gösterilir, ör.: *"Bu formda
  paylaştığınız bilgiler [Site Adı] tarafından KVKK kapsamında işlenir. Detaylar için KVKK
  Aydınlatma Metni'ni inceleyebilirsiniz."* — sayfa bulunamazsa (null), not yine gösterilebilir
  ama link atlanır (aynı `resolveReturnsPolicyPage` felsefesi).
- Bu, `legal-consent-section.tsx`'teki `distanceSalesApproved`/`preliminaryInfoApproved`
  checkbox'larının YERİNE GEÇMEZ — onlar ayrı bir hukuki konudur (sözleşme onayı); bu ikisinin
  karıştırılmaması gerekir, ikisi de gerekli.

**Maliyet değerlendirmesi:** Bu, architect'in planına yeni bir dosya/sayfa/altyapı eklemiyor —
zaten planlanmış iki resolver fonksiyonuna üçüncüsünü ekliyor ve mevcut `Field`/metin
bileşenleriyle bir satır not ekliyor. **Engeli kaldıran minimum değişiklik budur.**

---

## 4. Onay kanıtı yeterliliği

`distanceSalesApprovedAt`/`preliminaryInfoApprovedAt` — yaklaşım (boolean değil zaman damgası,
istekten gelen zaman damgası kabul edilmiyor, sunucu `new Date()` üretiyor) **ONAYLANIYOR**:
ispat yükü satıcıdadır ve "onaylandı mı + ne zaman" sorularına doğru/manipüle edilemez bir
cevap veriyor.

**Bilinen boşluk (sözleşme metninin SÜRÜMÜ saklanmıyor):** Admin `Page` içeriğini sonradan
değiştirirse, "müşteri hangi metni onayladı?" sorusu bugünkü şemayla cevaplanamaz.
**Değerlendirme: bu fazda KABUL EDİLEBİLİR bir risk (blocker DEĞİL).** Gerekçe: proje
production değil, şablon/demo kapsamındadır (`Order` model yorumundaki aynı gerekçe — nihai
saklama/ispat politikası gerçek bir hukuk danışmanıyla teyit edilecek); tam bir `Page` revizyon
sistemi (versiyon geçmişi) açmak yeni bir alt sistemdir ve architect bunu §8.1'de zaten bilinçli
olarak "bu fazda değil" diye işaretlemiş — bu karara katılıyorum.

**Hafif, opsiyonel iyileştirme önerisi (blocking değil, backend-agent + db-agent'a devir):**
Tam versiyon geçmişi yerine, checkout anında resolve edilen ilgili `Page` kaydının yalnızca
`updatedAt` zaman damgasını (metnin kendisini DEĞİL) `Order` üzerine 2 nullable kolon olarak
yazmak (`distanceSalesPageVersionAt`/`preliminaryInfoPageVersionAt` gibi) — bu, "hangi an
itibarıyla güncel olan metin onaylandı" sorusuna düşük maliyetli, kaba ama faydalı bir kanıt
ekler. Gerçek üretime geçmeden önce değerlendirilmesi tavsiye edilir; bu fazda ZORUNLU değildir.

**İkincil bulgu (§3.6 ile ilişkili, daha kritik):** Architect §3.6 — ilgili hukuki `Page` hiç
yoksa checkbox **yine de render edilir ve onaylanabilir**, yalnızca link atlanır. Ama
`distanceSalesApproved`/`preliminaryInfoApproved` **zorunlu** alanlardır (`z.literal(true)`,
`checkout.schemas.ts`) — teorik olarak, eğer admin ilgili `Page` kaydını hiç oluşturmamışsa,
müşteri **hiçbir metin görmeden** bu kutuları işaretleyip siparişi tamamlayabilir. Bu, sürüm
sorunundan daha ciddi bir ispat boşluğudur ("hangi versiyon onaylandı" değil, "hiçbir metin
gösterilmedi"). Demo şablonunda (`ecommerce-pro.ts`) bu sayfalar zaten seed edildiği için
pratikte nadir bir durumdur, ama mimari olarak mümkündür. **Blocking olarak işaretlemiyorum**
çünkü (a) bu genel editöryel içerik sorumluluğu kapsamındadır (PDP "İade & Garanti" ile aynı
model, architect'in bilinçli kararı §3.6), (b) demo şablonu varsayılan olarak bu boşluğu
kapatıyor. **Öneri:** documentation-agent/architect, gerçek bir siteyi canlıya almadan önce "bu
3 hukuki sayfanın (KVKK, Mesafeli Satış, Ön Bilgilendirme) admin tarafından oluşturulmuş olması
zorunludur" maddesini bir go-live checklist'ine eklesin.

---

## 5. Silme talebi akışı — güncellenmesi gerekiyor

`grep -r "anonymiz|GDPR|KVKK|right to erasure|data deletion" backend/src` ile arama yapıldı.
İlgili mevcut akış: `backend/prisma/schema.prisma` satır 1976-1999'daki `Order` model yorumu —
**otomatik bir silme/anonimleştirme job'ı YOK** (bilinçli tercih, muhasebe zorunluluğu
gerekçesiyle); bir KVKK m.11 silme talebi gelirse **admin manuel olarak** yalnızca
`customerEmail`/`customerName` alanlarını `[REDACTED]` gibi bir değerle günceller;
`OrderItem`/tutar alanları silinmez. Ayrı bir `POST /admin/orders/:id/anonymize` ucu YOK
(dedike bir uç, "sık talep edilirse" eşiğiyle ileriye bırakılmış). Karşılaştırma için:
`contact.routes.ts`'te `DELETE /submissions/:submissionId` gerçek bir silme ucu var (KVKK silme
talebi karşılığı olarak açıkça yorumlanmış) — `Order` için henüz böyle dedike bir uç yok, tümüyle
manuel.

**Değerlendirme: EVET, mevcut playbook güncellenmelidir** — yeni ~20 kolon (adres, telefon,
TCKN, fatura bilgisi) bu manuel redaksiyon kapsamının DIŞINDA kalıyor; bugünkü haliyle bir admin
"customerEmail/customerName'i redakte ettim, KVKK talebini karşıladım" derse, aynı siparişte
TCKN + tam adres + telefon **açıkta kalmaya devam eder** — bu, silme talebinin fiilen
karşılanmadığı anlamına gelir.

**Backend-agent'a somut devir notu (bu güncelleme compliance-agent'ın kapsamında DEĞİL, yalnızca
değerlendirme + devir):**

1. `schema.prisma` satır 1976-1999'daki yorum (dosya sahibi db-agent, ama içerik/politika kararı
   compliance'tan geliyor) şu şekilde genişletilmeli: manuel redaksiyon kapsamına
   **eklenmesi gerekenler** — `shippingAddressFullName/Phone/Country/City/District/
   Neighborhood/Line1/Line2/PostalCode` (tümü), `billingAddressFullName/Phone/Country/City/
   District/Neighborhood/Line1/Line2/PostalCode` (tümü), `billingNationalId` (kesinlikle —
   doğrudan kimliklendirici). `billingCompanyName`/`billingTaxOffice`/`billingTaxNumber`
   **koşullu**: gerçek bir tüzel kişiye aitse KVKK kapsamı dışıdır, redaksiyon ZORUNLU değil;
   ama şahıs şirketi şüphesi varsa (bkz. §2 edge-case) admin takdirine bırakılarak yine de
   redakte edilebilir.
2. `distanceSalesApprovedAt`/`preliminaryInfoApprovedAt` **SİLİNMEMELİ/REDAKTE EDİLMEMELİ.**
   Bunlar veri sahibinin kimliğini taşımayan, yalnızca satıcının kendi yasal onay sürecini
   izlediğine dair ispat kayıtlarıdır (m.5/2-ç saklama gerekçesi devam eder) — silinmesi,
   satıcının kendi hukuki savunmasını zayıflatır ve KVKK açısından hiçbir kazanım sağlamaz.
3. **Muhasebe/fatura istisnası (bilgi notu, hukuki tavsiye değildir):** Bu platform e-fatura/
   e-arşiv entegre değildir (architect §1 "DIŞINDA") — yani bu sistemin ürettiği veri, resmi bir
   fatura değildir. Ancak site sahibi bu verilerle **harici bir muhasebe sisteminde** gerçek bir
   fatura kesmişse, VUK/TTK saklama süresi (5-10 yıl) boyunca o harici kaydı ayrıca saklamakla
   yükümlü olabilir — bizim platformumuzdaki redaksiyon o dış kaydı KAPSAMAZ/SİLMEZ. Bu nüansın
   admin arayüzünde bir uyarı notu olarak gösterilmesi (ör. "Bu redaksiyon yalnızca bu sistemdeki
   kaydı etkiler; harici muhasebe kayıtlarınızı ayrıca gözden geçirin") ÖNERİLİR, blocking değil.
4. **Operasyonel öneri (blocking değil):** Önceki tasarımda (yalnızca 2 kolon:
   `customerEmail`/`customerName`) manuel tek-tek redaksiyon makul bir maliyetti. Şimdi ~20
   kolon var — manuel süreç, bir kolonun unutulması riskiyle (eksik/yarım silme) çok daha kırılgan
   hale geldi. **Backend-agent'a öneri:** dedike bir `POST /admin/orders/:id/anonymize` action'ı
   eklemeyi (architect onayıyla) değerlendirsin — mevcut şema yorumundaki "sık talep edilirse
   eklenebilir" eşiği, artık daha düşük bir maliyet-fayda noktasında aşılmış durumda (hata riski
   arttı, uygulama maliyeti düşük: tek bir Prisma `update` çağrısında tüm ilgili alanları
   `null`'lamak).

---

## 6. Genel "danışma zorunluluğu" doğrulaması

Architect §7.2 madde 5, `schema.prisma` satır ~1980'deki "adres/telefon v1 kapsamı dışında
bilinçli olarak toplanmıyor — yeni bir alan eklenmeden önce compliance-agent'a danışılmalı"
notunun tam olarak bu durumu işaret ettiğini belirtiyor. **Doğrulandı ve bu belge o danışma
yükümlülüğünü karşılıyor.** db-agent/backend-agent bu görevi bu belgeye referans vererek
ilerletebilir.

---

## Bağlayıcı gereksinimler (özet — ilgili ajanlar için)

**RELEASE ENGELLEYİCİ (frontend-agent, kod yazmadan önce plana eklenmeli):**
- `frontend/src/lib/legal-pages.ts`'e `resolveKvkkNoticePage` eklenir (§3).
- Checkout formunda kişisel veri toplayan bölümlerde KVKK Aydınlatma Metni'ne kısa
  not + link gösterilir (§3).

**backend-agent için (blocking değil, takip):**
- TCKN alanı için amaç açıklayan mikro-metin — bu aslında frontend metni ama backend'in
  Zod hata mesajı/alan sözlüğüyle tutarlı olmalı (§1 madde 1).
- Manuel redaksiyon playbook'unu yeni ~20 kolonu kapsayacak şekilde güncelleme + dedike
  `POST /admin/orders/:id/anonymize` action'ı değerlendirmesi (§5).
- `GET /admin/orders/:orderId` maskesiz TCKN görüntülemesi için audit log eklenmesi
  (observability-agent ile birlikte, §1).

**db-agent için (blocking değil, dosya sahibi):**
- `schema.prisma` satır 1976-1999'daki yorumu TCKN + yeni adres/fatura kolonlarını kapsayacak
  şekilde genişletme (§1, §5).
- (Opsiyonel, üretim öncesi) `Page` sürüm-kanıtı için 2 nullable timestamp kolonu değerlendirmesi
  (§4).

**architect/documentation-agent için (blocking değil):**
- Go-live checklist'ine "KVKK Aydınlatma Metni + Mesafeli Satış Sözleşmesi + Ön Bilgilendirme
  Formu sayfalarının admin tarafından oluşturulmuş olması zorunludur" maddesinin eklenmesi (§4).

---

## Hukuki uyarı

Bu değerlendirme genel KVKK/GDPR prensiplerinin teknik gereksinime çevrilmesidir, hukuki
tavsiye değildir. Özellikle §1'deki hukuki dayanak yorumu, §4'teki "kabul edilebilir risk"
değerlendirmesi ve §5'teki muhasebe/fatura istisnası notu, gerçek bir hukuk danışmanı
tarafından — özellikle site gerçek üretime alınmadan ve gerçek müşteri verisi işlenmeden önce —
teyit edilmelidir.
