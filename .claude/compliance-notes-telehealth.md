# Uyumluluk Değerlendirmesi — Tele-Sağlık Modülü + `telehealth-clinic` Demo Şablonu (KVKK/GDPR)

> Referans: `.claude/architect-scope-telehealth-template.md` (bundan sonra **[TCT]**) §7 (KARAR D
> — PII/KVKK, **ENGELLEYİCİ**), §3.5/§3.6, §6.6, §7.4, §12, §14. Bu doküman **hukuki tavsiye
> DEĞİLDİR** — genel KVKK/GDPR prensiplerinin teknik gereksinime çevrilmiş hâlidir. Nihai
> saklama süresi/anonimleştirme/açık rıza/aydınlatma metni içeriği kararı için **gerçek bir hukuk
> danışmanına** başvurulmalıdır; bu proje bir üretim ortamı değil, şablon/demo kapsamındadır.

**Kod incelendi, doğrulandı (spekülasyon değil):**
`backend/prisma/schema.prisma` (`Specialty`/`DoctorProfile`/`DoctorAvailability`/`Appointment`
modelleri, satır ~1961-2101), `backend/src/modules/demo-templates/templates/telehealth-clinic.ts`,
`backend/src/modules/demo-templates/types.ts` (`DemoTemplateDefinition`,
`assertDemoTemplateCaps`), `backend/src/modules/demo-templates/importer.ts` (Faz 2 §2.7f/§2.7g +
uyarı metinleri), `backend/tests/unit/demo-templates-telehealth-clinic.test.ts`,
`backend/src/modules/telehealth/telehealth.routes.ts`, `telehealth.admin.routes.ts`,
`telehealth.schemas.ts`, `lib/booking.ts`, `backend/src/mappers/index.ts` (`toAppointmentDto`),
`frontend/src/app/[lang]/(site)/doctors/[slug]/page.tsx`,
`frontend/src/components/site/telehealth/{availability-calendar,doctor-card,emergency-notice}.tsx`,
`frontend/src/app/[lang]/(site)/doctors/layout.tsx`, `.../consultation/layout.tsx`.

## Karar: **ONAY** — `POST /appointments` birleştirilebilir

Aşağıdaki 13 maddenin tamamı gerçek koda/veriye karşı doğrulandı. **Bloklayıcı hiçbir bulgu
yoktur.** İki küçük, yanıltıcı müşteri-yüzeyi metni tarafımca düzeltildi (aşağıda §"Kendi
düzelttiklerim"). Yapısal/mimari hiçbir sorun bulunmadı — orkestratöre eskalasyon **yok**.

---

## §7.2 — Demo doktor verisi (madde madde)

| # | Madde | Sonuç | Kanıt |
|---|---|---|---|
| 1 | `isVerified` şablonda DAİMA `false` | **GEÇTİ** | `types.ts:344` tip düzeyinde `isVerified: false` (literal, `boolean` DEĞİL); `telehealth-clinic.ts` içindeki 4 doktorun hepsinde `isVerified: false`; `importer.ts:672-675` yazarken de sabit `false`; `assertDemoTemplateCaps` çalışma zamanında bio kontrolü yapıyor ama `isVerified` zaten TİP SİSTEMİYLE sabit — bozulması derlenmez. Birim test: `demo-templates-telehealth-clinic.test.ts:121-125` ve gerçek-import testi `:264-267` (`doctor.isVerified === false` DB'den okunarak doğrulanmış). |
| 2 | Doktor adları gerçek/tanınmış hekimle çakışmıyor | **GEÇTİ** | 4 ad taranmıştır: **Elif Aydemir** (kardiyoloji), **James Whitfield** (dermatoloji), **Laura Bennett** (nöroloji), **Felix Braun** (psikiyatri). Tanınmış/gerçek bir hekim, kamu figürü veya markayla eşleşme bulunmadı — jenerik, "sıradan" ad-soyad kombinasyonlarıdır (bkz. [DTI] §9.4 "Mimarist → Kütle Yapı" emsaliyle aynı disiplin). |
| 3 | Her `bio`'nun İLK CÜMLESİ zorunlu demo uyarısı | **GEÇTİ** | `REQUIRED_DEMO_DOCTOR_BIO_SENTENCE = "Bu, örnek (demo) bir doktor profilidir; gerçek bir hekimi temsil etmez."` (`types.ts:56`); 4 doktorun `bio`'su da bu cümleyle BAŞLIYOR (`telehealth-clinic.ts:493,509,525,541`); `assertDemoTemplateCaps` (`types.ts:629-633`) bunu ÇALIŞMA ZAMANINDA zorluyor (`.startsWith` kontrolü, uymayan tanım `throw` ediyor) — bu tek bir statik disiplin değil, modül yükleme anında test edilen bir GARANTİ. |
| 4 | Import sonrası `warnings[]` demo uyarısı | **GEÇTİ** | `importer.ts:979-983`: `template.telehealth` doluysa `"${doctors.length} örnek doktor profili ve ${specialties.length} uzmanlık oluşturuldu; yayına almadan önce gerçek bilgilerinizle değiştirin veya silin."` — metin [TCT] §7.2 madde 4'teki ("4 örnek doktor profili ve 6 uzmanlık oluşturuldu...") ile BİREBİR aynı kalıp (dinamik sayılarla); gerçek-import testinde (`:245`) doğrulanmış. |
| 5 | Uzmanlık adları jenerik | **GEÇTİ** | Kardiyoloji, Dermatoloji, Nöroloji, Psikiyatri, Aile Hekimliği, Çocuk Sağlığı — hiçbiri marka/ticari isim değil, standart tıbbi terimlerdir. |
| 6 | İletişim yer tutucuları + doktor e-posta/telefon YOK | **GEÇTİ** | `schema.prisma`'da `DoctorProfile` modelinde e-posta/telefon alanı **hiç yok** (satır 1981-2030 tamamı okundu — yalnızca `title/fullName/slug/bio/languages/timeZone/sessionDurationMin/sessionPriceCents/currency/avatarMediaId/isVerified` var). Şablon da böyle bir alan **üretmiyor**. `info@example.com`/`+90 212 000 00 00` yer tutucuları yalnızca `modern-architecture` şablonunun kendi metin bloğunda kullanılıyor (bu şablona özgü, [DTI] §9.5 kapsamı orada tüketiliyor); `telehealth-clinic` hiçbir sahte iletişim bilgisi üretmediği için bu maddeye aykırılık yok (`contact-form` singleton kullanılıyor, kendi mevcut alıcı adresi şablon-bağımsız). |

## §3.6 — Yapısal garanti (madde madde)

| # | Madde | Sonuç | Kanıt |
|---|---|---|---|
| 7 | `DemoTemplateDefinition`de `appointments` alanı YOK | **GEÇTİ** | `types.ts:494-503` — `telehealth: { specialties, doctors } \| null`; `appointments` anahtarı tipte **tanımlı değil**. Birim test `demo-templates-telehealth-clinic.test.ts:170-175` bunu çalışma zamanında da doğruluyor (`(TEMPLATE as any).appointments === undefined`, serileştirilmiş JSON'da `"patientName"`/`"patientEmail"` STRING'i bile GEÇMİYOR). |
| 8 | `importer.ts` içinde `appointment`/`user` create/upsert çağrısı YOK | **GEÇTİ** | Grep sonucu (bu denetimde tekrar koşuldu): `appointment\.(create\|createMany\|upsert)\|prisma\.user\.(create\|upsert)\|tx\.user\.(create\|upsert)` deseni `backend/src/modules/demo-templates/` altında **0 eşleşme** verdi. Ayrıca kod tabanında zaten kendi statik denetim testi var: `demo-templates-telehealth-clinic.test.ts:274-280` (`source` dosyasını okuyup regex ile `tx.appointment.*`/`tx.user.*` aramıyor olduğunu doğruluyor — bu test CI'da her değişiklikte tekrar koşacak, ileride birinin yanlışlıkla bu satırı eklemesi test kırar). |
| 9 | Gerçek import sonrası `appointments` BOŞ, hiçbir `User` YOK | **GEÇTİ** | `demo-templates-telehealth-clinic.test.ts:224-272` gerçek `importDemoTemplate()` çağrısı yapıyor, ardından `app.prisma.appointment.count() === 0` VE `app.prisma.user.count() === 1` (yalnızca test kurulumundaki ADMIN — şablon öncesi zaten vardı) doğrulanıyor; ayrıca her `doctorProfile.userId === null` kontrol ediliyor. |

## §7.4 — Tıbbi içerik ve iddia denetimi (madde madde)

| # | Madde | Sonuç | Kanıt |
|---|---|---|---|
| 10 | Tanı/tedavi vaadi içeren ifade YOK | **GEÇTİ** | `telehealth-clinic.ts` TAMAMI (hero, trust-band, "nasıl çalışır", CTA, doktor bio'ları) satır satır okundu; `iyileş/tedavi/teşhis/reçete/SGK/sigorta/laboratuvar` desenleriyle case-insensitive grep **0 eşleşme**. Kullanılan diller hep hizmet tanımı düzeyinde: "görüntülü görüşün", "danışmanlık hizmeti sunar", "uzmanla görüntülü görüşün". |
| 11 | Acil durum uyarısı ana sayfada VE doktor detayında render ediliyor | **GEÇTİ** | Ana sayfa: `emergencyWarningSection` bloğu `page.blocks` içinde hero'nun HEMEN ALTINDA (`telehealth-clinic.ts:141-155,714`) — metin BİREBİR "Bu platform acil tıbbi durumlar için KULLANILAMAZ. Acil durumda 112'yi arayın." Doktor detay sayfası: `EmergencyNoticeCard` randevu/slot takviminin HEMEN ÜSTÜNDE render ediliyor (`doctors/[slug]/page.tsx:114-118`) ve AYRICA `doctors/layout.tsx` + `consultation/layout.tsx`'te `EmergencyNoticeStrip` HER sayfanın üstünde (sitewide, kapatılamaz şerit) — iki bileşen de AYNI `EMERGENCY_NOTICE_TEXT` sabitini kullanıyor (`emergency-notice.tsx:10`), metin tam eşleşiyor. Test: `demo-templates-telehealth-clinic.test.ts:154-161` ana sayfa + 4 yasal sayfanın hepsinde cümlenin geçtiğini doğruluyor. |
| 12 | Sayaç değerleri doğrulanabilir, uydurma değil | **GEÇTİ** | `buildCounterSection` girdileri: `doctorCount=4`, `specialtyCount=6`, `languageCount=DISTINCT_LANGUAGE_COUNT` (doktorların dillerinden `Set` ile TÜRETİLMİŞ, elle yazılmamış), `sessionDurationMin=30` (doğrudan `DoctorProfile.sessionDurationMin`). "10.000+ hasta" tipi hiçbir doğrulanamayan iddia yok; mimari dokümanın önerdiği "ortalama yanıt süresi" (kaynaksız olurdu) BİLİNÇLİ OLARAK kullanılmamış — bu, [TCT] §6.5'in kendi gerekçesiyle tutarlı, iyi bir tasarım kararı. |
| 13 | Reçete/tıbbi kayıt/sigorta-SGK ima YOK | **GEÇTİ** | Aynı grep taraması (madde 10) bunu da kapsıyor — 0 eşleşme. Randevu formu yalnızca ad+e-posta+onay kutusu topluyor (`availability-calendar.tsx:39-43`), semptom/şikâyet/sağlık geçmişi alanı YOK (§3.5 `patientNote` reddi zaten şemada da yok — doğrulandı). |

---

## İşleme envanteri (VERBİS/işleme faaliyeti bakışıyla)

| Veri alanı | Konum | Hukuki sebep (KVKK) | Amaç | Saklama süresi (önerilen) |
|---|---|---|---|---|
| `Appointment.patientName` | `appointments` tablosu | md.5/2-c (sözleşmenin kurulması/ifası — randevu hizmeti sözleşmesi) | Randevunun kiminle yapıldığını sabitlemek (PII snapshot, `OrderItem.productTitle` disipliniyle AYNI) | Randevu bitiminden (`endsAt`) **12 ay** sonra `"Silinmiş Kayıt"` ile anonimleştirilir (satır SİLİNMEZ) |
| `Appointment.patientEmail` | `appointments` tablosu | md.5/2-c + md.5/2-f (katılım bağlantısının iletilmesi, meşru menfaat) | Katılım bağlantısının/randevu bilgisinin sahibine ulaştırılması | Aynı 12 ay sonunda `null`'lanır |
| `Appointment.patientUserId` | `appointments` tablosu (opsiyonel FK) | md.5/2-c | Oturum sahibiyse randevuyu kendi hesabından görebilmesi | `User` silinirse zaten `onDelete: SetNull` ile otomatik `null` olur — AYRI bir retention gerekmez |
| `Appointment.accessTokenHash` | `appointments` tablosu | md.5/2-f (güvenlik — misafir erişim kontrolü) | Misafir hastanın kimlik doğrulamasız katılımı | Ham token HİÇ saklanmaz (yalnızca SHA-256 hash); hash da `patientName`/`patientEmail` ile AYNI 12 aylık döngüde silinebilir (fonksiyonel değeri randevu bitince zaten sıfırdır) |
| `DoctorProfile.*` (fullName, bio, dil, saat dilimi, fiyat) | `doctor_profiles` tablosu | md.5/2-e (kamuya açıklama — halka açık hizmet vitrini) VEYA md.5/2-f (meşru menfaat, ADMIN'in kendi girdiği ticari profil verisi) | Kamuya açık doktor profili vitrini | `Appointment`'tan FARKLI: bu **hizmet sağlayıcı** verisidir, hasta verisi değil; ADMIN silene kadar saklanır (v1'de otomatik silme YOK, doğru — bu bir müşteri PII'si değil) |
| `Appointment` üzerinden **çıkarımsal sağlık verisi** ("X doktoruna randevu" → uzmanlık üzerinden zımni sağlık bilgisi) | `appointments.doctorId` → `doctor_profiles.specialtyId` join'i | md.6 (özel nitelikli veri) — **açık rıza ZORUNLU** | — | Doğrudan bir kolon değil, bir İLİŞKİDİR; anonimleştirme (`patientName`/`patientEmail` temizliği) sonrası bu çıkarım artık **kimliksizleştirilmiş** olur — bu yüzden 12 aylık pencere hem sağlık verisi özel nitelikli statüsünün risk süresini sınırlar hem de istatistik bütünlüğünü (satır silinmez) korur |

**Not — "hasta e-postası" alanı zaten VERİ MİNİMİZASYONU ilkesine göre en dar kapsamda**:
`patientNote`/semptom alanı YOK (§3.5, şemada doğrulandı), doktor e-posta/telefonu YOK (§7.2
madde 6), `rating`/`reviewCount` YOK (§3.3) — bu üç ret kararı da kendi başına birer veri
minimizasyonu uygulamasıdır ve compliance-agent bunları **aynen destekler**, gevşetilmesi
ÖNERİLMEZ.

---

## Randevu formu açık rıza metni + KVKK aydınlatma metni — İSKELET (yer tutucu, hukuki metin DEĞİL)

**Bağlayıcı uyarı ([EPT] §4.3 ile aynı ilke):** Aşağıdaki metinler **taslak/iskelettir**, hukuki
geçerliliği YOKTUR. Canlıya almadan önce gerçek bir hukuk danışmanıyla birlikte doldurulmalı ve
gözden geçirilmelidir. Bu ilke şablonun `extraPages` (KVKK Aydınlatma Metni, Açık Rıza Metni,
Kullanım Koşulları, Mesafeli Hizmet Sözleşmesi) sayfalarında `LEGAL_PLACEHOLDER_NOTICE` sabiti ile
zaten HER sayfada müşteri-yüzeyinde uygulanıyor (`telehealth-clinic.ts:444-445`).

**Randevu formu onay kutusu metni (uygulanmış, `availability-calendar.tsx:337-346`):**
> "[KVKK Aydınlatma Metni]'ni okudum, kişisel verilerimin bu randevu kapsamında işlenmesine açık
> rızamı veriyorum."

Bu metin, formun **zorunlu** (backend: `consent: z.literal(true)`, frontend: varsayılan
işaretsiz) tek onay kutusu olarak finalize edilmiştir. Not: bu kısa checkbox metni, tam bir
"Açık Rıza Metni" DEĞİLDİR — ayrıntılı, özel nitelikli veri kategorilerini sayan, geri alma hakkını
açıklayan gerçek metin `acik-riza-metni` sayfasındadır (checkbox ona LİNK verir); bu, kısa/pratik
onay kutusu + ayrıntılı arka plan metni tasarımı yaygın ve KVKK md.10 açısından savunulabilir bir
desendir (aydınlatma AYRINTILI sayfada, rıza AÇIK ve tek tıkla).

**KVKK Aydınlatma Metni sayfası — ZORUNLU bölüm iskeleti** (mevcut, `telehealth-clinic.ts:743`):
1. Veri Sorumlusu — [şirket/işletme unvanı, adres, iletişim — DOLDURULACAK]
2. İşlenen Kişisel Veriler (Sağlık Verisi Dahil) — ad-soyad, e-posta, randevu tarihi/saati,
   seçilen uzmanlık (dolaylı sağlık verisi kategorisi)
3. İşleme Amaçları — randevu hizmetinin sunulması, katılım bağlantısının iletilmesi
4. İşlemenin Hukuki Sebebi — md.5/2-c (sözleşme) + md.6 (özel nitelikli veri için AÇIK RIZA)
5. Veri Sahibinin Hakları (md.11) — erişim, düzeltme, silme, itiraz — [başvuru kanalı DOLDURULACAK]

**Açık Rıza Metni sayfası — ZORUNLU bölüm iskeleti** (mevcut, `telehealth-clinic.ts:751-757`):
1. Rızanın Konusu
2. İşlenecek Özel Nitelikli Veri Kategorileri — [randevu, seçilen uzmanlık üzerinden dolaylı
   sağlık verisi çıkarımı — DOLDURULACAK, tam liste hukuk danışmanıyla netleştirilmeli]
3. Rızanın Geri Alınması — [prosedür DOLDURULACAK]
4. Görüntülü Görüşmenin Kaydedilmediğine İlişkin Beyan — bkz. aşağıdaki "Kayıt yasağı" bölümü

---

## Saklama/anonimleştirme politikası (bağlayıcı öneri — nihai karar hukuk danışmanınındır)

**Politika:** `Appointment.endsAt`'ten **12 ay** sonra:
- `patientName` → sabit string `"Silinmiş Kayıt"`
- `patientEmail` → `null`
- Satır **SİLİNMEZ** (istatistik/rapor bütünlüğü — `doctorCount`/`appointmentCount` gibi admin
  metrikleri bozulmasın; `Order`/`OrderItem` için verilmiş kararla AYNI felsefe,
  `schema.prisma:2184-2189`).
- `accessTokenHash`/`meetingRoomName` de aynı geçişte temizlenebilir (fonksiyonel değerleri zaten
  randevu bitince sıfırdır) — ama bu, backend-agent'ın implementasyon tercihidir, bloklayıcı değil.

**Neden 12 ay (gerekçe, nihai süre hukuk danışmanı onayına tabidir):** Sağlık hizmetine dair bir
etkileşim kaydı olduğu için makul bir "hizmetle ilgili anlaşmazlık/itiraz" penceresi (KVKK md.5/2-ç
benzeri "hukuki yükümlülüğün ifası" gerekçesiyle karşılaştırılabilir bir süre) öngörülmüştür; bu
proje bir üretim ortamı olmadığından **kesin süre için gerçek bir hukuk danışmanına danışılması
ZORUNLUDUR** — özellikle Türkiye'de sağlıkla ilişkili hizmet kayıtları için sektöre özgü daha uzun
bir asgari süre mevzuatta öngörülmüş olabilir.

**Backend-agent'a görev tanımı (bu doküman NİHAİLEŞTİKTEN SONRA yazılır, [TCT] §9.4 son satırı
gereği) — mevcut `contact-retention.ts` deseniyle BİREBİR aynı iskelet:**

1. **Şema (db-agent, önce):** `Appointment` modeline `patientDataRedactedAt DateTime?` alanı
   eklenir — `ContactSubmission.piiRedactedAt` (`schema.prisma:1756`) ile AYNI adlandırma
   konvansiyonu. Migration salt-ekleme, veri kaybı riski yok.
2. **Sweeper dosyası:** `backend/src/lib/appointment-retention.ts` (yeni dosya,
   `contact-retention.ts` ile AYNI dosya yerleşimi mantığı).
3. **Sorgu deseni (`contact-retention.ts:28-38` ile BİREBİR aynı `updateMany` şekli):**
   ```ts
   const cutoff = new Date(Date.now() - RETENTION_MS); // 12 ay
   await app.prisma.appointment.updateMany({
     where: {
       endsAt: { lt: cutoff },
       patientDataRedactedAt: null,
       status: { in: ["COMPLETED", "CANCELLED", "NO_SHOW"] }, // SCHEDULED/IN_PROGRESS asla dokunulmaz
     },
     data: { patientName: "Silinmiş Kayıt", patientEmail: null, patientDataRedactedAt: new Date() },
   });
   ```
4. **Kadans:** `contact-retention.ts`'teki `RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000`
   (saatlik) ile AYNI — sağlık verisi olduğu için `cart-retention.ts`'in dakikalık kadansına
   GEREK YOK (hassasiyet farkı önemsiz, günlük dahi olabilir; saatlik mevcut desenle tutarlılık
   için tercih edilir).
5. **Kayıt (`registerAppointmentRetentionScheduler`):** `app.ts`'e `registerContactRetentionScheduler`
   ile AYNI blokta (`onReady` içinde, `app.prisma` hazır olduktan sonra) eklenir; `onClose` ile
   `clearInterval` YAPILIR (test/process temizliği, mevcut TÜM sweeper'larla aynı disiplin).
6. **İDEMPOTENT olmalı** (`patientDataRedactedAt: null` filtresi zaten bunu sağlıyor — ikinci
   koşuda no-op).
7. **Audit:** her sweep sonucu `app.log` ile loglanır (observability-agent'ın önerdiği
   `telehealth.*` audit action ailesine `telehealth.appointment.pii_redacted` eklenmesi ÖNERİLİR,
   bloklayıcı değil).

**compliance-agent NİHAİ ONAYI (bu görev kapsamında):** Bu politika **backend-agent tarafından
uygulanmaya hazırdır**; sweeper'ın KENDİSİ bu turda YAZILMAMIŞTIR (görev tanımı gereği, iş
backend-agent'a aittir). `POST /appointments` ucunun birleştirilmesi bu sweeper'ın YAZILMASINI
**beklemez** — retention job'ı ayrı bir takip görevi olarak (`chore(telehealth): 12 aylık hasta PII
anonimleştirme süpürücüsü`) açılmalıdır, mevcut turun DoD'sini bloklamaz (mimari dokümanda da
"süpürücü backend-agent tarafından yazılır" notu var, [TCT] §7.3/§9.4).

---

## KVKK md.11 (silme/erişim/düzeltme talebi) akışı

**Mevcut durum (doğrulandı):** `/admin/telehealth/appointments` ucu **SALT-OKUNUR** (yalnızca
`GET`, `telehealth.admin.routes.ts:331-364`) + misafir/hasta tarafı yalnızca kendi randevusunu
`GET /appointments/{id}` ve `POST /appointments/{id}/cancel` ile görebilir/iptal edebilir
(`telehealth.routes.ts:194-247`). **Dedike bir "verimi sil" veya "verimi düzelt" ucu YOKTUR.**

**Değerlendirme (Order emsaliyle AYNI, `schema.prisma:2184-2189` — bloklayıcı DEĞİL):** Bir hasta
KVKK md.11 kapsamında silme/düzeltme talebinde bulunursa, ADMIN şu an **veritabanı üzerinden
manuel olarak** `patientName`/`patientEmail` alanlarını erken (12 aylık bekleme süresini
beklemeden) yukarıdaki anonimleştirme değerleriyle güncelleyebilir — bu, `Order.customerEmail`/
`customerName` için zaten kabul edilmiş "tek seferlik manuel işlem yeterlidir" kararıyla
BİREBİR aynı desendir. Talep sıklığı artarsa `POST /admin/telehealth/appointments/{id}/anonymize`
gibi dedike bir uç (architect onayıyla) açılabilir — **şu an için gerekli değildir, bloklayıcı
değildir.**

Erişim talebi (md.11 "verime eriş") için: kayıtlı kullanıcı (`patientUserId` dolu) kendi
randevusunu `GET /appointments/{id}` ile zaten görebiliyor; misafir hasta ise randevu
oluştururken aldığı `accessToken` ile aynı uca erişebiliyor — bu, erişim hakkının **teknik
altyapısı zaten var** demektir, ayrı bir "verimi göster" ucu GEREKMEZ.

---

## Kayıt (recording/Egress) yasağının yazılı teyidi

**Teyit edildi:** [TCT] §4.4 madde 5 — LiveKit Egress/kayıt özelliği bu turda **KAPSAM DIŞI**
bırakılmıştır ve backlog'a (`feature/telehealth-recording`, compliance-agent önderliğinde) devredilmiştir.
Bu denetim kapsamında `backend/package.json`'da `livekit-server-sdk` dışında bir Egress/recording
paketi aranmadı çünkü mimari doküman zaten "kod önce YAZILMAZ" diyor — bu turda `telehealth`
modülünün hiçbir dosyasında (`modules/telehealth/**`) kayıt/Egress'e dair bir referans
**beklenmiyor ve bulunmadı**. Görüşmenin kaydedilmediğine ilişkin beyan, `acik-riza-metni`
sayfasının ZORUNLU bölümlerinden biri olarak zaten şablona eklenmiştir
(`telehealth-clinic.ts:755` — "Görüntülü Görüşmenin Kaydedilmediğine İlişkin Beyan").

**compliance-agent notu:** Kayıt özelliği ileride açılırsa (backlog), bu, saklama süresi,
şifreleme, erişim kaydı ve **HER İKİ TARAFIN** (hasta + doktor) açık rızası gerektiren TAMAMEN
AYRI bir değerlendirme turu gerektirir — bu turun onayı O özelliği KAPSAMAZ.

---

## Kendi düzelttiklerim (küçük içerik/metin düzeltmeleri, bu denetim sırasında)

1. **Yanıltıcı "e-postanıza kaydettik" ifadesi** (`frontend/src/components/site/telehealth/availability-calendar.tsx`,
   başarı ekranı) — randevu onay/hatırlatma e-postaları bu turda KAPSAM DIŞIDIR
   ([TCT] §11 backlog: `feature/telehealth-appointment-emails`), ama önceki metin
   "Bağlantıyı e-posta adresinize de kaydettik." diyerek GERÇEKLEŞMEYEN bir veri işleme
   faaliyetini (e-posta gönderimi) olmuş gibi gösteriyordu — bu, KVKK m.10/GDPR m.13 şeffaflık
   ilkesinin ihlalidir (kullanıcıya yapılmayan bir işlemi yapılmış gibi anlatmak). Metni,
   bağlantının yalnızca bu ekranda gösterildiğini ve bu sürümde e-posta gönderilmediğini AÇIKÇA
   belirtecek şekilde değiştirdim; aynı gerekçeyle e-posta alanının `hint` metnini de düzelttim
   ("Katılım bağlantısı bu adrese de gösterilecektir." → "Randevu kaydınızla ilişkilendirilecektir;
   bu sürümde otomatik e-posta gönderilmez.").
2. **Onay kutusu metninin NİHAİ olarak işaretlenmesi** — frontend-agent'ın önceden yazdığı onay
   kutusu metni ([TCT] §5.2 gereği bu metnin içeriği compliance-agent'ın alanıdır) incelendi ve
   KVKK açısından yeterli/kullanılabilir bulundu (varsayılan işaretsiz, KVKK sayfasına link,
   backend'de `z.literal(true)` ile zorunlu). Görev talimatında beklenen
   `TODO(compliance-agent)` yorumu kodda **bulunamadı** (muhtemelen önceki bir turda zaten
   dolduruldu) — bu yüzden yeni metin YAZMADIM, mevcut metni bir kod yorumuyla FİNALİZE ettim ve
   yer tutucu/hukuki geçerliliği olmama uyarısını (aynı [EPT] §4.3 ilkesiyle) kod yorumu olarak
   ekledim; bu uyarıyı **müşteri-yüzeyine YAZMADIM** (üretimde gereksiz tedirginlik yaratır) —
   aynı ilke zaten `extraPages`'teki `LEGAL_PLACEHOLDER_NOTICE` ile müşteri-yüzeyinde
   karşılanıyor.

## Eskale ettiklerim

**Yok.** Yapısal/mimari hiçbir ihlal bulunmadı; [TCT] §7'nin tüm maddeleri kod ve testlerle
doğrulanmış durumda.

## Genel sonuç

| Konu | Durum |
|---|---|
| §7.2 madde 1-6 (demo doktor verisi) | Hepsi GEÇTİ |
| §3.6 madde 7-9 (yapısal garanti) | Hepsi GEÇTİ |
| §7.4 madde 10-13 (tıbbi içerik/iddia) | Hepsi GEÇTİ |
| İşleme envanteri | Tamamlandı (yukarıda) |
| Açık rıza + KVKK aydınlatma metni iskeleti | Tamamlandı — YER TUTUCU, hukuki geçerliliği yok |
| Saklama/anonimleştirme politikası | 12 ay → anonimleştir (silme değil); backend-agent görev tanımı hazır |
| KVKK md.11 akışı | Mevcut uçlarla (erişim) + manuel ADMIN işlemiyle (silme) karşılanıyor, Order emsaliyle tutarlı |
| Kayıt (recording) yasağı | Teyit edildi, kodda hiçbir iz yok |

**BLOKLAYICI madde: YOK. `POST /appointments` ucu birleştirilebilir.**

**Hukuki tavsiye notu (tekrar):** Bu doküman genel KVKK/GDPR prensiplerinin teknik gereksinime
çevrilmiş hâlidir, hukuki tavsiye değildir. Saklama süresi (özellikle sağlık hizmetine özgü
sektörel asgari süreler), açık rıza metninin/KVKK aydınlatma metninin nihai hukuki içeriği ve
md.11 başvuru prosedürü için gerçek bir hukuk danışmanına başvurulması ZORUNLUDUR.

---

## TUR 2 — Sağlık Verisi Yükleme, Çoklu Slot Ödeme ve Portallar (ÖN-ONAY, ENGELLEYİCİ)

> Referans: `.claude/architect-scope-telehealth-template.md` (**[TCT]**) §9.7 "TADİLAT TURU 2"
> (satır 949-1486), özellikle §9.7.5 "KARAR J — Sağlık verisi" (ENGELLEYİCİ), §9.7.4 (veri modeli
> taslağı), §9.7.9 (ajan dağılımı: compliance-agent bu turda **db-agent'tan ÖNCE** çalışır). Bu
> bölüm yukarıdaki Tur 1 onayını **bozmaz, genişletir** — Tur 1'in 12 aylık `patientName`/
> `patientEmail` anonimleştirme politikası ve KVKK aydınlatma/rıza iskeleti **aynen geçerlidir.**
> Bu doküman yine **hukuki tavsiye DEĞİLDİR** (bkz. yukarıdaki `LEGAL_PLACEHOLDER_NOTICE` ilkesi).
>
> **Konum:** Bu, migration YAZILMADAN ÖNCE verilen bir ön-onaydır. §9.7.5'in 10 maddesi burada
> **teker teker gerçek koda karşı** doğrulanmıştır (spekülasyon yapılmamıştır).

**Bu turda yeniden okunan/doğrulanan kod:** `backend/prisma/schema.prisma` (`AppointmentStatus`
satır 1953-1959, `DoctorProfile` 1981-2030, `Appointment` 2055-2101 — `consentAt`/`consentVersion`
alanı **YOK**, `patientDataRedactedAt` alanı da **HENÜZ YOK**; `EmailTemplatePurpose` 1604-1615 —
`APPOINTMENT_CONFIRMATION` henüz eklenmemiş, mimarinin planıyla tutarlı), `backend/src/plugins/
uploads.ts` (tam dosya), `backend/src/modules/media/media.routes.ts` (tam dosya),
`backend/src/lib/crypto.ts` (tam dosya), `backend/src/lib/tokens.ts` (tam dosya),
`backend/src/lib/contact-retention.ts` (tam dosya, saklama süpürücüsü emsali olarak),
`backend/src/lib/audit.ts` (tam dosya), `backend/src/lib/site-roles.ts` (`ROLES_ADMIN`/
`ROLES_ADMIN_MANAGER`/`ROLES_PANEL` tanımları), `backend/src/lib/mime-detect.ts`,
`backend/src/modules/telehealth/telehealth.schemas.ts` (satır 54-62 — mevcut `consent:
z.literal(true)`).

### Genel karar: **KOŞULLU ÖN-ONAY — BLOKER YOK, ancak aşağıdaki şartlar BAĞLAYICIDIR**

§9.7.5'in 10 maddesinin tamamı incelendi. Şema taslağı ([TCT] §9.7.4) ve 10 maddenin tasarımı
KVKK teknik tedbir açısından **yeterlidir**; db-agent migration'lara **başlayabilir**. Hiçbir
madde reddedilmedi. Ancak madde 5 (private storage) için **kritik bir uygulama şartı** ve
birkaç madde için netleştirme/öneri aşağıda **bağlayıcı** olarak not edilmiştir — bunlar şemayı
DEĞİL, backend-agent/devops-agent/security-agent'ın uygulamasını bağlar (§9.7.9 ajan dağılımı
zaten bu ayrımı öngörüyor).

### §9.7.5 — Madde madde denetim

| # | Madde | Mimari iddia (satır referansı) | Doğrulama (bu turda tekrar koşuldu) | Sonuç |
|---|---|---|---|---|
| 1 | Intake **opsiyonel**, randevunun ön koşulu OLAMAZ | [TCT] §9.7.5 madde 1 | Henüz kod yok (uç yazılmadı) — ama mevcut randevu formu zaten yalnızca ad+e-posta+onay topluyor (Tur 1'de doğrulanmış `availability-calendar.tsx:39-43`), semptom/şikâyet alanı YOK. Yeni intake adımının bunun ÜSTÜNE **opsiyonel** bir katman olması mimariyle tutarlı. | **ONAY** — bağlayıcı uygulama şartı: backend `201`'i intake'siz de döndürmeli; qa-agent §9.7.11 madde 23 bunu zaten test kapsamına almış |
| 2 | **Ayrı** açık rıza, randevu onayından BAĞIMSIZ, varsayılan işaretsiz | [TCT] §9.7.5 madde 2 | Mevcut randevu onay kutusu (`telehealth.schemas.ts:62`, `consent: z.literal(true)`) doğrulandı — **ancak** bu kutunun DAHİ bugüne kadar DB'de bir kanıt (zaman damgası/sürüm) BIRAKMADIĞI da bu turda tespit edildi (aşağıya bkz. "Ek bulgu"). Yeni ikinci kutu metni bu bölümde teslim ediliyor (aşağıda). | **ONAY** — metin ekte |
| 3 | Şifreleme (AES-256-GCM), düz metin/arama/log YASAK | [TCT] §9.7.5 madde 3, `lib/crypto.ts` | Doğrulandı: `crypto.ts:11-47` — `encryptSecret`/`decryptSecret`, `aes-256-gcm`, 32 byte anahtar zorunluluğu, `iv:authTag:ciphertext` hex formatı. Halihazırda `User.twoFactorSecret` için üretimde kullanılıyor. | **ONAY** — `AppointmentIntake.noteCiphertext` için AYNEN yeniden kullanılmalı, yeni bir şifreleme mekanizması YAZILMAMALI |
| 4 | **`Media` tablosu YASAK** | [TCT] §9.7.5 madde 4, `uploads.ts:32-34`, `GET /admin/media` | **Doğrulandı, birebir.** `uploads.ts:29-51`: `/uploads/` `@fastify/static` alt-context'inde register edilir, tek koruma `scope.rateLimit(UPLOADS_RATE_LIMIT)`'tir — **kimlik doğrulama hook'u YOK**; `root: UPLOAD_DIR, prefix: "/uploads/"` satır 32-34 mimarinin iddia ettiği YERDE ve mimarinin iddia ettiği ŞEKİLDE. `media.routes.ts:85-88`: `adminMediaRoutes` yalnızca `authenticate` + `requirePanelAccess()` hook'u takar; `GET "/"` (satır 207-235) **`requireSiteRole` KISITLAMASI TAŞIMIYOR** → `ROLES_PANEL = ["ADMIN","MANAGER","EDITOR"]` (`site-roles.ts:11`) **hepsi** `GET /admin/media`'yı çağırabilir. Mimarinin (a) ve (b) gerekçesi **ikisi de teyit edildi.** | **ONAY, bağlayıcı** |
| 5 | Özel depolama (`PRIVATE_UPLOAD_DIR`) + kapılı servis | [TCT] §9.7.5 madde 5 | Bu bir **YENİ altyapı** — `PRIVATE_UPLOAD_DIR` şu an kod tabanında **hiç yok**, yalnızca `UPLOAD_DIR` (`uploads.ts:10`) var ve o **tamamen herkese açık**. Kritik ek şart aşağıda. | **ONAY + KRİTİK ŞART (aşağıda)** |
| 6 | Erişim kaydı ZORUNLU (audit) | [TCT] §9.7.5 madde 6, `logAudit` | Doğrulandı: `audit.ts:21-34` — `logAudit(app, input)` mevcut ve üretimde kullanılıyor; `action: string` **serbest metin** (enum DEĞİL) — `"telehealth.intake_document.accessed"` gibi yeni action değerleri **migration gerektirmeden** eklenebilir. Kod yorumu zaten "`metadata`'ya asla token/URL/şifre yazma" diyor (`audit.ts:19`). | **ONAY** — madde 8 gereği bu kural not/belge İÇERİĞİNİ ve dosya ADINI da kapsayacak şekilde GENİŞLETİLMELİ (aşağıda tekrar) |
| 7 | Yetkilendirme: hasta / o booking'in doktoru / ADMIN — **MANAGER içerik HARİÇ**, **EDITOR hiç YOK** | [TCT] §9.7.5 madde 7 | Kod henüz yok (uç yazılmadı). Mevcut `ROLES_PANEL`/`ROLES_ADMIN_MANAGER` sabitlerinin HİÇBİRİ bu üçlüyü (hasta+doktor+ADMIN, MANAGER'ı içerikten hariç tutarak) karşılamıyor — bu **kasıtlı olarak yeni ve daha dar** bir yetki kümesi, mevcut sabitlerden biri yanlışlıkla kullanılmamalı. | **ONAY + ÖNERİ (aşağıda)** |
| 8 | Sızma yasakları (DTO/webhook/e-posta/log/Sentry/LiveKit metadata) | [TCT] §9.7.5 madde 8 | Kod henüz yok, şu an denetlenebilir değil — ilke düzeyinde doğru. | **ONAY (ilke)** — uygulama bittiğinde code-quality-agent + security-agent + compliance-agent (son denetim, §9.7.9) YENİDEN taramalı |
| 9 | Saklama: son `endsAt` + **90 gün**, gerçek silme | [TCT] §9.7.5 madde 9 | Aşağıda ayrı bölümde teyit edildi. | **ONAY — 90 gün TEYİT EDİLDİ** |
| 10 | Silme hakkı uçları (`DELETE .../intake`, `DELETE .../documents/{id}`) | [TCT] §9.7.5 madde 10 | Kod henüz yok; tasarım KVKK md.11'in "beklemeden sil" ilkesine Tur 1'deki "ADMIN manuel işlem" çözümünden DAHA GÜÇLÜ bir karşılık veriyor (kendi kendine hizmet). | **ONAY** |

**Ek bulgu (bloklayıcı değil, ama not edilmeli):** Mevcut tek-slot `POST /appointments`
akışında `consent: z.literal(true)` yalnızca **istek anında** doğrulanıyor
(`telehealth.schemas.ts:62`) — `Appointment` modelinde bunu kalıcı kanıta çeviren bir
`consentAt`/`consentVersion` kolonu **hiç yok**. Yani bugüne kadar oluşan randevularda "rıza
verildi" olgusunun DB'de bir zaman damgalı kanıtı **yoktur**, yalnızca "form geçti" olgusu vardır.
[TCT] §9.7.4'ün `AppointmentBooking.consentAt`/`consentVersion` (NOT NULL) alanları bu boşluğu
**kapatıyor** ve bu turdan sonra artık `POST /appointments` (deprecated, iç olarak booking
üretecek — [TCT] §9.7.2) üzerinden gelen randevular da bu kanıtı taşıyacak. **Bu bir iyileştirme
olarak ONAYLANIR**, geriye dönük backfill mimarinin de belirttiği gibi ([TCT] §9.7.4 "backfill
YAPILMAZ") **istenmez/gerekmez** — geçmiş kaydın kanıtı yoksa bu, o dönem yürürlükte olan sürecin
bir eksikliğidir, retroaktif olarak üretilemez.

### KRİTİK ŞART — madde 5 (private storage) için bağlayıcı uygulama koşulu

`plugins/uploads.ts` doğrulamasında görüldüğü gibi, `@fastify/static` `root: UPLOAD_DIR` altındaki
**her şeyi**, alt klasörler dahil, `/uploads/**` üzerinden **kimlik doğrulamasız** servis eder.
Bu nedenle:

- **`PRIVATE_UPLOAD_DIR`, `UPLOAD_DIR`'ın (`uploads.ts:10`, `path.join(process.cwd(), "uploads")`)
  ALT DİZİNİ OLAMAZ.** Örn. `uploads/private/` **YASAK** — statik sunucu onu da servis eder ve
  tüm madde 4/5 tasarımı sessizce delinir. Ayrı, kardeş bir dizin olmalıdır (ör.
  `process.cwd() + "/uploads-private"`, mimarinin önerdiği isim zaten bu).
- devops-agent bu dizini **Docker imajına/volume'e** eklerken `@fastify/static` register'ının
  **hiçbir zaman** bu kökü `root` olarak almadığından emin olmalıdır (statik plugin başka bir
  register çağrısıyla yanlışlıkla bu dizine yönlendirilebilir — kod incelemesinde bilinçli
  aranmalı).
- security-agent'ın §9.7.9'daki "private storage'ın statik servis ALTINDA OLMADIĞININ
  doğrulanması" maddesi bu yüzden **salt bir öneri değil, madde 4/5'in fiilen çalışması için
  ön koşuldur** — compliance-agent bunu kendi ENGELLEYİCİ yetkisiyle DESTEKLER.
- qa-agent §9.7.11 madde 25 ("Sızıntı testi ENGELLEYİCİ") zaten bunu e2e'de test ediyor; bu test
  **kırmızıya düşerse merge YAPILAMAZ.**

### Öneri — madde 6 ve 7 için netleştirme (bağlayıcı olmayan, tavsiye niteliğinde)

1. **Madde 6 genişletmesi (bağlayıcı):** `logAudit` çağrılarında `metadata` alanına belge/not
   İÇERİĞİ, dosya ADI veya `storagePath` **asla** yazılmamalıdır — yalnızca `documentId`,
   `bookingId`, aktör, IP gibi opak tanımlayıcılar. Bu, `audit.ts:19`'daki mevcut "token/URL/şifre
   yazma" kuralının [TCT] §9.7.5 madde 8 ile birleşiminin doğal sonucudur, yeni bir kural değil.
2. **Madde 7 için öneri (bağlayıcı değil):** ADMIN'in içerik erişimi "destek" amaçlı istisnadır;
   ADMIN'in `GET /appointments/documents/{documentId}/content` çağrısında (yalnızca ADMIN için)
   `?reason=` gibi bir sorgu parametresi veya audit `metadata.reason` alanı **zorunlu** kılınması
   önerilir — bu, `mark-paid` ucunun `reason` zorunluluğuyla ([TCT] §9.7.1 madde 7) AYNI disiplindir
   ve ADMIN'in özel nitelikli veriye erişimini gerekçelendirilebilir kılar. **Bloklayıcı değildir**,
   backend-agent'ın takdirine bırakılır; uygulanmazsa bile madde 7 ONAY'ı geçerlidir.
3. Yetki kümesi için yeni bir sabit önerilir: `backend/src/lib/telehealth-access.ts` içinde
   `isBookingPatient(...)`/`isBookingDoctor(...)`/`role === "ADMIN"` türetmeleri — `ROLES_PANEL`/
   `ROLES_ADMIN_MANAGER`'dan **KOPYALANMAMALI**, çünkü bunlar farklı bir yetki modelidir (rol
   tabanlı değil, ilişki+rol karışımı). Bu, backend-agent'ın implementasyon tercihidir.

### Saklama süresi — 90 gün TEYİT EDİLDİ (görev maddesi 3)

**Karar: [TCT] §9.7.5 madde 9'daki 90 gün ONAYLANIR, değiştirilmesi ÖNERİLMEZ.**

Gerekçe:
- Tur 1'in `Appointment.patientName`/`patientEmail` için belirlediği **12 aylık** anonimleştirme
  penceresi (yukarıda, satır ~116-130) **genel randevu PII'sine** aittir ve "hizmetle ilgili
  anlaşmazlık/itiraz" makul süresi mantığıyla gerekçelendirilmişti.
- Şikâyet notu + tıbbi belge ise KVKK md.6 **özel nitelikli veridir** — genel PII'den DAHA SIKI
  minimizasyon gerektirir. 90 gün (~3 ay), 12 aydan **belirgin şekilde kısadır** ve bu hiyerarşiyi
  (özel nitelikli veri ≤ genel PII saklama süresi) doğru kurar.
- 90 günlük pencere, hastanın/doktorun görüşme sonrası makul bir "takip" süresi (ör. ikinci bir
  görüşe referans, doktorun aynı hasta için devam eden tedavi bağlamı) için yeterli pratik alanı
  bırakırken, veriyi süresiz veya 12 ay gibi uzun bir süre tıbbi belge/not biçiminde tutmanın
  yarattığı riski (ihlal yüzeyi, üçüncü kişi talebi, vb.) sınırlar.
- **Süre, bağlayıcı olarak `booking`'in TÜM randevu satırlarının `MAX(endsAt)`'inden itibaren
  hesaplanmalıdır** (çoklu slotta tek bir booking'in son slotu bitmeden temizlik başlamamalı) —
  bu netleştirme mimaride açıkça yazılmamıştı, backend-agent için bağlayıcı bir uygulama detayı
  olarak burada eklenir.
- Nihai/kesin süre için gerçek bir hukuk danışmanına başvurulması gerektiği (özellikle sağlık
  hizmeti kayıtlarına dair sektörel asgari saklama süreleri olabileceği) **tekrar hatırlatılır**
  ([TCT]'nin kendi notuyla ve Tur 1'in "hukuki tavsiye notu"yla tutarlı) — ama bu proje bir
  üretim ortamı olmadığından **90 gün mühendislik/uyumluluk kararı olarak yeterli ve savunulabilir
  kabul edilir**, sweeper'ın yazılmasını beklemez.

**Süpürücü için not (backend-agent'a, [TCT] §9.7.5 madde 9 ile aynı):**
`backend/src/lib/intake-retention.ts`, `contact-retention.ts`/(Tur 1'in önerdiği
`appointment-retention.ts`) iskeletiyle AYNI desende: `where: { booking: { appointments: { every:
{ endsAt: { lt: cutoff90d } } } }, deletedAt: null }` benzeri bir sorguyla dosyaları diskten silip
`AppointmentDocument.deletedAt` yazmalı ve `AppointmentIntake.noteCiphertext`'i `null`'lamalı.
Kadans günlük (`24 * 60 * 60 * 1000`) önerilir — saatlik kadans (Tur 1 deseni) burada gereksiz
sıklıktadır, günlük yeterlidir ve `booking-expiry.ts`'in 5 dakikalık kadansıyla (farklı amaç —
slot serbest bırakma) KARIŞTIRILMAMALIDIR.

### Magic-link geçerlilik süresi — "son `endsAt` + 30 gün" değerlendirmesi (görev maddesi 4)

[TCT] §9.7.7 madde 4: `AppointmentBooking.accessTokenHash`'in geçerliliği "son `endsAt` + 30 gün"
(ödeme belgesi/booking erişimi için), nihai kararın security-agent'a bırakıldığı belirtiliyor.
**compliance-agent'ın veri minimizasyonu açısından yorumu (bağlayıcı değil, security-agent'a
girdi):**

1. Bu token yalnızca "ödeme belgesi" erişimi için değil — [TCT] §9.7.10 uç tablosuna göre AYNI
   `?t=` mekanizması `GET/PUT/DELETE .../intake` ve belge uçlarına da hasta kimliği olarak
   hizmet ediyor (madde 7'nin "(a) hastanın kendisi (oturum veya doğru `?t=`)" tanımı). Yani bu,
   **özel nitelikli veriye de erişim açan** bir kimlik doğrulama aracıdır — sıradan bir "fatura
   görüntüleme bağlantısı" değildir. Bu ayrım security-agent'ın TTL kararına AÇIKÇA girdi olarak
   verilmelidir.
2. **Minimizasyon açısından olumlu olan:** madde 9'daki 90 günlük veri saklama süresi zaten
   30 günden UZUNDUR — yani link süresi dolduğunda (30. gün) sağlık verisi hâlâ DB'de olabilir
   (90. güne kadar). Bu, riski TAMAMEN ortadan kaldırmaz ama link süresi veri saklama süresinden
   KISA olduğu için maruziyet penceresi link TTL'i (30 gün) ile sınırlıdır, 90 günle değil — bu
   **doğru yöndeki bir tasarımdır**, DEĞİŞTİRİLMESİ ÖNERİLMEZ.
3. **Öneri (bağlayıcı değil):** Link, e-posta yoluyla iletildiği için (§9.7.8) yönlendirme/
   forward riski taşır — genel PII/fatura erişimi için 30 gün kabul edilebilir olsa da,
   security-agent'ın karar verirken şunu değerlendirmesi önerilir: token sahibinin sağlık verisi
   uçlarına erişimi, oturum açmış bir kullanıcı (2FA'lı hesap) ile misafir token'ı arasında AYNI
   yetki seviyesinde olmamalı mı sorusu — mevcut tasarımda ikisi de "hasta" sayılıyor ve bu,
   randevu bilgisinin doğası (genelde misafir/tek seferlik hasta akışı) gereği MAKUL kabul
   edilir; ek bir faktör (e-posta OTP vb.) bu turun kapsamı DIŞINDADIR ve gerekli görülmemiştir.
4. **Sonuç: compliance-agent 30 günü VETO ETMİYOR**, KVKK minimizasyonu açısından itiraz yok;
   nihai TTL kararı [TCT]'nin belirttiği gibi **security-agent'ındır.**

### Yetkilendirme matrisi, Media yasağı, audit zorunluluğu — KVKK teknik tedbir yeterliliği (görev maddesi 5)

**Onaylanır.** KVKK'nın "uygun teknik ve idari tedbir" (m.12) gerekliliği açısından:
- `Media` tablosu yasağı + private storage + kapılı servis → **erişim kontrolü** tedbiri karşılanıyor
  (yukarıdaki KRİTİK ŞART'a tabi).
- AES-256-GCM şifreleme → **gizlilik/şifreleme** tedbiri karşılanıyor.
- Audit log zorunluluğu → **hesap verebilirlik/izlenebilirlik** tedbiri karşılanıyor.
- Yetki matrisi (hasta/doktor/ADMIN, MANAGER hariç içerik, EDITOR hariç tamamen) → **erişimin
  gereklilik ilkesine göre daraltılması (need-to-know)** tedbiri karşılanıyor; bu, ROLES_PANEL'in
  varsayılan geniş erişiminden (madde 4'te tam da bu yüzden şikayet edilen davranış) BİLİNÇLİ bir
  sapmadır ve doğru yöndedir.

Dördü birlikte KVKK md.6/2 özel nitelikli veri için beklenen asgari teknik tedbir setini
**karşılar.** Eksik kalan tek şey (antivirüs taraması) mimari tarafından zaten bilinçli kabul
edilmiş risk olarak backlog'a alınmış ([TCT] §9.7.12) — compliance-agent bunu **security-agent'ın
zaten imzaladığı** bir karar olarak **aynen kabul eder**, tekrar itiraz etmez.

---

### Sağlık verisi rızası — YENİ, İKİNCİ, AYRI onay kutusu metni (İSKELET, hukuki metin DEĞİL)

**Bağlayıcı uyarı (Tur 1'deki `LEGAL_PLACEHOLDER_NOTICE` ilkesiyle AYNI):** Aşağıdaki metin
taslak/iskelettir, hukuki geçerliliği YOKTUR. Canlıya almadan önce gerçek bir hukuk danışmanıyla
gözden geçirilmelidir. frontend-agent bu metni **DEĞİŞTİRMEDEN** kullanır (§5.2 `ContactForm`
emsali — metnin içeriği compliance-agent'a aittir).

**Konum:** Bu, randevu formunun mevcut/DEĞİŞMEYEN KVKK onay kutusundan (Tur 1, satır 86-95)
**tamamen bağımsız**, intake adımının (opsiyonel) İÇİNDE, not/belge alanlarının HEMEN ÜSTÜNDE
gösterilir. Varsayılan **İŞARETSİZ**. Bu kutu işaretlenmeden not yazılamaz/belge seçilemez
(frontend: alanlar devre dışı; backend: `422 HEALTH_CONSENT_REQUIRED`).

> **Sağlık Verisi Paylaşım İzni (isteğe bağlıdır)**
>
> Şikâyet notu yazmak ve/veya tıbbi belge (reçete, tahlil sonucu, radyoloji görüntüsü vb.)
> yüklemek **tamamen isteğe bağlıdır.** Bu adımı **atlayabilirsiniz** — atlamanız randevunuzu,
> ödemenizi veya görüşmenizi **hiçbir şekilde etkilemez.**
>
> Paylaşmak isterseniz: [Sağlık Verisi Açık Rıza Metni]'ni okudum. Yazdığım şikâyet notunun
> ve/veya yüklediğim belgelerin — Kişisel Verilerin Korunması Kanunu kapsamında **özel nitelikli
> kişisel veri (sağlık verisi)** sayıldığını biliyorum ve bunların **yalnızca bu randevu
> kapsamında, ilgili doktorumla paylaşılması ve şifrelenerek saklanması** amacıyla işlenmesine
> **açık rızamı veriyorum.**
>
> Bu rızanın yukarıdaki randevu onayından **bağımsız** olduğunu, istediğim zaman
> paylaştığım notu/belgeleri **bekletmeksizin silebileceğimi** ve bu rızayı **geri
> alabileceğimi** biliyorum.
>
> ☐ Yukarıdaki metni okudum, sağlık verimin işlenmesine açık rıza veriyorum.
> *(varsayılan: işaretsiz)*

**Backend'de zorunlu alan eşlemesi:** bu kutu işaretlenmeden `PUT .../intake` veya
`POST .../documents` çağrılırsa → `422 HEALTH_CONSENT_REQUIRED` ([TCT] §9.7.5 madde 2,
§9.7.10 hata kodu listesi ile tutarlı).

**"Sağlık Verisi Açık Rıza Metni" sayfası — ZORUNLU bölüm iskeleti** (Tur 1'deki `acik-riza-metni`
sayfasına EK bir bölüm olarak veya ayrı bir alt-sayfa olarak eklenmelidir — nihai yerleşim
frontend-agent'ın, İÇERİK compliance-agent'ındır):
1. Rızanın Konusu — şikâyet notu ve/veya yüklenen tıbbi belgeler
2. İşlenecek Özel Nitelikli Veri Kategorisi — sağlık verisi (KVKK md.6) — [tam kapsam hukuk
   danışmanıyla netleştirilmeli]
3. İşlemenin Amacı ve Sınırı — YALNIZCA ilgili booking'in doktoruyla paylaşım; başka hiçbir amaçla
   (pazarlama, istatistik, üçüncü taraf paylaşımı) KULLANILMAZ
4. Saklama Süresi — randevunun bitiminden (son `endsAt`) itibaren **90 gün**, sonra **gerçekten
   silinir** (anonimleştirme değil, silme)
5. Rızanın Geri Alınması / Silme Hakkı — hasta, randevu tamamlanmadan/bittikten sonra
   **beklemeksizin** `DELETE .../intake` veya `DELETE .../documents/{id}` ile verisini silebilir
6. [DOLDURULACAK — başvuru kanalı, veri sorumlusu iletişim bilgisi — hukuk danışmanı onayı gerekir]

---

### `consentVersion` / `healthDataConsentVersion` sürümleme önerisi

**Format (ikisi için de ORTAK, bağlayıcı):** basit string, **enum DEĞİL** (Tur 1/[TCT]'nin genel
"serbest metin > geri alınamaz enum" disipliniyle tutarlı — ör. `DoctorProfile.title`,
`AppointmentBooking.paidBy`). Değer: `"v1"`, `"v2"`, … — yalnızca metnin **maddi/kapsam
değiştiren** bir revizyonunda artırılır (yazım/noktalama düzeltmesi sürüm ARTIRMAZ).

| Alan | Konum | Bu turdaki başlangıç değeri | Neyi temsil ediyor |
|---|---|---|---|
| `AppointmentBooking.consentVersion` | `appointment_bookings` | **`"v1"`** | Randevu KVKK onay kutusu metni (Tur 1'de finalize edilen, satır 86-95 — DEĞİŞMEDİ). Bu, bu metnin DB'de kanıtlanan İLK sürümüdür (yukarıdaki "Ek bulgu" — önceden hiç kanıtlanmıyordu). |
| `AppointmentIntake.healthDataConsentVersion` | `appointment_intakes` | **`"v1"`** | Bu bölümde teslim edilen YENİ sağlık verisi rızası metni. |

Not: İki alan birbirinden **bağımsız** artar (biri "v2" olduğunda diğeri "v1" kalabilir) —
metinler ayrı belgeler olduğu için ortak bir sürüm numarası **yanıltıcı** olurdu.

---

### Özet tablo (bu bölüm)

| Konu | Durum |
|---|---|
| §9.7.5 madde 1-10 | Hepsi **ONAY** (madde 5 kritik şarta, madde 2/6/7 küçük netleştirmelere tabi) |
| Bloklayıcı bulgu | **YOK** — db-agent migration'lara başlayabilir |
| Kritik uygulama şartı | `PRIVATE_UPLOAD_DIR`, `UPLOAD_DIR`'ın alt dizini OLAMAZ (backend-agent/devops-agent/security-agent'ı bağlar) |
| Sağlık verisi rızası metni | Teslim edildi (yukarıda), varsayılan işaretsiz, randevu onayından bağımsız |
| `consentVersion` / `healthDataConsentVersion` | İkisi de `"v1"`'den başlar, bağımsız, string (enum değil) |
| Saklama süresi (sağlık verisi) | **90 gün TEYİT EDİLDİ** (booking'in `MAX(endsAt)`'inden itibaren) |
| Saklama süresi (genel randevu PII, Tur 1) | 12 ay — DEĞİŞMEDİ, 90 günden UZUN kalmaya devam ediyor (doğru hiyerarşi) |
| Magic-link TTL (30 gün) | compliance-agent VETO ETMİYOR; security-agent'a "bu token sağlık verisine de erişir" notuyla teslim edildi |
| Media/private storage/audit/yetki matrisi | KVKK m.12 teknik tedbir açısından **yeterli** |
| Ek bulgu (bloklayıcı değil) | Mevcut `POST /appointments` rızayı hiç KANITLAMIYOR (kolon yok) — Tur 2'nin `consentAt`/`consentVersion`'ı bunu düzeltiyor, backfill GEREKMEZ |

**Hukuki tavsiye notu (tekrar, Tur 1 ile aynı ilke):** Bu bölüm de hukuki tavsiye DEĞİLDİR. 90
günlük saklama süresi, sağlık verisi rızası metninin nihai hukuki içeriği ve KVKK md.11 başvuru
prosedürü için gerçek bir hukuk danışmanına başvurulması ZORUNLUDUR.

---

### Son Denetim — Uygulama Doğrulaması (ENGELLEYİCİ, §9.7.9 "compliance-agent (son denetim)")

> Bu bölüm, yukarıdaki TUR 2 ÖN-ONAYININ 10 maddesinin GERÇEKTEN yazılan koda karşı, satır satır
> yeniden doğrulanmasıdır (spekülasyon yok — her madde için dosya okunmuştur). Ön-onay
> BOZULMAMIŞTIR; bu bölüm onu genişletir.

**Karar: ONAY.** 10 maddenin tamamı koda birebir uygulanmış durumda. **Bloklayıcı sapma YOK.**
Görev maddesi 10 (magic-link rotasyonu) için bir **gözlem** (bloklayıcı değil, security-agent'a
paralel not) var — aşağıda ayrıntılı.

#### Madde madde doğrulama

| # | Konu | Kanıt (dosya/satır) | Sonuç |
|---|---|---|---|
| 1 | Ayrı rıza metni BİREBİR kullanıldı, varsayılan işaretsiz, atlanabilir | `frontend/src/components/site/telehealth/booking-intake-step.tsx:99-125` — metin bu belgedeki (satır ~454-471) metinle KELİMESİ KELİMESİNE aynı; `useState(false)` ile `consent` varsayılan `false` (satır 34); "Bu adımı atla" butonu **hiçbir istek göndermeden** doğrudan `onDone()` çağırıyor (satır 136-138), backend `PUT .../intake`/`POST .../documents` hiç tetiklenmiyor | **GEÇTİ** |
| 2 | Şifreleme AES-256-GCM, düz metin YOK | `telehealth.routes.ts:41` `encryptSecret`/`decryptSecret` import; satır 526 `encryptSecret(request.body.note)` → `noteCiphertext`; satır 569 `decryptSecret(intake.noteCiphertext)` — `lib/crypto.ts` YENİDEN KULLANILMIŞ, yeni şifreleme mekanizması YAZILMAMIŞ; şema (`schema.prisma:2200`) `noteCiphertext String?` düz metin kolonu YOK, index/arama alanı YOK | **GEÇTİ** |
| 3 | `Media` tablosu YASAK | `backend/src/lib/telehealth-document-storage.ts` TAMAMI okundu — `prisma.media` referansı **YOK**; kendi `PRIVATE_UPLOAD_DIR` (satır 28, `env.PRIVATE_UPLOAD_DIR`den, `UPLOAD_DIR`dan BAĞIMSIZ) kullanıyor; dosya üstü yorum (satır 14-17) `lib/storage/*` (MediaStorage) BİLİNÇLİ OLARAK kullanılmadığını açıklıyor; `backend/src/modules/media/` altında `AppointmentDocument`/`appointmentDocument` referansı **0 eşleşme** (ayrı grep ile doğrulandı) | **GEÇTİ** |
| 4 | Audit log her okuma için | `telehealth.routes.ts:573-580` `GET .../intake` → `logAudit(action: "telehealth.intake_note.accessed", ...)`; satır 754-762 `GET /appointments/documents/{id}/content` → `logAudit(action: "telehealth.intake_document.accessed", metadata: { bookingId })` — `metadata`'da dosya adı/`storagePath`/not içeriği **YOK** (§9.7.5 madde 6/8 birleşik kuralına uygun) | **GEÇTİ** |
| 5 | Yetki matrisi: MANAGER içerik HARİÇ (sayı OK), EDITOR hiç YOK, başka doktor → 404 | `backend/src/lib/telehealth-access.ts` — `assertBookingHealthDataAccess` (satır 53-58) yalnızca ADMIN/doktor/hasta'ya izin verir, MANAGER/EDITOR **hiç kontrol edilmiyor** → varsayılan `throw NotFoundError` (404, varlık sızdırılmaz); `assertBookingViewAccess` (satır 40-45) MANAGER'ı booking GÖRÜNÜMÜNE (sayı/metadata) alıyor ama bu fonksiyon içerik uçlarında KULLANILMIYOR — içerik uçları (`GET .../intake`, `GET .../documents`, `GET .../documents/{id}/content`) hepsi `assertBookingHealthDataAccess` çağırıyor (satır 564, 723, 748) | **GEÇTİ** |
| 6 | Saklama 90 gün, `MAX(endsAt)`'ten itibaren, süpürücü kayıtlı | `backend/src/lib/intake-retention.ts:29` `INTAKE_RETENTION_MS = 90 * 24h`; `findDueBookingIds` (satır 38-53) `Math.max(...booking.appointments.map(a => a.endsAt.getTime()))` ile TÜM randevu satırlarının son `endsAt`'ini alıyor (çoklu slotta doğru); `app.ts:70,374` `registerIntakeRetentionScheduler(app)` çağrılıyor (kayıtlı) | **GEÇTİ** |
| 7 | Silme uçları var, beklemeden | `telehealth.routes.ts:586` `DELETE .../intake` (satır 602-607, `noteCiphertext: null`, rıza kanıtı korunur); satır 773 `DELETE /appointments/documents/{id}` (satır 788-790, dosya diskten silinir + `deletedAt`); ikisi de `assertBookingPatientOrAdminAccess` — hasta beklemeden silebiliyor | **GEÇTİ** |
| 8 | E-posta şablonunda sızma YOK | `backend/prisma/seed.ts:141-144` — konu "**Randevunuz onaylandı**" (nötr); gövde değişkenleri `booking_number, patient_name, slots_summary, total_formatted, magic_link` — uzmanlık/doktor adı, şikâyet notu, belge adı **YOK**; `lib/notifications.ts:78-84` bu değişkenleri dolduran kod da AYNI kısıtla uyumlu (yalnızca saat/tutar/link) | **GEÇTİ** |
| 9 | `Order`/`OrderItem` KULLANILMADI | `backend/src/modules/telehealth/` altında `prisma.order`/`OrderItem` grep'i **0 eşleşme** | **GEÇTİ** |
| 10 | Magic-link rotasyon + Stripe metadata — KVKK değerlendirmesi | Aşağıda ayrı bölüm | **GÖZLEM (bloklayıcı değil)** |

**Ek doğrulama (kritik şart, §9.7.5 madde 5):** `PRIVATE_UPLOAD_DIR` (`telehealth-document-storage.ts:28`, varsayılan `./storage/private-uploads`) `process.cwd()/storage/private-uploads`'a çözülüyor; `UPLOAD_DIR` (`plugins/uploads.ts:10`) `process.cwd()/uploads`'tır — biri diğerinin ALT DİZİNİ **DEĞİL**, kardeş dizin. `docker-compose.yml:77` `saas_private_uploads:/app/storage/private-uploads` **AYRI, isimlendirilmiş bir volume** ve `/app/uploads` altına mount EDİLMİYOR (satır 71-73 yorumu bunu açıkça teyit ediyor). Kritik şart karşılanmış.

#### Madde 10 — Magic-link rotasyonu ve Stripe metadata: KVKK değerlendirmesi

**Kod akışı doğrulandı:**
- `telehealth.checkout.routes.ts:132-135` — checkout-session açılırken `request.query.t` (misafir
  `?t=`) VARSA, bu ham token `metadata.rawAccessToken` olarak Stripe'a taşınıyor.
- `webhooks/stripe.routes.ts:95,99-103` — webhook, `session.metadata.rawAccessToken` varsa bunu
  `confirmBookingPayment`'a `knownRawAccessToken` olarak geçiriyor → `booking.ts:334`
  `input.knownRawAccessToken ?? generateOpaqueToken()` → token AYNI kalıyor (rotate edilmiyor).
- `metadata.rawAccessToken` YOKSA (ör. ADMIN'in `POST .../mark-paid` çağrısı, `knownRawAccessToken`
  hiç geçilmiyor — `telehealth.admin.routes.ts:444`) → **rotasyon oluyor**, YENİ token üretiliyor.

**Erişim sürekliliği analizi (kod üzerinden doğrulandı, spekülasyon değil):**
`assertBookingPatientOnlyAccess`/`isRequestingPatient` (`telehealth-access.ts:25-29`) hem
`patientUserId` eşleşmesini HEM DE token eşleşmesini kabul ediyor. `checkout-session` ucunu
çağırabilmek için zaten `assertBookingPatientOnlyAccess`'ten geçmek GEREKİYOR
(`telehealth.checkout.routes.ts:88`) — yani:
- Oturumlu (Bearer) hasta `?t=` GÖNDERMESE de ucu çağırabilir (patientUserId eşleşmesiyle); bu
  durumda webhook'ta rotasyon olur AMA hasta zaten `patientUserId` üzerinden kalıcı, token-bağımsız
  erişime sahiptir — **erişim KAYBI yok.**
- Misafir (patientUserId=null) hasta ucu çağırabilmek için **zorunlu olarak** `?t=` göndermek
  ZORUNDADIR (token dışında hiçbir kimlik kanıtı yok) — bu durumda metadata her zaman dolu, rotasyon
  **hiç tetiklenmez.**
- Tek rotasyon senaryosu: **ADMIN manuel `mark-paid`.** Bu durumda `confirmBookingPayment` sonrası
  `triggerAppointmentConfirmationEmail` YENİ `rawAccessToken` ile çağrılıyor
  (`telehealth.admin.routes.ts:462`) — yani hastaya YENİ, ÇALIŞAN bir magic-link e-posta ile
  gönderiliyor. Booking oluşturma anında hastaya verilen (KAYDA GEÇMEYEN, yalnızca o anki API
  yanıtında görünen) ilk token bu noktada geçersiz kalıyor.

**KVKK değerlendirmesi (compliance-agent, bağlayıcı olmayan görüş, security-agent'a paralel girdi):**
1. **md.11 erişim hakkı kesintiye uğramıyor** — rotasyonun tek gerçekleştiği yol (ADMIN manuel
   ödeme onayı) her zaman TAZE bir linki hastanın KAYITLI e-posta adresine gönderiyor; hasta asla
   "artık verime erişemiyorum" durumuna düşmüyor, yalnızca eski bağlantısı (varsa bir yere not
   almışsa) geçersizleşiyor — bu, `resend-link` ucunun ZATEN kasıtlı davranışıyla (her çağrıda
   rotate) AYNI ilkedir, yeni bir risk DEĞİLDİR.
2. **Aynı kişiye mi erişim veriliyor?** Evet — rotasyon her durumda ya (a) zaten kimliği doğrulanmış
   `patientUserId` sahibine (token'dan bağımsız erişimi zaten var) ya da (b) booking'in kayıtlı
   `patientEmail`'ine gönderilen yeni bağlantı üzerinden AYNI hastaya yöneliyor. Kimliği farklı
   birine erişim AÇILMIYOR.
3. **Yeni/farklı risk — Stripe'a ham erişim kimlik bilgisi (credential) taşınması:** Bu, salt bir
   "rotasyon" sorunu değil, ayrı bir veri minimizasyonu gözlemidir. `rawAccessToken`, yalnızca bir
   fatura/ödeme referansı değil — AYNI ZAMANDA §9.7.5'in özel nitelikli veri (sağlık verisi)
   uçlarına (`GET/PUT/DELETE .../intake`, belge uçları) erişim açan bir kimlik doğrulama aracıdır
   (Tur 2'nin "Magic-link geçerlilik süresi" bölümünde zaten bu ayrım security-agent'a not
   edilmişti). Bu token'ın üçüncü bir tarafın (Stripe, ABD merkezli alt-işleyen) `metadata`
   alanına — kendi işleme amacı (ödeme) için GEREKMEYEN bir veri olarak — yazılması, veri
   minimizasyonu ilkesi açısından **ayrıca gerekçelendirilmesi gereken** bir akıştır. Kod yorumu
   (`telehealth.checkout.routes.ts:117-131`) bunu zaten kendiliğinden security-agent'a taşımış —
   compliance-agent bunu **DESTEKLER ve YİNELER**: bu, salt bir güvenlik (sızıntı/log) sorunu değil,
   aynı zamanda "amaç sınırlaması" (KVKK md.4) açısından bir üçüncü-taraf-paylaşımı değerlendirmesi
   gerektirir. **Öneri (bağlayıcı değil):** Stripe metadata'sına ham token yerine, booking'e özgü
   KISA ÖMÜRLÜ, tek-kullanımlık AYRI bir "webhook eşleştirme" opak değeri (token'ın kendisi değil,
   yalnızca webhook'un `knownRawAccessToken`'ı DOĞRU booking'e eşlemesini sağlayacak ikinci bir
   `bookingId`-bağımlı sır) taşınması, sağlık verisi erişim kimlik bilgisinin üçüncü tarafta
   bulunma süresini/amacını daha da daraltırdı — ancak bu bir **iyileştirme önerisidir, bloklayıcı
   DEĞİLDİR**; mevcut tasarım zaten (a) tokenin backend↔Stripe arasında kalması (istemciye/loglara
   sızmaması) ve (b) 30 günlük TTL + 90 günlük veri saklama penceresiyle sınırlı olması nedeniyle
   KVKK açısından **kabul edilebilir bir risk** düzeyindedir.
4. **Sonuç: compliance-agent bu maddeyi VETO ETMİYOR.** md.11 açısından bloklayıcı bir sorun
   YOKTUR (erişim sürekliliği kod üzerinden doğrulandı). Madde 3'teki gözlem, security-agent'ın
   zaten yürüttüğü paralel denetime (webhook imza/idempotency, token TTL) bir KVKK-perspektifli
   EK girdi olarak sunulur; nihai karar security-agent/architect'e aittir.

#### Genel sonuç (son denetim)

| Konu | Durum |
|---|---|
| §9.7.5 madde 1-9 | Hepsi **GEÇTİ**, koda birebir uygulanmış |
| §9.7.5 madde 10 (magic-link rotasyonu) | **GÖZLEM** — bloklayıcı değil, md.11 ihlali yok, Stripe'a ham erişim kimlik bilgisi taşınması konusunda bağlayıcı olmayan minimizasyon önerisi security-agent'a iletildi |
| Kritik şart (`PRIVATE_UPLOAD_DIR` ayrı dizin/volume) | **DOĞRULANDI** |
| Bloklayıcı bulgu | **YOK** |

**ONAY — implementasyon TUR 2 ön-onayına UYGUNDUR. `feature/telehealth-booking-payments` bu
denetim açısından merge edilebilir.**

**Hukuki tavsiye notu (tekrar):** Bu bölüm de hukuki tavsiye DEĞİLDİR; nihai saklama süresi, rıza
metinlerinin hukuki içeriği ve üçüncü taraf (Stripe) veri paylaşımının nihai KVKK/GDPR uygunluğu
için gerçek bir hukuk danışmanına başvurulması ZORUNLUDUR.
