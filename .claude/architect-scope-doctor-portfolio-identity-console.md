# architect-scope: Kurumsal hekim profili + hasta kimlik bilgisi + doktor konsolu

**Durum:** BAĞLAYICI karar dokümanı. Kısa adı **[DPI]**.
`docs/architecture/openapi.yaml` ile birlikte TEK doğruluk kaynağıdır; çelişkide **openapi.yaml
kazanır** (`.claude/CLAUDE.md` "Çakışma Çözümü").

**Üst dokümanlar (DEĞİŞTİRİLMEZ, GENİŞLETİLİR):**
- `.claude/architect-scope-telehealth-template.md` → **[TCT]**
- `.claude/architect-scope-demo-template-import.md` → **[DTI]**
- `.claude/architect-scope-ecommerce-pro-template.md` → **[EPT]**
- `.claude/compliance-notes-telehealth.md` (TUR 1-3) → **[CNT]**
- `.claude/security-review-telehealth.md`, `.claude/design-notes-telehealth.md`

[TCT] §3.5 (özel nitelikli veri reddi), §4.3 (çifte rezervasyon), §8 (minimum ifşa/IDOR),
§9.7.x (booking/ödeme/sağlık verisi/portal), TUR 3 (kayıt) kararlarının **hiçbiri geri
alınmamıştır.**

**Branş:** `feature/telehealth-doctor-portfolio-identity-console`
(`master`'dan açılır; branş açma/geçiş architect'in işi değildir).

---

## 0. Bir cümlede karar

Üç ayrı eksen tek turda ilerler: **(A)** `DoctorProfile` kurumsal özgeçmiş alanlarıyla
genişler ve doktora **dar bir self-servis yazma yüzeyi** açılır; **(B)** hasta kimlik bilgisi
**yeni bir `Patient` tablosu AÇILMADAN**, `AppointmentBooking` üzerinde ve mevcut
PII-şifreleme disipliniyle toplanır, akışta **ödemeden ÖNCE** durur; **(C)** `/doctor`
konsolu, istemcide hesaplanamayan metrikler için **tek bir yeni toplama ucundan** beslenir.

Kapsam dışı (backlog): NVİ/KPS gerçek kimlik doğrulama entegrasyonu, veli/vasi (18 yaş altı)
rıza akışı, doktor bazında komisyon oranı, kimlik numarasıyla admin araması.

---

## 1. KARAR A — `DoctorProfile` alanları

### 1.1 Alan tablosu (db-agent için bağlayıcı)

| Kullanıcının istediği | **Kararlaştırılan kolon** | Tip | Gerekçe |
|---|---|---|---|
| `subSpecialty` | `subSpecialty` | `String?` (≤120) | Aynen kabul. `title` ile AYNI gerekçeyle **serbest metin, enum DEĞİL**. |
| `experienceYears` | **`practiceStartYear`** | `Int?` (1950..bu yıl) | **REDDEDİLDİ → türetilir.** Saklanan "deneyim yılı" her 1 Ocak'ta sessizce yanlışa döner. `experienceYears` DTO'da `currentYear - practiceStartYear` ile üretilir (slotların `DoctorAvailability`'den türetilmesiyle AYNI disiplin; [TCT] §4.2). İstekte gönderilirse `422`. |
| `aboutText` | **`aboutHtml`** | `String?` (≤20000) | `bio` **DEĞİŞMEZ** ve kısa özet kalır. |
| `cvData` | **`cvEntries`** | `Json @default("[]")` | `cvData` REDDEDİLDİ: şemadaki hiçbir `Json` kolonu "Data" soneki taşımaz (`blocks`, `layers`, `options`, `variantOptions`, `translations`). |
| `publications` | `publications` | `Json @default("[]")` | Aynen kabul. |

### 1.2 `bio` vs `aboutHtml` — netleştirme (bağlayıcı)

`bio` **yeniden amaçlandırılamaz, taşınamaz, nullable yapılamaz.** Bugün üç şeyi besliyor:
doktor kartı/liste özeti, SEO meta description ve **demo şablonunun `assertDemoTemplateCaps`
içindeki `REQUIRED_DEMO_DOCTOR_BIO_SENTENCE` `startsWith` garantisi**
(`demo-templates/types.ts`, çalışma zamanında `throw` eden bir kontrol). Uzun biyografiyi
`bio`ya taşımak bu garantiyi ve `demo-templates-telehealth-clinic.test.ts`'i kırar.

- `bio` = **kısa özet**, `NOT NULL`, mevcut `maxLength: 5000` korunur (küçültmek mevcut satırları
  geçersiz kılar), UI rehberi ~280 karakter.
- `aboutHtml` = **uzun biyografi**, nullable, zengin metin. Yazma yolunda
  **`lib/html-sanitize.ts` ZORUNLU** ("tek temizleme yolu" ilkesi); temizlik sonrası boşsa `null`.
  Okuma yolunda **yeniden sanitize EDİLMEZ**.

### 1.3 JSON şekli (Zod ile yazma anında zorlanır)

`cvEntries[]` → `DoctorCvEntry`: `kind` (`EDUCATION|EXPERIENCE|CERTIFICATE|MEMBERSHIP|AWARD`),
`title`, `organization`, `location?`, `startYear`, `endYear?` (`null` = devam ediyor),
`description?` (≤500).
`publications[]` → `DoctorPublication`: `kind`
(`INTERNATIONAL_ARTICLE|NATIONAL_ARTICLE|PROCEEDING|BOOK_CHAPTER|OTHER`), `title`, `venue`,
`authors?`, `year`, `doi?`, `url?`.

**Bağlayıcı kurallar:**
1. `kind` bir **Prisma enum'u DEĞİLDİR** — JSON'un içinde enum yaşamaz. Zod literal union'dır,
   bu yüzden yeni değer eklemek `ALTER TYPE ... ADD VALUE` borcu doğurmaz.
2. **JSON alanlarının hiçbiri HTML KABUL ETMEZ** (düz metin). HTML gelirse `422` — sessizce
   temizlenmez. İkinci bir sanitizasyon yolu açılmaz.
3. `url`/`doi` yalnızca `https://`. `http:`/`javascript:`/`data:` → `422`.
4. Tavanlar: `cvEntries` ≤ 60, `publications` ≤ 200. Alan uzunlukları kontrattadır.
5. Dizi **SIRASI doktorundur**, sunucu yeniden sıralamaz; gruplama/sıralama sunum kararıdır.
6. `endYear < startYear` → `422`.

### 1.4 Doktorun yazma yüzeyi — `PUT /doctor/profile`

**Yazabilir:** `subSpecialty`, `bio`, `aboutHtml`, `practiceStartYear`, `languages`,
`cvEntries`, `publications`, `timeZone` (bkz. aşağıdaki 2026-09-15 notu).

**YAZAMAZ (bağlayıcı):** `title`, `fullName`, `slug`, `specialtyId`,
`sessionDurationMin`, `sessionPriceCents`, `currency`, `avatarMediaId`, `isVerified`,
`isActive`, `order`, `userId`. Gerekçeler: `title`/`isVerified` bir **yetkinlik iddiasıdır**
(kendi kendine "Prof. Dr." olunmaz — [CNT] §7.2/§7.4 disiplini); fiyat/süre satılan ürünün
tanımıdır ([EPT] §1.2); `slug` canlı URL'i ve sitemap'i kırar; `avatarMediaId` bir `Media`
satırı ister ve doktor bir panel kullanıcısı değildir ([TCT] §9.7.7).

`UpdateDoctorSelfProfileRequest`, `UpdateDoctorRequest`'ten **`allOf` ile TÜREMEZ** — admin
şemasına ileride eklenecek bir alan sessizce doktorun yazma yüzeyine düşmemelidir. Zod
`.strict()`: kapsam dışı alan → **`422`**, sessiz yok sayma YOK.

**2026-09-15 güncellemesi (backend-agent, "Doktorun kendi `timeZone`'unu güncelleyebilmesi"
görevi):** `timeZone` YAZAMAZ listesinden çıkarılıp Yazabilir listesine taşındı. Kritik hata
bildirimi: doktor konsolundaki saat bilgisi hastanın rezervasyon saatiyle karşılaştırılamıyordu
çünkü doktorun `DoctorProfile.timeZone`'u (varsayılan `"Europe/Istanbul"`) self-service
DEĞİŞTİRİLEMİYORDU. "`timeZone` tüm slot üretimini etkiler" gerekçesi hâlâ geçerlidir — bu
yüzden alan opsiyonel ve IANA-format doğrulamalıdır (`UpdateDoctorSelfProfileRequestSchema::
isValidIanaTimeZone`, `Intl.DateTimeFormat` dener/fırlatır deseni, YENİ kütüphane YOK); doktor
değeri değiştirdiğinde mevcut tekrarlayan müsaitlik kuralları/slotlar YENİDEN HESAPLANMAZ
(kurallar duvar-saati dakikası olarak saklanır, `lib/timezone.ts`), yalnızca YENİ hesaplamalar
güncel `timeZone` ile yapılır — bu davranış BİLİNÇLİ bir sınırdır, admin CRUD'undaki
`timeZone` alanı (`CreateDoctorRequestSchema`) bu tur ile DEĞİŞTİRİLMEDİ.

---

## 2. KARAR B — Hasta kimlik bilgisi

### 2.1 Nereye? — `AppointmentBooking`, `Appointment`'a KOPYALANMAZ

Kullanıcı isteği "Patient ve Appointment modeline ekle" diyor. Gerçek şemada `Patient` modeli
**yoktur ve açılmaz** ([TCT] §3.5'in "yeni tablo icat etme" reddi). Kimlik alanları
**YALNIZCA `AppointmentBooking`'e** yazılır.

`Appointment.patientName/patientEmail` snapshot ikilisinden **bilinçli sapma**: bir kimlik
numarasının ikinci kopyası ikinci bir sızıntı yüzeyidir ve `Appointment.bookingId` join'i
ihtiyacı zaten karşılar (veri minimizasyonu, KVKK md.4). Bu sapma qa-agent/code-quality-agent
tarafından "tutarsızlık" olarak raporlanmayacaktır — burada gerekçelendirilmiştir.

### 2.2 Kolonlar (db-agent için bağlayıcı)

`AppointmentBooking` üzerine, **hepsi nullable** (backfill YOKTUR, eski satırlar ve deprecated
`POST /appointments` akışı `null` kalır):

| Kolon | Tip | Not |
|---|---|---|
| `citizenshipType` | `CitizenshipType?` | Yeni Prisma enum. |
| `identityCountryCode` | `String?` | ISO 3166-1 alpha-2, BÜYÜK harf. `TR` tipinde `"TR"`. |
| `identityNumberCiphertext` | `String?` | **AES-256-GCM**, `lib/crypto.ts::encryptSecret`, `iv:authTag:ciphertext` hex — `AppointmentIntake.noteCiphertext` ile BİREBİR aynı disiplin. Index YOK, arama YOK, log YOK. |
| `identityNumberHash` | `String?` | **HMAC-SHA-256** (aşağıya bak). `@@index([identityNumberHash])`. |
| `identityNumberMasked` | `String?` | Denormalize maske (`123******89`). `ApiKey.keyPrefix`/`last4` emsali. |
| `patientBirthDate` | `DateTime? @db.Date` | **Takvim günü**, bir AN değil. |
| `identityCapturedAt` | `DateTime?` | **`identityVerifiedAt` DEĞİL** (§2.5). |

Yeni enum — **tüm değerler İLK SEFERDE**, sıra bağlayıcı (`AppointmentStatus` yorumundaki
gerekçe: `ALTER TYPE ... ADD VALUE` geri alınamaz):

```prisma
enum CitizenshipType {
  TR
  FOREIGN
  /// Türkiye'de ikamet eden, 99 ile başlayan Yabancı Kimlik Numarası taşıyan yabancı uyruklu.
  /// Bu turda HİÇBİR KOD bunu YAZMAZ (BookingPaymentStatus.REFUNDED ile AYNI emsal) —
  /// ileride migration borcu doğmasın diye şimdiden tanımlanır. UI yalnızca TR/FOREIGN sunar.
  FOREIGN_RESIDENT
}
```

### 2.3 Şifreleme + hash (security-agent için ENGELLEYİCİ)

- **Şifreleme:** `lib/crypto.ts::encryptSecret/decryptSecret`. Yeni bir şifreleme yardımcısı
  YAZILMAZ.
- **Hash için `lib/tokens.ts::hashToken` (çıplak SHA-256) YASAKTIR.** Gerekçe ölçülebilir:
  `hashToken` 256-bit rastgele token'lar için tasarlandı; T.C. Kimlik No uzayı sağlama
  basamakları nedeniyle **~10^9**'dur ve çıplak SHA-256 bir GPU'da saniyeler içinde tersine
  çevrilir. Şifreli kolonun yanında duran böyle bir hash, şifrelemeyi **anlamsızlaştırır**.
- **Karar:** `backend/src/lib/identity.ts` içinde `crypto.createHmac("sha256", subKey)`.
  `subKey`, mevcut `env.ENCRYPTION_KEY`'den **`crypto.hkdfSync("sha256", key, salt, info, 32)`**
  ile türetilir (`salt: "telehealth-identity-hash"`, `info: "identity-number-hmac-v1"`).
  **Yeni bir ortam değişkeni EKLENMEZ** — devops'a yeni bir sır yönetimi yükü bindirmeden
  alan ayrımı (domain separation) sağlanır.
  *Bilinen sonuç, dokümante edilir:* `ENCRYPTION_KEY` rotasyonu mevcut hash'leri geçersiz
  kılar (şifreli değer çözülüp yeniden hash'lenebildiği için **kurtarılabilirdir**).
  `info` sonundaki `v1` bu yüzden vardır.
- **Hash girdisi (kanonik):** `${citizenshipType}:${countryCode}:${normalizedNumber}` — pasaport
  numarası yalnızca veren ülke içinde tekildir, ülke kodu girdiye DAHİLDİR.

### 2.4 T.C. Kimlik No algoritmik doğrulaması (bağlayıcı, tek yardımcı)

`lib/identity.ts::isValidTurkishIdentityNumber(value)` — frontend'de **birebir aynı** saf
fonksiyonun kopyası bulunur (anlık form geri bildirimi için); **sunucu doğrulaması asıldır**.

1. Girdi tam **11 ASCII rakam** (`^\d{11}$`). Boşluk/tire önce temizlenir.
2. İlk hane `0` olamaz.
3. Haneler `d1..d11` iken:
   - `A = d1 + d3 + d5 + d7 + d9`
   - `B = d2 + d4 + d6 + d8`
   - **`d10 === ((A * 7) - B) mod 10`** (mod sonucu negatifse `+10`)
   - **`d11 === (d1 + d2 + … + d10) mod 10`**
4. **Ek kural:** ilk 10 hanesi aynı olan değerler (`/^(\d)\1{9}\d$/`, ör. `11111111110`)
   algoritmayı GEÇER ama gerçekte tahsis edilmez → **REDDEDİLİR**.
5. **Bu bir NVİ/KPS sorgusu DEĞİLDİR** (§2.5).

**Pasaport (`FOREIGN`):** boşluk/tire temizlenip BÜYÜK harfe çevrilir, `^[A-Z0-9]{6,20}$`.
Sağlama algoritması UYGULANMAZ (ülkeden ülkeye değişir). `countryCode` **ZORUNLU** ve
`"TR"` OLAMAZ.

**`birthDate`:** geçerli takvim günü, gelecekte olamaz, yaş ≤ 120. **Yaş < 18 →
`422 IDENTITY_MINOR_NOT_SUPPORTED`** (veli/vasi rızası akışı kapsam dışı; backlog
`feature/telehealth-guardian-consent`). Ayrıştırma DAİMA
`new Date("<YYYY-MM-DD>T00:00:00.000Z")`, serileştirme DAİMA `.toISOString().slice(0, 10)` —
yerel-saat kurucuları YASAK (sunucu TZ'si UTC olmayan bir ortamda doğum gününü bir gün oynatır).

**Maskeleme (`lib/identity.ts::maskIdentityNumber`, TEK yardımcı):** `TR` → ilk 3 + 6 yıldız +
son 2 (`123******89`). `FOREIGN` → ilk 2 + (uzunluk−4) yıldız + son 2. Her iki durumda da en
fazla **5 gerçek karakter** açığa çıkar; 6 karakterden kısa girdi tamamen maskelenir.

### 2.5 "Doğrulama" dil kuralı (ENGELLEYİCİ)

Yaptığımız iş **algoritmik format denetimidir**, kimlik doğrulama değildir. Bu yüzden:
- Kolon adı **`identityCapturedAt`**'tir; `identityVerifiedAt`/`isIdentityVerified` **YASAK**.
- Hiçbir DTO alanında, UI metninde, e-postada, CHANGELOG'da **"kimlik doğrulandı" /
  "identity verified" / "doğrulanmış hasta"** ifadesi geçmez. Kullanıcıya dönük adım adı
  **"Kimlik Bilgileri"**dir.
- Bu kural `DoctorProfile.isVerified` rozeti ([TCT] §7.2) ve "kayıtlar için *uçtan uca
  şifreli* demeyin" (TUR 3 madde 5) kurallarının aynısıdır.
- Gerçek doğrulama backlog: `feature/telehealth-kps-identity-verification`.

### 2.6 Akışa entegrasyon — booking gövdesinin İÇİNDE (KARAR)

**Seçilen:** `identity` nesnesi `POST /appointments/bookings` gövdesinde **ZORUNLU** alandır ve
booking satırıyla **AYNI transaction'da** yazılır.
Akış: slot seçimi → **kimlik adımı/modalı** → `POST /appointments/bookings` → Stripe Checkout.

**REDDEDİLEN alternatif:** "önce booking aç, sonra `PUT .../identity` ile kimlik ekle".
Gerekçe: kimliksiz-booking diye bir ara durum üretirdi; bunu kapatmak için
`checkout-session` önüne yeni bir kapı (`IDENTITY_REQUIRED`), yeni bir hata kodu ve
süpürücüde yeni bir durum gerekirdi. **Kimlik zorunludur; intake/belge ise opsiyoneldir ve
AYRI açık rıza ister** — bu yüzden onların ayrı uçta olması bu kararla çelişmez.

Geçersiz kimlik → `422`, **hiçbir slot tutulmaz** (`SLOT_TAKEN` ile aynı "ya hep ya hiç").

**Düzeltme penceresi:** `PUT /appointments/bookings/{bookingId}/identity`, yalnızca hasta
(`assertBookingPatientOnlyAccess`), yalnızca `paymentStatus = PENDING`; aksi hâlde
**`409 IDENTITY_LOCKED`** (ödenmiş randevunun kimliği SNAPSHOT'tır). Doktor/`ADMIN` bir
hastanın kimliğini **yazamaz** ([TCT] §9.7.10).

### 2.7 Okuma yetkisi ve denetim

- Liste/detay DTO'sundaki `AppointmentBooking.identity` nesnesi yalnızca **maskeli** değer,
  ülke kodu, **doğum YILI** ve `capturedAt` taşır; **tam doğum tarihi ve açık numara ASLA**.
- `identity`, **`assertBookingHealthDataAccess`** eşiğini geçemeyen aktörler için **`null`**:
  hasta ✓, **o** booking'in doktoru ✓, `ADMIN` ✓; **`MANAGER` ✗**, `EDITOR` ✗, başka doktor ✗.
  (MANAGER booking'i görebilir ama kimliği göremez — [TCT] §9.7.5 madde 7'nin aynısı.)
- Açık değer **tek uçta**: `GET /appointments/bookings/{bookingId}/identity` +
  `logAudit("telehealth.identity.accessed")` + `Cache-Control: no-store`.
- Yeni audit action'ları (mevcut tek `AuditLog`, **yeni tablo YOK**):
  `telehealth.identity.accessed`, `telehealth.identity.updated`,
  `telehealth.doctor.profile_updated`.
- **Audit `metadata`'sına kimlik numarası veya maskesi ASLA yazılmaz** — yalnızca `bookingId`,
  aktör, IP; `.updated` için yalnızca `fields: [...]`
  (`telehealth.recording.accessed` ile AYNI kural).

### 2.8 Saklama (compliance-agent onaylar)

Kimlik alanları **randevu PII'siyle AYNI pencereye** tabidir ([CNT] TUR 1: son `endsAt` + **12
ay**) — intake'in 90 günlük penceresine DEĞİL. Mevcut PII süpürücüsü `patientName`/
`patientEmail` ile birlikte `identityNumberCiphertext`, `identityNumberHash`,
`identityNumberMasked`, `patientBirthDate`'i de **null'lar**; `citizenshipType` ve
`identityCapturedAt` denetim izi bütünlüğü için kalabilir (compliance-agent nihai kararı verir).

---

## 3. KARAR C — Doktor konsolu

### 3.1 Yeni toplama ucu GEREKLİ mi? → **EVET, tek uç**

`GET /doctor/overview`. Gerekçe: `GET /doctor/bookings` imleç tabanlı sayfalıdır; "Toplam
Hasta" TÜM satırlarda `DISTINCT` ister, "Bugün" doktorun saat diliminde gün sınırı hesabı
ister. İkisi de istemcide doğru yapılamaz — `/admin/telehealth/analytics/overview`'un var olma
gerekçesiyle aynıdır. `doctorId` parametresi **YOKTUR** (IDOR). Kapılar `GET /doctor/me` ile
aynı (`NOT_A_DOCTOR` → sonra `TWO_FACTOR_REQUIRED`).

Metrik tanımları (bağlayıcı, kontratta ayrıntılı):
- **Bugünkü Seanslar** — doktorun `timeZone`'undaki takvim günü, `PENDING_PAYMENT` hariç.
- **Tamamlanan Konsültasyonlar** — `status=COMPLETED`, `/doctor/earnings`'in
  `completedSessionCount`'u İLE AYNI tanım (iki uç aynı sayıyı iki tanımla üretmez).
- **Toplam Hasta** — `PAID` booking'lerde `DISTINCT`; anahtar sırası `identityNumberHash` →
  `user:<patientUserId>` → `email:<lower(patientEmail)>`. **Kimlik hash kolonunun ilk gerçek
  tüketicisi budur** (kolonun var olma gerekçesi).
- **Bekleyen Tıbbi Belgeler** — `deletedAt: null` + `PAID` booking + **henüz tamamlanmamış**
  (`SCHEDULED`/`IN_PROGRESS`) randevu. **`AppointmentDocument`'a `reviewedAt` gibi bir inceleme
  durumu EKLENMEZ**: "okundu/onaylandı" bayrağı, uygulamadığımız bir tıbbi inceleme iş akışını
  ve hukuki sorumluluğunu ima eder. UI bu kartın ipucunda tanımı açıkça yazar.

`generatedAt` (sunucu saati) **zorunludur**: "kalan süre" rozeti istemci saatine göre değil,
buna göre kalibre edilir.

### 3.2 Kart listesi filtresi

`GET /doctor/bookings`'e `scope` (`all|today|upcoming|completed`) eklenir; `from`/`to` ile
birlikte gönderilirse **`422`**. Gün sınırları sunucuda, doktorun `timeZone`'unda hesaplanır.

### 3.3 Konsolun geri kalanı için **yeni backend GEREKMEZ**

- Maskeli kimlik → `AppointmentBooking.identity.maskedNumber` (yeni).
- Kalan süre rozeti → mevcut `joinableFrom`/`joinableUntil` + `generatedAt`.
- Belge modalı → mevcut `GET .../documents` + `GET /appointments/documents/{id}/content`.
- Tiptap konsültasyon notu → mevcut `POST /appointments/{id}/complete` (yazma) +
  `GET .../consultation-note` (okuma).
- "Görüşmeye Katıl" → mevcut `POST /appointments/{id}/meeting-token`.

---

## 4. Kontrat borcu (bu turda kapatıldı)

`openapi.yaml` ile kodu karşılaştırdım; **yaşayan ama belgelenmemiş** iki uç bulundu ve
eklendi: `GET /doctor/earnings` ve `GET /appointments/bookings/{bookingId}/consultation-note`.
Ayrıca `AppointmentBooking` şemasına kodda var olan `hasConsultationNote` eklendi. Telehealth
modülünün başka bir uç sapması **yoktur** (tüm route dosyaları tarandı).

---

## 5. Migration planı (db-agent)

Sırayla, **iki ayrı migration**, elle SQL/backfill YOK:

1. `add_doctor_profile_credentials`
   → `sub_specialty`, `about_html`, `practice_start_year`, `cv_entries`, `publications`.
2. `add_booking_patient_identity`
   → `CREATE TYPE "CitizenshipType"` + `AppointmentBooking` kimlik kolonları +
   `@@index([identityNumberHash])`.

`CREATE TYPE` yeni bir enum olduğu için `ALTER TYPE ... ADD VALUE` izolasyon kuralı
GEÇERLİ DEĞİLDİR — 2. migration tek parçadır. **Hiçbir kolon NOT NULL değildir**, dolayısıyla
backfill gerekmez ve migration mevcut veriyle temiz uygulanır.

---

## 6. Ajan sırası ve her ajana talimat

> **0. compliance-agent — ÖN ONAY, ENGELLEYİCİ, db-agent'tan ÖNCE.**
> Çıktı: `.claude/compliance-notes-doctor-identity.md`. Kararlar: (a) kimlik verisinin KVKK
> hukuki sebebi ve aydınlatma metninin **yeni `consentVersion` değeri** (ayrı rıza kolonu
> AÇILMAZ, §2.6); (b) 18 yaş sınırının teyidi ve gerekçesi (§2.4); (c) saklama penceresi 12 ay
> teyidi ve süpürücüde hangi kolonların null'lanacağı (§2.8); (d) VERBİS/işleme envanterine
> "kimlik verisi" satırının eklenmesi; (e) **kimlik numarası hiçbir e-postada/bildirimde yer
> almaz** maddesi. §2.5 dil kuralını kendi metinlerinde de uygular.

> **0b. security-agent — TASARIM ONAYI (§2.3), db-agent ile PARALEL, ENGELLEYİCİ.**
> Çıktı: `.claude/security-review-doctor-identity.md`. Denetlenecek: HKDF+HMAC kararı
> (çıplak SHA-256 yasağı), anahtar rotasyon sonucu, maskeleme oranı (5 karakter tavanı),
> `identity` nesnesinin MANAGER'a kapatılması, `PUT .../identity`'nin hasta-only + PENDING
> kapısı, hata gövdelerinin numarayı geri yansıtmaması, hız sınırının kimlik deneme yüzeyine
> etkisi. **İmplementasyon SONRASI ikinci tur denetim ZORUNLU.**

1. **db-agent** — §1.1 + §2.2 kolonları, §5 migration'ları. `experienceYears` **kolon olarak
   EKLENMEZ**. `patientBirthDate` **`@db.Date`**'tir. Her yeni kolona, mevcut yorum diliyle
   (`///` + karar referansı `[DPI]`) gerekçe yorumu yazılır. **İş mantığı/şifreleme kodu
   YAZILMAZ** — yalnızca şema.

2. **backend-agent** — `lib/identity.ts` (normalize/validate/hash/mask — TEK yardımcı),
   `PUT /doctor/profile`, `GET /doctor/overview`, `scope` filtresi,
   `GET`/`PUT .../identity`, `CreateBookingRequest.identity`, mapper'larda `identity` nesnesinin
   **eşik bazlı** doldurulması, yeni audit action'ları. **Kontrat BİREBİR uygulanır.**
   Yasaklar: yeni şifreleme yardımcısı yazmak, `hashToken`'ı kimlik için kullanmak, `Patient`
   tablosu önermek, Stripe/webhook koduna dokunmak (integration-agent alanı), `POST
   /identity/validate` gibi bir kimlik-sorgu ucu açmak. `aboutHtml` yazma yolunda
   `lib/html-sanitize.ts`'ten geçer. Birim testler: TCKN algoritması (geçerli/geçersiz/repdigit
   vakaları), maskeleme, HMAC determinizmi, 18 yaş sınırı, `@db.Date` gidiş-dönüşü.

3. **ui-designer** (2 ile PARALEL) — çıktı `.claude/design-notes-doctor-portfolio-console.md`.
   Kurumsal hekim sayfası (koyu lacivert başlık, sekmeler, zaman çizelgesi, sticky randevu
   kutusu), konsol metrik kartları ve hasta kartı anatomisi, "Kimlik bilgisi alınmadı" /
   "Kimlik bilgisi alındı" rozetlerinin görsel dili. **Mevcut tasarım tokenleri kullanılır,
   yeni renk icat edilmez**; koyu lacivert için WCAG AA kontrastı doğrulanır
   (`design-notes-telehealth.md` §2.3'teki `#0D9488` denetiminin aynısı). **Kod yazmaz.**

4. **frontend-agent** — `/doctors/[slug]` sekmeli kurumsal sayfa, `/doctor` konsolu,
   `/doctor/profile` düzenleme formu (Tiptap → `aboutHtml`; `cvEntries`/`publications` için
   tekrarlayıcı alanlar), booking akışına **kimlik adımı modalı**. TCKN algoritması sunucu
   yardımcısının **birebir kopyasıdır** (ikinci bir algoritma yazılmaz); istemci doğrulaması
   yalnızca UX'tir. Kimlik numarası **`localStorage`/`sessionStorage`/URL/analitik olayına
   ASLA yazılmaz**, input `autocomplete="off"` + `inputMode="numeric"`. **Meta tag/structured
   data'ya DOKUNMAZ** (seo-agent alanı). `frontend/AGENTS.md` uyarısı geçerlidir: Next.js
   API'leri için önce `node_modules/next/dist/docs/` okunur.

5. **seo-agent** — `/doctors/[slug]` içeriği zenginleşti: `Physician`/`MedicalBusiness`
   structured data'nın gözden geçirilmesi (**`aggregateRating` YASAK**, [TCT] §3.3),
   `aboutHtml`'den meta description ÜRETİLMEZ (`bio` kaynak kalır), sekmelerin tek URL'de
   kalması (her sekme için ayrı indekslenebilir URL açılmaz). `/doctor/**` ve `/patient/**`
   `noindex` kuralı aynen sürer.

6. **notification-agent** — **kimlik numarası, maskesi ve doğum tarihi hiçbir e-posta/bildirim
   şablonunda yer almaz**; yeni bir "kimlik alındı" bildirimi OLUŞTURULMAZ. Mevcut rezervasyon
   onay şablonu, `consentVersion` yükseldiği için compliance-agent'ın metniyle gözden geçirilir.

7. **security-agent (2. tur)** — implementasyon denetimi (§0b listesi + gerçek kod).
   **ENGELLEYİCİ.**

8. **compliance-agent (2. tur)** — süpürücünün kimlik kolonlarını gerçekten temizlediğinin ve
   §2.5 dil kuralının UI/e-posta/CHANGELOG'da ihlal edilmediğinin doğrulanması. **ENGELLEYİCİ.**

9. **code-quality-agent** — lint/format, **yeni npm bağımlılığı EKLENMEMELİ** (HKDF/HMAC Node
   `crypto`'dadır; TCKN algoritması için kütüphane çekmek yasak), `Appointment`'a kimlik
   kopyalanmadığının ve `hashToken`'ın kimlik için kullanılmadığının grep ile doğrulanması,
   `identityNumber`in log çağrılarına sızmadığının taranması.

10. **qa-agent** — E2E: (a) kimlik adımı olmadan ödemeye geçilemez; (b) geçersiz TCKN ve 18 yaş
    altı reddedilir ve **slot tutulmaz**; (c) `MANAGER` booking'i görür ama `identity` `null`
    döner, `GET .../identity` `404`; (d) başka doktor `404`; (e) ödenmiş booking'de
    `PUT .../identity` `409`; (f) doktor `PUT /doctor/profile` ile fiyat/unvan değiştiremez
    (`422`); (g) konsol metrikleri doktorun saat diliminde doğru; (h) kurumsal sayfa sekmeleri.
    **Bayatlık uyarısı:** public doktor sayfası ISR'dir — profil güncellemesi sonrası
    doğrulama `toPass` + `reload` ile **poll edilir**, bu bir bug değildir.

11. **documentation-agent** — `ARCHITECTURE.md` TeleHealth bölümü, README (doktor profili
    düzenleme + kimlik adımı), CHANGELOG. **"Kimlik doğrulama" ifadesi kullanılmaz** (§2.5);
    `ENCRYPTION_KEY` rotasyonunun kimlik hash'lerini geçersiz kıldığı ve yeniden
    hash'lenebildiği notu yazılır.

12. **devops-agent** — **yeni ortam değişkeni YOKTUR** (HKDF kararı sayesinde). Migration'ların
    CI'da temiz koştuğu doğrulanır. **Kod değişikliğinden sonra
    `docker compose up --build -d`** (proje hafızası).

13. **observability-agent** — yeni audit action'larının loglandığı, `identityNumber`in hiçbir
    log/metrik/hata izleme payload'ına düşmediği doğrulanır; `GET .../identity` için erişim
    sayacı önerilebilir (**değerin kendisi asla etiket/label olmaz**).

14. **performance-agent (isteğe bağlı, en son)** — yalnızca `GET /doctor/overview` ölçülen bir
    yavaşlık gösterirse. Tahmine dayalı indeks/cache eklenmez.

**release-coordinator**, yukarıdaki sırayı zaman çizelgesine ve PR'lara bölmekle görevlidir;
bağımlılık kuralı: `0/0b → 1 → 2 (∥ 3) → 4 → 5/6 → 7/8 → 9/10 → 11/12/13`.

---

## 7. Commit planı (Conventional Commits, mantıksal commit'ler)

```
1. feat(db): hekim ozgecmis alanlari ve booking kimlik bilgisi semasi
2. feat(telehealth): kimlik dogrulama yardimcisi, booking kimlik akisi ve dar kimlik okuma ucu
3. feat(telehealth): doktor self-servis profil ucu ve konsol metrik toplama ucu
4. feat(telehealth): kurumsal hekim profili sayfasi, kimlik adimi ve yenilenen doktor konsolu
5. feat(seo): hekim profili structured data gozden gecirmesi
6. test(e2e): kimlik adimi, yetki matrisi ve konsol metrikleri
7. docs(openapi,architecture): [DPI] turu kontrati, ARCHITECTURE ve CHANGELOG
```

Branş `master`'a **squash-merge** edilir.

---

## 8. Definition of Done

- [ ] compliance-agent ÖN onayı + yeni `consentVersion` tanımlı (**ENGELLEYİCİ**)
- [ ] security-agent §2.3 tasarım onayı + implementasyon sonrası 2. tur onayı (**ENGELLEYİCİ**)
- [ ] İki migration temiz uygulandı; elle SQL/backfill YOK; hiçbir kimlik kolonu NOT NULL değil
- [ ] `experienceYears` **kolon DEĞİL**, DTO'da türetiliyor; `practiceStartYear` üst sınırı
      sunucuda zorlanıyor
- [ ] `bio` anlamı ve `REQUIRED_DEMO_DOCTOR_BIO_SENTENCE` garantisi DEĞİŞMEDİ; demo şablon
      testleri yeşil
- [ ] `aboutHtml` `lib/html-sanitize.ts`'ten geçiyor; `cvEntries`/`publications` içinde HTML
      reddediliyor (`422`)
- [ ] Kimlik: AES-256-GCM şifreli + HKDF/HMAC hash + denormalize maske; **`hashToken` kimlik
      için hiçbir yerde kullanılmıyor** (grep ile kanıt)
- [ ] `Appointment`'a kimlik kolonu KOPYALANMADI (grep ile kanıt)
- [ ] TCKN algoritması + repdigit reddi + 18 yaş sınırı birim testleriyle kanıtlı
- [ ] Yetki matrisi: hasta ✓ / o doktor ✓ / ADMIN ✓ / **MANAGER `identity: null` + `404`** /
      EDITOR ✗ / başka doktor `404` (**ENGELLEYİCİ**)
- [ ] `GET .../identity` ve `PUT .../identity` audit'e düşüyor; metadata'da numara/maske YOK
- [ ] Kimlik numarası log/e-posta/hata gövdesi/analitik/localStorage'da YOK (tarama kanıtı)
- [ ] `PUT /doctor/profile` kapsam dışı alanı `422` ile reddediyor; ISR revalidate tetikleniyor
- [ ] `GET /doctor/overview` doktorun saat diliminde doğru; `doctorId` parametresi YOK
- [ ] `AppointmentDocument`'a inceleme durumu kolonu EKLENMEDİ
- [ ] Uçlar `openapi.yaml` ile **BİREBİR**; kontrat borcu (§4) kapalı
- [ ] Yeni npm bağımlılığı ve yeni ortam değişkeni **EKLENMEDİ**
- [ ] "Kimlik doğrulandı" ifadesi hiçbir kullanıcı yüzeyinde YOK (§2.5)
- [ ] E2E yeşil, CI yeşil, `docker compose up --build -d` ile doğrulandı
