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

**GÜNCELLEME:** Kayıt özelliği artık talep edilmiştir. Bkz. dosya sonundaki **"TUR 3 — Görüşme
Kaydı (Recording/Egress) + S3/MinIO Arşivleme"** bölümü. Yukarıdaki KAPSAM DIŞI kararı, TUR 3'ün
bağlayıcı koşulları architect tarafından nihai plana işlenmeden ve db-agent/backend-agent bu
kararlara göre çalışmadan **geçerliliğini korur** — yani kod hâlâ "önce yazılmaz".

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

---

## TUR 3 — Görüşme Kaydı (Recording/Egress) + S3/MinIO Arşivleme — ÖN-DEĞERLENDİRME
## (compliance-agent ÖNCÜLÜĞÜNDE, ENGELLEYİCİ)

> Bağlam: [TCT] §4.4 madde 5 (satır ~556-559) bu özelliği **bağlayıcı** olarak KAPSAM DIŞI
> bırakmış ve "compliance-agent önderliğinde ayrı bir tur, kod önce YAZILMAZ" şartı koşmuştu
> (yukarıdaki "Kayıt (recording/Egress) yasağının yazılı teyidi" bölümü). Kullanıcı bu turun
> **compliance-agent ile başlamasını** seçti. Bu bölüm mimari/uyumluluk KARARLARINI verir —
> **kod yazılmamıştır**; architect bu kararları plana işleyip db-agent/backend-agent/
> frontend-agent'a devretmeden önce hiçbiri çalışmaya başlamaz.
>
> **Okunan/doğrulanan mevcut kod (spekülasyon değil):** `backend/prisma/schema.prisma`
> (`AppointmentIntake` satır 2205-2222 — `healthDataConsentAt`/`healthDataConsentVersion` NOT
> NULL rıza kanıtı deseni; `Appointment.consultationNoteCiphertext` satır 2105-2113; `AuditLog`
> satır 1556-1571 — tek, serbest-metin `action` alanlı genel tablo), `backend/src/lib/crypto.ts`
> (`encryptSecret`/`decryptSecret`, AES-256-GCM, `ENCRYPTION_KEY` 32 byte base64, hex
> `iv:authTag:ciphertext` formatı — küçük string'ler için), `backend/src/lib/
> telehealth-document-storage.ts` (özel depo: local disk VEYA S3/MinIO, `STORAGE_DRIVER=s3`,
> `PRIVATE_UPLOAD_DIR`/`S3_BUCKET`/`S3_ENDPOINT`/`S3_REGION`, public ACL/CDN YOK, opak
> `storagePath`, tek servis yolu audit'li uç), `backend/src/lib/intake-retention.ts` (90 gün,
> `MAX(endsAt)`'ten itibaren, günlük süpürücü, idempotent, dosya diskten/S3'ten SİLİNİR ama satır
> `deletedAt` ile KALIR), `backend/src/lib/audit.ts` (`logAudit`, "metadata'ya asla token/URL/
> şifre yazma" kuralı), `backend/src/modules/demo-templates/templates/telehealth-clinic.ts`
> (satır 739-762, `acik-riza-metni` sayfası, madde 4: "Görüntülü Görüşmenin Kaydedilmediğine
> İlişkin Beyan").

### Genel karar: **KOŞULLU ÖN-ONAY — kayıt özelliği teknik olarak mümkün, ancak aşağıdaki 7
maddenin TAMAMI bağlayıcıdır**

Bloklayıcı olan tek şey **rıza mekanizmasının (madde 1) architect'in planına AYNEN, gevşetilmeden
girmesidir.** Diğer maddeler netleştirme/karar niteliğindedir.

### 1) Rıza mekanizması (bağlayıcı, en kritik karar)

**(a) Ayrı bir açık rıza adımı ZORUNLU — randevu/rezervasyon onayına veya "Sağlık Verisi Paylaşım
İzni"ne (TUR 2) GÖMÜLEMEZ.** Kayıt, bambaşka bir işleme faaliyetidir (kalıcı ses+görüntü) ve KVKK
md.10 "her işleme amacı için ayrı, aydınlatılmış rıza" ilkesi gereği kendi başına bir onay adımı
gerektirir.

**(b) Rıza NE ZAMAN alınır — ÖNCEDEN (randevu alırken) DEĞİL, GERÇEK ZAMANLI (görüşme anında).**
Gerekçe: randevu alma anında hastanın "bu spesifik görüşme kaydedilecek mi" bilgisi yoktur (doktor
kaydı başlatıp başlatmayacağına o an karar verir); önceden alınan bir "genel kayıt izni" KVKK'nın
"belirli, bilgilendirilmiş" rıza şartını karşılamaz (blanket consent kabul edilemez). Akış:
1. Doktor odada "Kaydı Başlat" aksiyonuna basar → bu, Egress'i **DOĞRUDAN TETİKLEMEZ.**
2. Backend, o an için bir rıza-bekleme durumu oluşturur (aşağıdaki model, madde d) ve LiveKit
   data-channel/oda metadata'sı üzerinden hastanın istemcisine gerçek zamanlı bir istem gönderir:
   *"Doktorunuz bu görüşmeyi kaydetmek istiyor. Kabul ediyor musunuz?"* (Kabul Ediyorum /
   Reddediyorum, hiçbiri varsayılan olarak seçili DEĞİL).
3. Hasta **Kabul Ediyorum** derse → `patientConsentAt`/`patientConsentVersion` yazılır → backend
   BUNDAN SONRA Egress API'sini çağırır (Egress başlaması hastanın onayından ÖNCE ASLA
   tetiklenmez).
4. Doktorun kendi aksiyonu ("Kaydı Başlat" tıklaması) doktor tarafının rızası sayılır
   (`doctorConsentAt`/`doctorConsentVersion` aynı anda yazılır) — ama bu, hastanın rızasının
   YERİNE GEÇMEZ; ikisi de gereklidir (HER İKİ TARAFIN rızası, [TCT] madde 5).

**(c) Hasta REDDEDERSE:** Kayıt başlamaz (Egress hiç çağrılmaz). Doktora nötr bir bildirim
gösterilir ("Hasta kaydı onaylamadı, görüşme kayıtsız devam ediyor" — hastayı suçlayan/ısrarcı bir
dil KULLANILMAZ). Red, audit'e düşer (`telehealth.recording.consent_denied`) ama bu olay hastanın
aleyhine hiçbir şekilde KULLANILAMAZ/görüntülenemez (ör. doktor panelinde "bu hasta kaydı
reddetti" şeklinde bir geçmiş/etiket GÖSTERİLMEZ — yalnızca o oturuma özeldir). Doktor aynı
oturumda TEKRAR sorabilir (otomatik yeniden deneme YOK, elle yeniden tetiklenir) ama art arda
ısrarcı istemler (spam) ÖNERİLMEZ — frontend-agent'a bağlayıcı olmayan öneri: reddedilen bir
istekten sonra en az X saniye/yeni bir doktor aksiyonu olmadan otomatik tekrar istem GÖNDERİLMEMELİ.

**(d) Rıza kaydı — yeni model önerisi (db-agent'a, `AppointmentIntake` deseniyle TUTARLI ama
BİREBİR aynı DEĞİL):**

```
model ConsultationRecording {
  id                     String    @id @default(uuid())
  appointmentId          String    @unique   // her Appointment (tekil seans) en fazla 1 kayıt
  egressId               String?              // LiveKit Egress kimliği (webhook eşleme için)
  doctorConsentAt        DateTime?
  doctorConsentVersion   String?
  patientConsentAt       DateTime?            // NULL = henüz onaylanmadı; Egress'in
                                               // FİİLEN başlatılabilmesi için ZORUNLU ön koşul
  patientConsentVersion  String?
  patientConsentDeniedAt DateTime?            // hastanın açıkça REDDETTİĞİ an (kanıt)
  storagePath            String?              // opak S3/MinIO anahtarı, AppointmentDocument
                                               // .storagePath İLE AYNI disiplin — API'de ASLA dönmez
  startedAt              DateTime?
  endedAt                DateTime?
  durationSeconds         Int?
  fileSizeBytes           Int?
  deletedAt               DateTime?           // gerçek silme sonrası da SATIR kalır (audit bütünlüğü,
                                               // AppointmentDocument İLE AYNI)
  createdAt              DateTime  @default(now())
  updatedAt              DateTime  @updatedAt
  appointment            Appointment @relation(fields: [appointmentId], references: [id], onDelete: Cascade)
}
```

Not: `patientConsentAt` burada **NOT NULL değildir** (AppointmentIntake'ten farklı) çünkü satır,
rıza istemi GÖNDERİLDİĞİ anda (doktorun tıklamasıyla) zaten oluşturulmuş olabilir — asıl bağlayıcı
kural şema değil, **iş mantığı**dır: backend, Egress başlatma çağrısını `patientConsentAt IS NOT
NULL` olmadan **asla** yapmamalıdır (bu, backend-agent'a bağlayıcı bir kural olarak burada
verilir). `consentVersion` alanları TUR 2'nin "serbest string, enum değil, `v1`'den başlar"
disipliniyle AYNI kalmalıdır.

### 2) Şeffaflık UI (rozet) — YETERLİ DEĞİL, RIZA YERİNE GEÇMEZ

Ticket'ın istediği "Bu görüşme kaydedilmektedir" rozeti **gereklidir ama tek başına YETERSİZDİR.**
Rozet bir **bilgilendirme/durum göstergesidir** (KVKK m.10 şeffaflık ilkesinin bir parçası,
kaydın AKTİF OLDUĞU her an sürekli görünür olmalı — yalnızca başlangıçta bir kere gösterilip
kaybolan bir toast YETERLİ DEĞİLDİR), **madde 1'deki ayrı, gerçek-zamanlı onay adımının YERİNE
GEÇMEZ.** frontend-agent'a bağlayıcı gerekçe: rozet = "şu an ne olduğunu gösterme" (transparency),
onay modalı = "rıza toplama" (consent) — ikisi FARKLI KVKK yükümlülükleridir ve İKİSİ DE gereklidir.

### 3) Saklama/silme politikası

**Süre önerisi: son `endsAt`'ten (randevu/seansın bitişinden) itibaren 30 gün** — TUR 2'nin metin
notu (90 gün) ve TUR 1'in genel randevu PII'si (12 ay) hiyerarşisinden **kasıtlı olarak DAHA
KISADIR.** Gerekçe: ses+görüntü kaydı, yazılı bir nottan/belgeden DAHA ZENGİN bir özel nitelikli
veri kümesidir (yüz görüntüsü + ses + tıbbi içeriğin TAMAMI, birebir "oturdu gibi" yeniden
izlenebilir) — minimizasyon ilkesi burada en sıkı uygulanmalıdır. **Bu, projenin diğer
kararlarındaki (90 gün/12 ay) AYNI dürüstlük diliyle işaretlenmelidir: kesin süre için gerçek bir
hukuk danışmanına danışılması ZORUNLUDUR** — özellikle Türkiye'de sağlık kayıtlarına dair
sektörel mevzuatın (hasta dosyası saklama süreleri gibi) burada 30 günden ÇOK DAHA UZUN bir asgari
süre öngörmüş olma ihtimali vardır; bu, "veri minimizasyonu kısa tutmak ister" ile "sağlık mevzuatı
uzun tutmayı zorunlu kılabilir" arasında GERÇEK bir gerilim alanıdır ve bu proje bir hukuk
danışmanının karar vermesi gereken noktadır (compliance-agent burada salt mühendislik/varsayılan
bir süre öneriyor, nihai değil).

**Süpürücü:** `backend/src/lib/recording-retention.ts` — `intake-retention.ts` ile BİREBİR aynı
desen (günlük kadans, `MAX(endsAt)` bazlı cutoff, idempotent, dosyayı S3/MinIO'dan/diskten
GERÇEKTEN siler, `ConsultationRecording` satırı `deletedAt` ile KALIR).

**Hastanın silme talebi (KVKK md.11):** **EVET, hasta kendi kaydının silinmesini beklemeksizin
talep edebilir** — TUR 2'nin `DELETE .../intake` / `DELETE .../documents/{id}` deseniyle AYNI,
yeni bir `DELETE /appointments/{id}/recording` ucu önerilir, yalnızca randevunun hastası (veya
ADMIN) çağırabilir. **Doktorun TEK TARAFLI silme talebi FARKLI ele alınmalıdır:** doktorun "bu
kaydı sil" isteği hastanın md.11 hakkından KAYNAKLANMAZ (kayıt her iki tarafın ortak verisidir ama
"veri sahibi" birincil olarak hastadır) — doktorun silme isteği doğrudan/anında UYGULANMAMALI,
ADMIN onayından geçmelidir (kötüye kullanım riski: bir doktorun, olası bir şikayet/uyuşmazlık
kaydını sildirmeye çalışması). Bu, bağlayıcı bir öneri olarak backend-agent'a iletilir.

### 4) Erişim/denetim (audit) politikası

**Kim görüntüleyebilir/indirebilir:** TUR 2'nin `assertBookingHealthDataAccess` deseniyle AYNEN
tutarlı — **yalnızca o randevunun doktoru + ADMIN + randevunun hastasının kendisi**; MANAGER
içerikten HARİÇ, EDITOR hiç YOK, başka bir doktor 404 alır (varlık sızdırılmaz). Hasta kendi
kaydına erişebilmelidir (md.11 erişim hakkı) — bu, mevcut `GET .../documents/{id}/content`
ucunun aynısı bir `GET /appointments/{id}/recording` ucu olarak modellenebilir.

**Audit — AYRI bir "MedicalAuditLog" tablosu GEREKMEZ.** Mevcut proje deseni **tek, genel
`AuditLog` tablosunu** (`schema.prisma:1556-1571`, serbest-metin `action` alanı) TÜM
`telehealth.*` olayları için (intake/belge/epikriz erişimi dahil) zaten kullanıyor — yeni bir
tablo bu deseni KIRAR ve gerekçesizdir. Yeni action isimleri önerilir (migration GEREKTİRMEZ,
`action` zaten serbest metin): `telehealth.recording.consent_requested`,
`telehealth.recording.consent_granted`, `telehealth.recording.consent_denied`,
`telehealth.recording.started`, `telehealth.recording.stopped`,
`telehealth.recording.accessed`, `telehealth.recording.downloaded`,
`telehealth.recording.deleted`. `metadata` alanına **dosya adı/`storagePath`/videonun kendisi
ASLA yazılmaz** — yalnızca `appointmentId`, aktör, IP gibi opak tanımlayıcılar (mevcut
`audit.ts:19` kuralının doğal uzantısı). **İstisnai durum (ticket'ın "MedicalAuditLog" talebine
yanıt):** eğer gerçek bir hukuk danışmanı ileride "sağlık kaydı erişim logu, genel admin
audit'inden AYRI ve DEĞİŞTİRİLEMEZ (WORM/append-only) olmalı" derse, bu, mevcut `AuditLog`
tablosunun YETERSİZ kaldığı bir senaryodur ve o zaman db-agent'a AYRI bir talep olarak
açılabilir — ama **bu turda, bu ölçekte (şablon/demo platformu) gerekli/orantılı DEĞİLDİR.**

### 5) Şifreleme terminolojisi düzeltmesi (bağlayıcı, dürüstlük/pazarlama uyarısı)

**"E2EE (AES-256)" YANLIŞ bir terimdir — DÜZELTİLMELİDİR.** Sunucu tarafı (server-side) LiveKit
Egress, ham medya akışlarını alıp kompozit bir MP4 üretmek ZORUNDADIR — bu, TANIM GEREĞİ uçtan uca
şifreleme (E2EE) ile **BAĞDAŞMAZ** (E2EE'de sunucu hiçbir zaman düz metne erişemez; Egress bunun
tam tersini yapar). **Doğru ve tek kullanılabilecek terim: "sunucuda, aktarım sonrası, dosya
olarak saklanırken (at-rest) AES-256 şifreleme."** Bu ayrım architect/backend-agent/frontend-agent
için BAĞLAYICIDIR: hiçbir UI metninde, admin panelinde veya pazarlama içeriğinde **"uçtan uca
şifreli"/"E2EE"** ifadesi KULLANILAMAZ — bu, hastaya/kullanıcıya yanlış bir güvenlik vaadi vermek
olur (KVKK m.10 şeffaflık ilkesinin ihlali).

**Anahtar yönetimi (compliance-agent'ın onayı gereken kısım — nihai mekanizma security-agent'a
aittir):** Mevcut `lib/crypto.ts::encryptSecret`/`decryptSecret` (hex string, `iv:authTag:
ciphertext` formatı) **büyük binary dosyalar için UYGUN DEĞİLDİR** (tüm dosyayı belleğe alıp
hex'e çeviren bir tasarımdır — bir video için bellek/CPU maliyeti kabul edilemez). Bu nedenle
**yeni, binary-güvenli bir AES-256-GCM yardımcı fonksiyonu (stream veya buffer bazlı,
hex-DÖNÜŞTÜRMEYEN) yazılmalıdır** — ama **compliance-agent'ın şartı, bunun AYNI `ENCRYPTION_KEY`
ana anahtar disiplinini (env'den, 32 byte base64, `openssl rand -base64 32`) izlemesidir**, YENİ
bir anahtar yönetimi mekanizması icat EDİLMEMELİDİR (tutarlılık + operasyonel basitlik). **Ek
öneri (bağlayıcı değil, security-agent'a girdi):** eğer key-separation (blast-radius azaltma)
isteniyorsa, `ENCRYPTION_KEY`'den HKDF ile türetilmiş AYRI bir alt-anahtar (`recording` bağlamlı)
kullanılabilir — ama bu bir security-agent kararıdır, compliance-agent yalnızca "AES-256 at-rest,
tutarlı anahtar disiplini" şartını koyar. **Ayrıca:** S3/MinIO'nun kendi sunucu-taraflı şifrelemesi
(SSE, `S3_ENDPOINT` MinIO ise veya AWS S3 SSE-S3) bu uygulama-seviyesi şifrelemenin YERİNE
GEÇMEZ — ikisi birlikte (uygulama önce şifreler, depolama sağlayıcı yalnızca ŞİFRELİ baytları
görür) tercih edilir; bu, madde 7'deki yurt dışı aktarım riskini de AZALTIR (bkz. aşağıda).

**Yurt dışına veri aktarımı riski (bağlayıcı uyarı):** `telehealth-document-storage.ts` zaten
`STORAGE_DRIVER=s3` ile AWS S3'ü destekliyor; eğer işletme AWS'nin ABD bölgesini (`S3_REGION`
varsayılanı `us-east-1`) kullanırsa bu, KVKK md.9 kapsamında **yurt dışına veri aktarımıdır** ve
özel nitelikli veri (sağlık kaydı) için EK bir gerekçe/güvence gerektirir. **Öneri:** admin
panelinde/`.env.example`'da açık bir uyarı ("Kayıt dosyaları için `S3_REGION` seçerken yurt
dışına veri aktarımı kurallarına dikkat edin; mümkünse yurt içi/AB bölgesi veya self-hosted
MinIO tercih edin") — bu, cross-border aktarım riskini ORTADAN KALDIRMAZ ama işletmeye görünür
kılar; nihai uygunluk yine hukuk danışmanı kararıdır.

### 6) Demo şablonu güncellemesi

`backend/src/modules/demo-templates/templates/telehealth-clinic.ts:760`'taki **"Görüntülü
Görüşmenin Kaydedilmediğine İlişkin Beyan"** başlığı, kayıt özelliği kod tabanına eklendiği ANDAN
İTİBAREN **YANLIŞ/yanıltıcı** olur (özellik var ama kapalı olsa bile, bir "beyan" artık mutlak bir
gerçek değil, KOŞULLU bir durumu tarif etmelidir). **Öneri: başlık
`"Görüşme Kaydı Politikası ve Rızası"` ile DEĞİŞTİRİLMELİDİR** ve `buildLegalPageBlocks`'un ürettiği
(şu an salt başlık olan, gövdesiz) YER TUTUCU bölüm, madde 7'deki varsayılan-kapalı bayrağa göre
**koşullu** iki gövdeyi tarif edecek şekilde genişletilmelidir (nihai gövde metni yine
`LEGAL_PLACEHOLDER_NOTICE` ile işaretli bir taslak olacaktır, gerçek hukuki metin DEĞİL):
- **Kayıt özelliği KAPALIYSA** (varsayılan): mevcut ruhu koru — "Bu platformda görüntülü
  görüşmeler varsayılan olarak kaydedilmez."
- **Kayıt özelliği o randevu/doktor için AÇIKSA:** "Doktorunuz görüşmeyi kaydetmek isteyebilir; bu
  yalnızca SİZİN görüşme sırasında ayrıca vereceğiniz açık rızanızla gerçekleşir, reddetme
  hakkınız vardır, kayıt [N] gün sonra silinir, yalnızca doktorunuz ve siz erişebilirsiniz."
Bu, architect'in planına EKLENMESİ gereken bir içerik/metin değişikliği görevidir (madde
numaralandırması `buildLegalPageBlocks("th-acik-riza", [...])` dizisinde 4. eleman olarak KALIR,
yalnızca metni değişir).

### 7) Ölçek/kapsam sınırlaması önerisi

**Öneri: özellik varsayılan olarak KAPALI gelmelidir** — bir ayar bayrağı (ör.
`TelehealthSettings.recordingEnabled Boolean @default(false)`, mevcut proje "yeni davranış
varsayılan kapalı" disipliniyle tutarlı — `LIVEKIT_URL` boş varsayılanıyla AYNI felsefe, [TCT]
§4.4 madde 2). Admin panelinde bu bayrağı AÇMAYA çalışan bir yönetici, TUR 1/TUR 2'deki
`LEGAL_PLACEHOLDER_NOTICE` diliyle TUTARLI bir uyarı GÖRMELİDİR: *"Görüşme kaydı özel nitelikli
sağlık verisi (ses+görüntü) oluşturur ve kalıcılaştırır. Bu özelliği etkinleştirmeden önce KVKK/
GDPR uyumluluğu için gerçek bir hukuk danışmanına danışmanız ÖNEMLE ÖNERİLİR. Ayrıntı:
`.claude/compliance-notes-telehealth.md` (TUR 3)."* Bu, projenin bir şablon/demo platformu mu
yoksa gerçek üretim mi olduğu belirsizliğini AZALTMAZ ama riski görünür ve işletmenin kendi
kararına bağlı kılar — [TCT]'nin ve bu dosyanın tekrar eden "nihai karar hukuk danışmanınındır"
ilkesiyle birebir tutarlıdır.

### Özet tablo (TUR 3)

| # | Konu | Karar |
|---|---|---|
| 1 | Rıza mekanizması | Ayrı, gerçek-zamanlı, iki taraflı (hasta+doktor) onay; Egress hastanın onayından ÖNCE tetiklenemez; red = kayıt yok, nötr bildirim, audit'e düşer ama hasta aleyhine kullanılamaz |
| 2 | Şeffaflık rozeti | Gerekli ama YETERSİZ — rızanın YERİNE GEÇMEZ, sürekli görünür olmalı |
| 3 | Saklama/silme | 30 gün öneri (son `endsAt`'ten), günlük süpürücü, hasta beklemeden silebilir, doktorun tek taraflı silme isteği ADMIN onayına tabi |
| 4 | Erişim/audit | Hasta+randevu doktoru+ADMIN (MANAGER/EDITOR hariç, mevcut desen); AYRI "MedicalAuditLog" tablosu GEREKMEZ, mevcut `AuditLog` + yeni `telehealth.recording.*` action'lar yeterli |
| 5 | Şifreleme terimi | "E2EE" YANLIŞ, DÜZELTİLMELİ → "sunucuda at-rest AES-256"; aynı `ENCRYPTION_KEY` disiplini, yeni binary-güvenli yardımcı fonksiyon; yurt dışı aktarım riski (AWS US region) işaretlendi |
| 6 | Demo şablonu | `telehealth-clinic.ts:760` başlığı `"Görüşme Kaydı Politikası ve Rızası"` olarak değişmeli, koşullu (açık/kapalı) gövde |
| 7 | Kapsam sınırlaması | Varsayılan KAPALI bayrak + admin panelinde hukuk danışmanı uyarısı |

**Bloklayıcı madde:** Madde 1'in (rıza mekanizması) architect'in planına gevşetilmeden
girmesi **ENGELLEYİCİDİR** — bunsuz db-agent/backend-agent bu özelliğe başlayamaz. Diğer
maddeler netleştirme niteliğindedir, mimariye göre küçük ayarlamalar architect'in takdirindedir.

**Hukuki tavsiye notu (tekrar, TUR 1/TUR 2 ile AYNI ilke):** Bu bölüm hukuki tavsiye DEĞİLDİR;
özellikle (a) 30 günlük saklama süresi (sağlık kaydı saklama süresine dair sektörel asgari
mevzuat ihtimali nedeniyle BURADA gerilim YÜKSEKTİR), (b) rıza metinlerinin nihai hukuki içeriği,
(c) yurt dışına veri aktarımının nihai uygunluğu için gerçek bir hukuk danışmanına başvurulması
**ZORUNLUDUR.**

---

## NİHAİ DENETİM: 2026-09-13 — TUR 3 kararlarının koda yansıması doğrulandı (spekülasyon değil)

> Bu, kod YAZILDIKTAN SONRA yapılan bağımsız bir doğrulama turudur (architect'in planı → db-agent/
> backend-agent/integration-agent/frontend-agent'ın implementasyonu → bu denetim). Aşağıdaki 7
> madde, gerçek dosyalar okunarak (spekülasyon yapılmadan) tek tek karşılaştırıldı.

| # | Madde | Sonuç | Kanıt |
|---|---|---|---|
| 1 | Rıza mekanizması (gerçek zamanlı, hasta ön koşulu, red kaydı) | **PASS** | `schema.prisma:2273-2321` (`ConsultationRecording`: `doctorConsentAt/Version`, `patientConsentAt/Version`, `patientConsentDeniedAt`, `RecordingStatus.PENDING_CONSENT/CONSENT_DENIED`). `telehealth.recording.routes.ts:187-202` (`/start` yalnızca `PENDING_CONSENT` satırı yazar, Egress'e HİÇ dokunmaz), `:259-296` (`/consent` — `granted:false` → `CONSENT_DENIED` + `patientConsentDeniedAt`, audit `consent_denied`; `granted:true` → ÖNCE `updateMany({patientConsentAt})` `count===1` doğrulanır, `startRoomCompositeRecording` SADECE bundan SONRA, satır 310, çağrılır). Randevu onayına gömülü DEĞİL — ayrı uçlar (`/recording/start`, `/recording/consent`). |
| 2 | Şeffaflık rozeti (sürekli, toast değil) | **PASS** | `recording-indicator.tsx:10-11` (`status !== "RECORDING"` ise `null`, aksi hâlde kalıcı `Badge`, otomatik kapanma/timeout YOK); `consultation-room.tsx:534` render ağacında sürekli bağlı, gerçek zamanlı sinyal (`:463`, `topic === "telehealth.recording"`) ile state güncellendikçe otomatik kaybolur/görünür — kaybolan bir toast DEĞİL. |
| 3 | Saklama/silme (30 gün, `endsAt`, hasta-only silme) | **PASS** | `recording-retention.ts:23,38,41` (`RECORDING_RETENTION_MS=30 gün`, cutoff `appointment.endsAt`'ten, günlük kadans, idempotent). `telehealth.recording-access.routes.ts:196-198` (`DELETE .../recording` → `assertBookingPatientOrAdminAccess`, doktor YOK); `telehealth-access.ts:96-100` fonksiyonu doğrulandı — yalnızca hasta veya ADMIN. |
| 4 | Erişim/audit (hasta+doktor+ADMIN, action isimleri, PII'siz metadata) | **PASS** | `telehealth-access.ts:84-89` (`assertBookingHealthDataAccess` — ADMIN/doktor/hasta, MANAGER/EDITOR YOK). Audit action'ları `telehealth.recording.consent_requested/consent_denied/consent_granted/started/stopped/accessed/downloaded/deleted` — hepsi `telehealth.recording.routes.ts` ve `telehealth.recording-access.routes.ts` içinde BİREBİR bu isimlerle bulundu. `metadata` alanları yalnızca `recordingId`/`appointmentId`/`viaAdmin`/`reason` — `storagePath`/dosya adı/URL YOK (`recording-access.routes.ts:154,216`). |
| 5 | Şifreleme terminolojisi (E2EE sıfır, demo düzeltmesi) | **PASS** | `binary-crypto.ts:13-14` — "BU E2EE (uçtan uca şifreleme) DEĞİLDİR" açık negatif beyanı mevcut. Repo geneli grep: backend/frontend `src` altında `E2EE`/`uçtan uca` yalnızca bu negatif beyanlarda + ilgisiz bir mimarlık şablonu cümlesinde (`modern-architecture.ts:273`, şifrelemeyle alakasız) geçiyor — sıfır yanlış kullanım. `telehealth-clinic.ts:187` artık "Görüntülü konsültasyonlar şifreli bağlantı üzerinden yapılır" (uçtan uca iddiası YOK). |
| 6 | Demo şablonu (satır ~187, ~760) | **PASS** | `telehealth-clinic.ts:187` düzeltildi (madde 5'te kanıtlandı); `telehealth-clinic.ts:760` başlık `"Görüşme Kaydı Politikası ve Rızası"` olarak değişmiş. |
| 7 | Kapsam sınırlaması (varsayılan kapalı + admin uyarısı) | **PASS** | `module-registry.ts:56,64` (`key: "telehealth-recording"`, `defaultEnabled: false`, kod yorumunda TUR 3 madde 7 referansı). `admin/modules/page.tsx:34-36,90-96,178-191` — `telehealth-recording` AÇILIRKEN (`enabled===true`) `handleToggle` DOĞRUDAN çağrılmıyor, önce `RECORDING_MODULE_WARNING` metniyle onay dialogu açılıyor, yalnızca `onConfirm`'de gerçek toggle tetikleniyor; metin TUR 3 §7'nin önerdiği metinle esasen aynı (yalnızca sonundaki "Ayrıntı: ..." referans cümlesi eksik, bağlayıcı değil). |

**Sonuç: 7/7 PASS — bloklayıcı bulgu YOK.**

**Ek bulgu (bloklayıcı DEĞİL, ama kayda geçirilmeli — dürüstlük/izlenebilirlik notu):**
`recording-consent-dialog.tsx:12-13` ve `admin/modules/page.tsx:29-33` kod yorumları, metinlerin
`.claude/architect-scope-telehealth-recording.md` adlı bir belgeden geldiğini ve "compliance-
agent'ın bağlayıcı kararı, AYNEN kullanılır" olduğunu iddia ediyor — **bu dosya repoda
mevcut değil** (`.claude/` dizininde arandı, bulunamadı). Hasta rıza modalının `CONSENT_TEXT`'i
(`recording-consent-dialog.tsx:22`: *"Doktorunuz bu görüşmeyi kaydetmek istiyor. Kayıt sunucuda
AES-256 ile şifrelenerek saklanır, 30 gün sonra otomatik silinir ve yalnızca siz, doktorunuz ve
sistem yöneticisi erişebilir. Reddetme hakkınız vardır; reddetmeniz görüşmeyi etkilemez."*) bu
dosyanın TUR 3 §1(b)'sinde yalnızca ÖRNEK/illüstratif olarak verilen kısa istem cümlesiyle
("Doktorunuz bu görüşmeyi kaydetmek istiyor. Kabul ediyor musunuz?") birebir AYNI DEĞİLDİR —
architect/frontend-agent bunu KENDİLİĞİNDEN genişletmiş görünüyor. **İçerik denetimi:** genişletilmiş
metin madde 1/3/4/5 kararlarının TAMAMIYLA TUTARLIDIR (doğru terim "sunucuda AES-256", doğru süre
"30 gün", doğru erişim kümesi "siz, doktorunuz, sistem yöneticisi" = hasta+doktor+ADMIN, reddin
görüşmeyi etkilemediği doğru) — KVKK açısından bir ihlal YOKTUR, metin aslında ÖRNEK cümleden DAHA
İYİ/daha şeffaftır (m.10 açısından daha bilgilendirici). **Bu nedenle bloklayıcı değildir ve bu
denetimle birlikte metin compliance-agent tarafından NİHAİ olarak onaylanır** — ama var olmayan bir
belgeye atıf yapan kod yorumu YANILTICIDIR; documentation-agent/architect'e, ya gerçek bir
`architect-scope-telehealth-recording.md` dosyasının oluşturulması ya da yorumların
`compliance-notes-telehealth.md` (TUR 3) + bu nihai denetim notuna işaret edecek şekilde
düzeltilmesi ÖNERİLİR (bloklayıcı değil, iz sürülebilirlik/dürüstlük için).

**qa-agent'a geçiş:** Yukarıdaki 7/7 PASS ile `telehealth-recording` özelliği fonksiyonel/uyumluluk
denetiminden geçmiştir; qa-agent e2e test kapsamına şunları eklemelidir (bağlayıcı olmayan öneri):
rıza reddi akışı (Egress'in HİÇ çağrılmadığının doğrulanması), rıza TTL dolumu, hasta-only silme
(doktorun 403/404 alması), private storage sızıntı testi (madde 4/5 deseniyle AYNI, TUR 2 emsali).
