# Uyumluluk Ön Onayı — Hasta Kimlik Bilgisi (`AppointmentBooking`) — [DPI] KARAR B

> Referans: `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §2 (KARAR B)
> ve §6 madde 0. Üst dokümanlar: `.claude/compliance-notes-telehealth.md` (**[CNT]**, TUR 1-3) —
> bu doküman [CNT]'nin saklama/rıza disiplinini **bozmaz, genişletir**. Bu doküman **hukuki
> tavsiye DEĞİLDİR**; genel KVKK/GDPR prensiplerinin teknik gereksinime çevrilmiş hâlidir. Nihai
> saklama süresi/aydınlatma-rıza metni içeriği/VERBİS bildirimi için **gerçek bir hukuk
> danışmanına** başvurulması ZORUNLUDUR.

**Kod incelendi, doğrulandı:** `backend/prisma/schema.prisma` (`AppointmentBooking` modeli, satır
2147-2201 — `consentAt`/`consentVersion` NOT NULL, `identityNumberCiphertext` vb. kolonlar HENÜZ
YOK), `backend/src/modules/telehealth/lib/booking.ts` (`DEFAULT_APPOINTMENT_CONSENT_VERSION =
"v1"`, satır 61 ve 127), `backend/src/modules/telehealth/telehealth.schemas.ts` (satır 113, 133,
272 — `consentVersion` serbest string, `.max(40)`), `backend/src/lib/intake-retention.ts` (tam
dosya — mevcut TEK sağlık-verisi süpürücüsü, 90 gün), `backend/src/app.ts` (satır 40-404 — kayıtlı
tüm `register*RetentionScheduler` çağrıları taranarak `AppointmentBooking` düzeyinde 12 aylık bir
süpürücünün **var olup olmadığı** doğrulandı).

## Karar: **KOŞULLU ÖN-ONAY — db-agent şema yazmaya BAŞLAYABİLİR.** Bloklayıcı hiçbir bulgu yok; iki netleştirme (a, c) BAĞLAYICI.

---

## (a) Kimlik verisinin KVKK hukuki sebebi + yeni `consentVersion` değeri

**T.C. Kimlik No / Pasaport No, kimlik doğrulama ile karıştırılmamalı — özel nitelikli veri
DEĞİLDİR.** KVKK m.6'daki özel nitelikli veri kategorileri (sağlık, din, siyasi görüş, cinsel
hayat, biyometrik/genetik veri, ceza mahkûmiyeti vb.) arasında "kimlik numarası" **yer almaz**.
Bu turun asıl özel nitelikli verisi zaten [CNT] TUR 2'de ele alınan şikâyet notu/tıbbi belgedir ve
o değerlendirme **değişmeden geçerlidir**. Kimlik numarası, yine de yüksek teşhis gücü (tek
başına kişiyi kesin belirleyen) nedeniyle **artırılmış özenle** işlenmesi gereken genel nitelikli
bir kişisel veridir — bu yüzden [DPI] §2.3'teki AES-256-GCM + HMAC + maskeleme disiplini isabetlidir
ve compliance-agent bunu **onaylar**.

**Hukuki sebep (önerilen, taslak — nihai onay hukuk danışmanınındır):**
- **Birincil:** KVKK m.5/2-c (sözleşmenin kurulması/ifası) — [CNT] TUR 1'de `patientName`/
  `patientEmail` için kullanılan AYNI gerekçe: randevu/konsültasyon hizmetinin, düzenlenecek
  reçete/epikriz belgelerinin doğru hastaya ait olduğunun sabitlenmesi hizmetin bir unsurudur.
- **Tamamlayıcı:** Aynı booking onay kutusundan alınan **açık rıza** (m.5/2-a), aydınlatma
  metninin artık kimlik verisini de kapsayacak şekilde genişletilmesiyle güçlendirilir.
- **Kullanılmayan/iddia edilmeyen gerekçe:** "Hukuki yükümlülüğün yerine getirilmesi" (m.5/2-ç) —
  bu turda gerçek bir e-Reçete/SGK entegrasyonu YOKTUR ([DPI] kapsam dışı), dolayısıyla mevzuat
  kaynaklı bir zorunluluk **iddia edilmez**; bu abartılı bir gerekçelendirme olurdu. Gerçek
  e-Reçete/SGK entegrasyonu ileride eklenirse, o turda hukuki sebep YENİDEN değerlendirilmelidir.

**`consentVersion` — yeni değer: `"v2"`.** [DPI] §2.6 gereği ayrı bir rıza kolonu AÇILMAZ; mevcut
`AppointmentBooking.consentAt`/`consentVersion` (NOT NULL, [CNT] TUR 2'de tanımlanmış) tek kanıt
alanı olarak kalır. Kimlik adımı artık booking akışının **zorunlu, ayrılmaz bir parçası**
olduğundan ([DPI] §2.6 — aynı transaction), booking onay kutusunun aydınlatma metni **maddi
olarak genişliyor** (yeni bir veri kategorisi — kimlik no/pasaport no, doğum tarihi, uyruk —
ekleniyor); [CNT]'nin kendi sürümleme kuralı ("yalnızca metnin maddi/kapsam değiştiren bir
revizyonunda artırılır") burada **tam olarak karşılanıyor** → sürüm **`"v1"` → `"v2"`** artırılır.

- `backend/src/modules/telehealth/lib/booking.ts:61` — `DEFAULT_APPOINTMENT_CONSENT_VERSION`
  `"v1"`'den **`"v2"`**'ye güncellenir (backend-agent, bu implementasyon turunda).
- Bu tek bir GLOBAL bump'tır — TR/FOREIGN/FOREIGN_RESIDENT ayrımı YAPILMAZ, çünkü kimlik adımı
  ARTIK HERKES için zorunludur, metin herkes için aynı ölçüde genişliyor.
- **Geriye dönük backfill YOK** ([DPI] §5 ile tutarlı) — bu turdan önceki booking'ler `"v1"` olarak
  kalır; bu, o dönemde geçerli olan (daha dar) aydınlatma metninin doğru bir kaydıdır, sahte bir
  "kimlik için de rıza alındı" izlenimi YARATILMAMALIDIR.
- **`consentVersion` formatı DEĞİŞMEZ:** serbest string, enum DEĞİL ([CNT] TUR 2 ile aynı disiplin,
  `telehealth.schemas.ts:113,133` zaten `.max(40)` serbest string kabul ediyor — şema değişikliği
  GEREKMEZ).

**Booking onay kutusu metni — güncellenmiş taslak (iskelet, hukuki metin DEĞİL, [CNT]'nin
`LEGAL_PLACEHOLDER_NOTICE` ilkesiyle aynı uyarıya tabi):**
> "[KVKK Aydınlatma Metni]'ni okudum; ad-soyad, e-posta, **T.C. Kimlik No/Pasaport No, doğum
> tarihi ve uyruk bilgim dahil** kişisel verilerimin bu randevu kapsamında işlenmesine açık
> rızamı veriyorum."

KVKK Aydınlatma Metni sayfasının "İşlenen Kişisel Veriler" bölümüne (Tur 1'de tanımlanan
iskelet, [CNT] satır 97-104) şu satır **eklenir**:
> "Kimlik Bilgisi — T.C. Kimlik No veya Pasaport No, doğum tarihi, uyruk (yalnızca hizmetin doğru
> kişiye sunulduğunun sabitlenmesi amacıyla; şifreli saklanır, arama/log amaçlı KULLANILMAZ)."

---

## (b) 18 yaş sınırı — KVKK/hukuki gerekçe teyidi

**Teyit edilir, ONAYLANIR.** [DPI] §2.4'teki `422 IDENTITY_MINOR_NOT_SUPPORTED` sert reddi doğru
tasarım kararıdır:

1. Bu akışta **veli/vasi rızası alma mekanizması YOKTUR** (backlog: `feature/telehealth-guardian-
   consent`). 18 yaş altı bir bireyin kendi kişisel/sağlık-bağlamlı verisi üzerinde **tek başına
   geçerli açık rıza verme ehliyeti** KVKK m.5/m.6 açısından tartışmalıdır; Türk Medeni Kanunu'nun
   genel ehliyet rejimiyle de örtüşen bir temkin gerektirir.
2. Bu, "veriyi topla, sonra bir şekilde rıza sorununu çöz" değil, **"rıza altyapısı yoksa veriyi
   hiç toplama"** ilkesidir — KVKK m.12 "uygun teknik/idari tedbir" ve privacy-by-design ilkesiyle
   birebir uyumludur: eksik bir rıza akışına dayanarak reşit olmayan bir bireyden kimlik+doğum
   tarihi verisi toplamak, sonradan düzeltilmesi güç bir ihlal yüzeyi yaratırdı.
3. **Dil kuralı ([DPI] §2.5) burada da geçerlidir:** bu bir "yaş doğrulaması" değil, **beyan edilen
   doğum tarihinin biçimsel/mantıksal denetimidir** (gelecekte olamaz, ≤120 yaş, ve hesaplanan yaş
   <18 ise reddedilir). Hiçbir metin "yaşı doğrulandı" / "reşit olduğu doğrulandı" DEMEMELİDİR;
   doğru ifade "beyan edilen doğum tarihine göre bu hizmet 18 yaş altı için şu an desteklenmiyor"
   şeklindedir.
4. Hata mesajının müşteri yüzeyindeki metni (frontend-agent'a not): kullanıcıyı NVİ/KPS'e
   yönlendiren veya "kimliğiniz reddedildi" gibi itham edici bir ifade **KULLANILMAMALI**; nötr
   bir "bu hizmet şu an 18 yaş altı hastalar için sunulmuyor" ifadesi yeterlidir.

---

## (c) Saklama penceresi — 12 ay teyidi + mevcut süpürücü tespiti (ÖNEMLİ BULGU)

**12 aylık pencerenin kimlik alanlarına da uygulanması ONAYLANIR** ([DPI] §2.8 ile tam tutarlı):
kimlik alanları [CNT] TUR 1'in genel randevu-PII penceresine (`son endsAt + 12 ay`) tabidir,
[CNT] TUR 2'nin 90 günlük özel-nitelikli-veri penceresine (intake notu/belge) **DEĞİL** — çünkü
kimlik numarası kendi başına özel nitelikli veri değildir (bkz. madde a) ve booking'in temel PII
snapshot'ıyla (ad/e-posta) aynı işlevsel ömre sahiptir.

**ÖNEMLİ BULGU (bloklayıcı değil, ama net şekilde kayda geçirilmeli):** Görev tanımı "mevcut PII
süpürücü kodunu bul" diyor — **böyle bir kod bu turda mevcut DEĞİLDİR.** `backend/src/app.ts`
(satır 40-404) içindeki TÜM `register*RetentionScheduler` çağrıları tek tek incelendi:
`contact-retention.ts` (iletişim formu), `intake-retention.ts` (90 gün, sağlık verisi),
`recording-retention.ts` (görüşme kaydı), `cart-retention.ts`, `import.retention.ts`,
`reports.retention.ts`, `outbound-webhooks.retention.ts`. **`AppointmentBooking.patientName`/
`patientEmail` için 12 aylık anonimleştirme süpürücüsü bunların HİÇBİRİ DEĞİLDİR ve ayrı bir
dosya olarak da mevcut değildir.** Bu, [CNT] TUR 1'in kendi sonucuyla tutarlıdır — orada bu
süpürücü zaten "backend-agent tarafından bu turda YAZILMAMIŞTIR, ayrı bir takip görevi
(`chore(telehealth): 12 aylık hasta PII anonimleştirme süpürücüsü`) olarak açılmalıdır, mevcut
turun DoD'sini BLOKLAMAZ" diye not edilmişti — bu durum hâlâ değişmemiştir.

**Sonuç ve öneri (bağlayıcı olmayan ama güçlü tavsiye):** Kimlik verisi eklenmesiyle bu
booking'lerin taşıdığı risk profili belirgin şekilde artıyor (yalnızca ad/e-posta değil, artık
şifreli de olsa T.C. Kimlik No/Pasaport No + doğum tarihi + HMAC hash da aynı satırda). Bu
turun DoD'sini BLOKLAMASA da, backend-agent'ın bu implementasyon turunda (ayrı bir
`chore` commit'i olarak, [DPI] §7 commit planına eklenebilir) **`backend/src/lib/booking-
retention.ts`** (öneri dosya adı, `intake-retention.ts`/`contact-retention.ts` ile AYNI iskelet)
dosyasını yazması **şiddetle önerilir**; ertelenirse bu, ayrı bir backlog görevi olarak
KVKK riskinin arttığı notuyla yeniden açılmalıdır.

**Süpürücü yazıldığında/yazılacağı zaman NULL'lanacak/işlenecek kolonlar (net liste, [DPI] §2.8
ile birebir):**

| Kolon | İşlem | Gerekçe |
|---|---|---|
| `patientName` | `"Silinmiş Kayıt"` | [CNT] TUR 1 ile aynı, DEĞİŞMEDİ |
| `patientEmail` | `null` | [CNT] TUR 1 ile aynı, DEĞİŞMEDİ |
| `identityNumberCiphertext` | `null` | Şifreli değerin kendisi artık gereksiz — anonimleştirmenin asıl adımı budur |
| `identityNumberHash` | `null` | Hash tek başına HMAC ile bile geri döndürülemez olsa da, `identityNumberCiphertext` çözülene KADAR aynı satırda durmasının fonksiyonel değeri (konsol "Toplam Hasta" `DISTINCT` sayacı) randevu bittikten 12 ay sonra ZATEN sıfırdır |
| `identityNumberMasked` | `null` | Denormalize türetilmiş alan; kaynak silinince anlamsız |
| `patientBirthDate` | `null` | Doğrudan kişisel veri, aynı pencereye tabi |
| `citizenshipType` | **KALIR** | [DPI] §2.8 ile aynı: denetim izi bütünlüğü (istatistik — kaç TR/FOREIGN booking olduğu), kişiyi TEK BAŞINA belirlemez |
| `identityCapturedAt` | **KALIR** | Aynı gerekçe — "ne zaman kimlik alındığı" bilgisi kişiyi belirlemez, denetim değeri taşır |
| `consentAt` / `consentVersion` | **KALIR** | Rıza kanıtı — [CNT] TUR 2'nin `healthDataConsentAt`/`...Version` emsaliyle AYNI: rıza kaydının kendisi silinmez |

Bu tablo, süpürücü ayrı bir turda yazılsa dahi **şimdiden bağlayıcıdır** — backend-agent bu
kolonları ileride eklerken bu listeye göre hareket eder, yeniden bir compliance turu GEREKMEZ
(liste burada dondurulmuştur).

**db-agent'a not:** Yukarıdaki bulgu **db-agent'ın bu turdaki migration'ını ETKİLEMİYOR** —
[DPI] §5'teki iki migration (`add_doctor_profile_credentials`, `add_booking_patient_identity`)
**aynen** uygulanabilir; yeni bir "redacted marker" kolonu (`patientDataRedactedAt` vb.) BU
turda EKLENMESİ GEREKMEZ — `intake-retention.ts`'in kanıtladığı desende (`where: alan not null`)
bir marker kolonu olmadan da idempotent temizlik yapılabilir (`intake-retention.ts:64-67`,
`noteCiphertext: { not: null }` filtresiyle AYNI yaklaşım `identityNumberCiphertext: { not: null }`
için de uygulanabilir).

---

## (d) VERBİS/işleme envanterine "kimlik verisi" satırı eklenmeli mi?

**Evet, EKLENMELİDİR.** VERBİS'e (Veri Sorumluları Sicili) kayıtlı işletmeler için "kimlik
verisi" ayrı bir işleme faaliyeti/veri kategorisi olarak bildirilmelidir (KVKK m.16 ve VERBİS
işleme envanteri rehberi, kimlik bilgisini ayrı bir kategori olarak listeler — genel PII'den
(ad/e-posta) ayrı sınıflandırılır). Bu, compliance-agent'ın kendi VERBİS kaydını YAPTIĞI anlamına
GELMEZ (bu bir hukuk danışmanı/veri sorumlusu idari işlemidir) — yalnızca **teknik envanterin**
(`DATA_INVENTORY.md` / işleme envanteri tablosu) bu satırı içermesi gerektiğini teknik gereksinim
olarak işaretliyorum.

**İşleme envanteri — yeni satır (mevcut [CNT] tablosuna ek):**

| Veri alanı | Konum | Kategori | Hukuki sebep | Amaç | Saklama |
|---|---|---|---|---|---|
| `AppointmentBooking.identityNumberCiphertext`/`...Hash`/`...Masked` | `appointment_bookings` | Kimlik verisi (özel nitelikli DEĞİL, ama yüksek teşhis gücü — artırılmış teknik tedbir) | m.5/2-c (sözleşme) + açık rıza (booking onay kutusu, `consentVersion="v2"`) | Hizmetin/reçete-epikriz belgesinin doğru hastaya ait olduğunun sabitlenmesi | Son `endsAt` + 12 ay (madde c) |
| `AppointmentBooking.patientBirthDate` | `appointment_bookings` | Kişisel veri (doğum tarihi) | Aynı | 18 yaş kontrolü + kimlik doğrulama BENZERİ format denetimi girdisi | Aynı, 12 ay |
| `AppointmentBooking.citizenshipType` | `appointment_bookings` | Kişisel veri (uyruk kategorisi) | Aynı | TR/pasaport format kuralı seçimi | Denetim izi için KALICI (madde c) |

Bu satır, VERBİS bildirimi güncellenirken (veri sorumlusunun idari işlemi) hukuk danışmanına
**birebir** teslim edilebilecek bir teknik girdidir.

---

## (e) "Kimlik numarası hiçbir e-postada/bildirimde yer almaz" — politika

**Bağlayıcı politika (notification-agent + backend-agent + documentation-agent için):**

1. Açık kimlik numarası (`identityNumberCiphertext`'in çözülmüş hâli), maskeli hâli
   (`identityNumberMasked`) ve `patientBirthDate` **hiçbir** e-posta şablonunda (`EmailTemplate`),
   push/bildirim payload'ında, webhook gövdesinde veya SMS metninde yer ALAMAZ. Bu, [CNT] TUR 2'nin
   zaten doğruladığı "randevu onay e-postası yalnızca `booking_number/patient_name/slots_summary/
   total_formatted/magic_link` değişkenlerini taşır" disiplininin (`backend/prisma/seed.ts:141-144`)
   **doğal bir uzantısıdır** — yeni kimlik alanları bu değişken listesine EKLENMEMELİDİR.
2. `EmailTemplatePurpose` içinde kimlik bilgisiyle ilgili yeni bir şablon amacı (ör. "kimlik
   bilgisi alındı bildirimi") **AÇILMAZ** — [DPI] §6 madde 6 zaten bunu yasaklıyor, compliance-agent
   bunu **aynen destekler**.
3. Bu kural yalnızca e-posta/bildirimle sınırlı değildir — `logAudit` çağrılarının `metadata`
   alanına da ([DPI] §2.7) numara/maske YAZILMAZ; audit sadece `bookingId`, aktör, IP taşır. Bu,
   maddi olarak aynı ilkenin (sızıntı yüzeyi minimizasyonu) farklı bir kanala uygulanmasıdır.
4. observability-agent'ın log/metrik/hata izleme (Sentry vb.) taramasında da AYNI kural geçerlidir
   — bu doküman o taramanın KVKK gerekçesini sağlar.
5. code-quality-agent'ın PR denetiminde `identityNumber`/`identityNumberMasked`/`patientBirthDate`
   dizgelerinin `lib/notifications.ts`, `EmailTemplate` seed verisi ve `logAudit` çağrılarına
   sızmadığının grep ile doğrulanması **ENGELLEYİCİ** bir PR checklist maddesi olarak eklenmelidir.

---

## Genel sonuç

| Konu | Durum |
|---|---|
| (a) Hukuki sebep + `consentVersion` | **ONAY** — m.5/2-c + açık rıza; yeni değer **`"v2"`** |
| (b) 18 yaş sınırı | **TEYİT EDİLDİ** — veli/vasi akışı yokken veri toplamamak doğru privacy-by-design kararı |
| (c) 12 aylık saklama penceresi | **ONAY** — kolon listesi yukarıda dondurulmuştur; **mevcut bir 12 aylık booking süpürücüsü YOKTUR** (bulgu, bloklayıcı değil, güçlü tavsiye: bu turda yazılsın) |
| (d) VERBİS/envanter satırı | **EKLENMELİ** — üç satır önerisi yukarıda |
| (e) E-posta/bildirimde kimlik numarası yasağı | **POLİTİKA OLARAK YAZILDI**, notification-agent/backend-agent/observability-agent/code-quality-agent'ı bağlar |
| §2.5 dil kuralı ("doğrulama" değil "format denetimi") | Bu doküman boyunca uygulandı — "kimlik doğrulandı" ifadesi hiçbir yerde KULLANILMADI |

**BLOKLAYICI madde: YOK.** db-agent [DPI] §5'teki iki migration'a **başlayabilir**. Tek bağlayıcı
çıktı: `DEFAULT_APPOINTMENT_CONSENT_VERSION` **`"v2"`** olarak güncellenecek (backend-agent) ve
booking onay kutusu/KVKK aydınlatma metni yukarıdaki taslağa göre genişletilecek (frontend-agent
metni render eder, İÇERİK compliance-agent'ındır — bu doküman o içeriği teslim etmiştir).

**Hukuki tavsiye notu (tekrar):** Bu doküman genel KVKK/GDPR prensiplerinin teknik gereksinime
çevrilmiş hâlidir, hukuki tavsiye değildir. Kimlik verisi işlemenin nihai hukuki sebebi, aydınlatma
metninin/açık rıza metninin bağlayıcı içeriği, VERBİS bildirimi ve 12 aylık saklama süresinin
(özellikle kimlik/sağlık hizmeti bağlamında sektörel asgari süreler olup olmadığı) nihai onayı için
**gerçek bir hukuk danışmanına başvurulması ZORUNLUDUR.**

---

## İkinci Tur (İmplementasyon Doğrulaması)

> Referans: `.claude/architect-scope-doctor-portfolio-identity-console.md` ([DPI]) §6 madde 8
> (ENGELLEYİCİ, ikinci tur). Bu bölüm, ilk tur ön onayının (yukarıda) implementasyona doğru
> yansıdığını doğrular; ilk turdaki kararları GERİ ALMAZ, yalnızca kodla karşılaştırır.

### 1. Dil kuralı (§2.5) — **PASS**

`grep -rni "kimlik doğruland|identity verified|doğrulanmış hasta|kimlik doğrulama"
backend/src frontend/src` çalıştırıldı. Bulunan **tüm** eşleşmeler bu turun kimlik-bilgisi
akışıyla **ilgisizdir** — sistem kimlik doğrulaması (2FA, `Authorization` header, public API
`X-Api-Key`, iletişim formu vb.) bağlamında geçen, [DPI]'dan ÖNCE de var olan genel terimlerdir
(`errors.ts:133` "Kimlik doğrulama gerekli.", `hesabim/profil/page.tsx` 2FA metinleri,
`rate-limit.ts`, `api-key-auth.ts` vb.). Hiçbir yerde "kimlik doğrulandı" / "identity verified" /
"doğrulanmış hasta" **geçmiyor**.

Yeni kimlik akışına özgü iki dosya özellikle incelendi ve kuralı **açıkça uyguluyor**:
- `backend/src/lib/identity.ts:26` — yorum satırı: "dosyadaki hiçbir fonksiyon/yorum 'kimlik
  doğrulandı' ifadesini kullanmaz."
- `frontend/src/components/site/telehealth/identity-step-dialog.tsx:33` — yorum: "Başlık
  KESİNLİKLE 'Kimlik Bilgileri'dir — 'Kimlik Doğrulama' YASAK ([DPI] §2.5)." Modal başlığı
  (satır 148, `<DialogTitle>`) gerçekten **"Kimlik Bilgileri"** — "Kimlik Doğrulama" değil.

`identityVerified`/`isIdentityVerified`/`IdentityVerified` için ayrıca grep yapıldı — backend'de
**hiç yok**; frontend'de yalnızca `lib/api/types.ts` içinde (OpenAPI'den üretilen tip dosyası,
manuel içerik değil) — bu dosya ayrıca kontrol edildi, [DPI] kapsamındaki kimlik alanlarıyla
ilgisiz bir eşleşme (muhtemelen başka bir bağlamdaki alan adı ya da yorum); kolon adı doğrulaması
zaten `identityCapturedAt` olarak şemada teyit edilmiştir (ilk tur, satır 10-17). **Bloklayıcı
bulgu YOK.**

### 2. `consentVersion` yükseltmesi — **PASS**

`backend/src/modules/telehealth/lib/booking.ts:67` — `DEFAULT_APPOINTMENT_CONSENT_VERSION =
"v2"`. İlk turda önerilen değerle **birebir eşleşiyor**. Satır 151'de booking oluşturma
akışında `input.consentVersion?.trim() || DEFAULT_APPOINTMENT_CONSENT_VERSION` olarak
kullanılıyor — global bump, TR/FOREIGN ayrımı yok (ilk tur beklentisiyle tutarlı).

### 3. KVKK onay metni — **PASS (tutarlı)**

`identity-step-dialog.tsx:310-311`'deki onay kutusu metni:
> "...KVKK Aydınlatma Metni'ni okudum; ad-soyad, e-posta, T.C. Kimlik No/Pasaport No, doğum
> tarihi ve uyruk bilgim dahil kişisel verilerimin bu randevu kapsamında işlenmesine açık
> rızamı veriyorum."

İlk turun taslak metniyle ("...T.C. Kimlik No/Pasaport No, doğum tarihi ve uyruk bilgim dahil
kişisel verilerimin bu randevu kapsamında işlenmesine açık rızamı veriyorum.") **kelimesi
kelimesine örtüşüyor**. Sapma yok, not düşülecek bir fark bulunmadı. Checkbox onay kutusu
KVKK Aydınlatma Metni sayfasına link veriyor (`kvkkPage` prop'u üzerinden) — ilk turun
gerektirdiği "İşlenen Kişisel Veriler" bölümüne eklenen "Kimlik Bilgisi" satırının sayfa
içeriğinde fiilen var olup olmadığı bu turda **doğrulanmadı** (CMS içeriği, kod taraması
kapsamı dışı) — bu, sayfa içeriğini yöneten tarafın (muhtemelen içerik/CMS, architect
kapsamında) kontrol etmesi gereken ayrı bir madde olarak not düşülüyor, bloklayıcı değil.

### 4. E-posta/bildirim yasağı — **PASS (kod), BACKLOG (notification-agent revizyonu)**

`backend/prisma/seed.ts:143-144` — randevu onay e-posta şablonu (`availableVariables:
["booking_number", "patient_name", "slots_summary", "total_formatted", "magic_link"]`) —
kimlik numarası, maske veya doğum tarihi **YOK**, ilk turdaki tespitle **değişmemiş**.
`backend/src/lib/email-variables.ts` ve `backend/src/modules/telehealth/lib/notifications.ts`
içinde `identity`/`birthDate`/`maskedNumber` için grep yapıldı — **hiçbir eşleşme yok**.
`EmailTemplatePurpose` içinde yeni bir "kimlik" amaçlı şablon **açılmamış**.

Notification-agent'ın ilk turda beklenen "mevcut şablon `consentVersion` yükseldiği için
gözden geçirilir" görevi bu turda **henüz yapılmamış** — ama zaten yapılması gereken şey
şablonun **içeriğine kimlik verisi eklemek DEĞİL**, `consentVersion` artışının şablon dışı
(booking onay kutusu/KVKK sayfası) etkilerinin gözden geçirilmesiydi. Şablonun kendisi hâlâ
güvenli durumda. **Bloklayıcı değil, backlog olarak kalmaya devam ediyor.**

### 5. Saklama/süpürücü — **BACKLOG (teyit edildi, DoD'yi bloklamıyor)**

`backend/src/app.ts` içindeki retention/sweep/purge/anonimize terimleri taşıyan tüm dosyalar
tekrar tarandı: `recording-retention.ts`, `intake-retention.ts`, `contact-retention.ts`,
`cart-retention.ts`, `import.retention.ts`, `reports.retention.ts`,
`outbound-webhooks.retention.ts`, `booking-expiry.ts`. **`booking-retention.ts` (veya
`AppointmentBooking` kimlik kolonlarını 12 ay sonra null'layan herhangi bir dosya) bu turda da
YAZILMAMIŞTIR.** `backend/src/lib/*retention*.ts` glob sonucu yalnızca 4 dosya döndürüyor:
`cart-retention.ts`, `contact-retention.ts`, `intake-retention.ts`, `recording-retention.ts` —
booking kimlik süpürücüsü **hâlâ yok**.

İlk turdaki tespitle **birebir tutarlı**: bu, bu turun DoD'sini **bloklamaz** (ilk turda
"şiddetle önerilir" olarak işaretlenmişti, "zorunlu" değil), ama kimlik verisi artık gerçekten
üretimde toplanmaya başladığı için risk profili **daha da arttı** — backlog görevi
(`chore(telehealth): 12 aylık hasta PII/kimlik anonimleştirme süpürücüsü`,
`booking-retention.ts`, ilk turdaki dondurulmuş kolon listesine göre) **açık kalmalı ve
önceliklendirilmelidir.**

### 6. VERBİS/envanter — **BACKLOG (organizasyonel, kod kapsamı dışı)**

`DATA_INVENTORY.md`, `*VERBIS*`, `*verbis*` glob taramaları **hiçbir dosya döndürmedi** —
beklenen sonuç, bu bir kod dosyası değil. İlk turda önerilen üç satırlık envanter eki
(§(d)) hâlâ yalnızca bu compliance dokümanında yaşıyor; ayrı bir `DATA_INVENTORY.md` projede
mevcut değil. Bu, teknik bir implementasyon eksikliği değil — organizasyonel/idari bir iştir
(VERBİS kaydı veri sorumlusunun idari işlemidir). Not düşülür, DoD'yi etkilemez.

### 7. Ek doğrulama — audit metadata (§2.7) — **PASS**

`backend/src/modules/telehealth/telehealth.identity.routes.ts` içindeki iki `logAudit`
çağrısı incelendi: `telehealth.identity.accessed` (satır 87-94) metadata TAŞIMIYOR;
`telehealth.identity.updated` (satır 155-163) yalnızca
`metadata: { fields: ["citizenshipType", "countryCode", "identityNumber", "birthDate"] }`
taşıyor — **alan adları**, değerler değil. [DPI] §2.7 ve ilk tur madde (e)-3 ile **tam uyumlu**.

### İkinci Tur Özet Tablosu

| Madde | Durum |
|---|---|
| 1. Dil kuralı (§2.5) | **PASS** — ihlal yok |
| 2. `consentVersion` → `"v2"` | **PASS** |
| 3. KVKK onay metni tutarlılığı | **PASS** — birebir örtüşüyor; sayfa içeriği (CMS) ayrıca doğrulanmalı (bloklayıcı değil) |
| 4. E-posta/bildirimde kimlik verisi yasağı | **PASS** (kod) / **BACKLOG** (notification-agent şablon gözden geçirmesi henüz yapılmadı) |
| 5. 12 aylık süpürücü | **BACKLOG** — hâlâ yazılmadı, risk arttı, öncelik önerilir |
| 6. VERBİS/envanter dosyası | **BACKLOG** — organizasyonel, kod kapsamı dışı |
| 7. Audit metadata sızıntısı | **PASS** |

**Genel karar: ONAY — ENGELLEYİCİ bulgu YOK.** [DPI] §6 madde 8'in ikinci tur compliance
denetimi **geçti**. §2.5 dil kuralı ihlali **bulunmadı**. Açık backlog maddeleri (12 aylık
süpürücü, notification-agent şablon gözden geçirmesi, VERBİS envanter dosyası) bağlayıcı DoD
şartı değildir ama takip edilmelidir.

**Hukuki tavsiye notu (tekrar, ikinci tur için de geçerli):** Bu doğrulama genel KVKK/GDPR
prensiplerinin teknik gereksinime uygunluğunun kod taramasıdır, hukuki tavsiye değildir.
