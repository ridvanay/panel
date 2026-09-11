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
