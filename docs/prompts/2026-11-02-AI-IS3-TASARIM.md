# Paket AI, İş 3: Hizmet bazlı online ön görüşme — TASARIM RAPORU (2026-11-02)

> Durum: **yalnızca tasarım.** Kod yazılmadı, kod dosyası değişmedi. Kullanıcı onayından sonra uygulanır.
> Kaynak talimat: `docs/prompts/2026-11-02-AI-hizmet-menusu-randevu-bulucu.md` (İş 3 ve kırmızı çizgiler).
> Bağlam: AH Faz 1 raporu, AG raporu, AG İş 3 tasarımı (§12 kullanıcı kararları dahil) ve `feat/ag-specialty-notify-meeting-nov02` dalındaki yarım AG İş 3 kodu (`f5b6efa`).
> **Bağlayıcı kullanıcı kararı (2026-11-02):** Görüşme, AG İş 3'ün `meet_` odaları, token üreticisi (`lib/meeting-livekit.ts`) ve `meeting-room` / `meeting-stage` bileşenleri üzerinden kurulur. Koordinatör ev sahibidir (host), hasta katılımcıdır. AI İş 3'ün kodlaması, AG İş 3 güncel master'a alınıp tamamlandıktan **sonra** başlar.

## 0. Özet

- **Model:** Seçilen hizmet için **ücretsiz online ön görüşme**. Görüşmeyi doktor değil, WM Health **hasta koordinatörü** yapar. Ödeme yok; ücretli seçenek hizmet masası düzeyinde bir bayrakla tasarlanır ve bu turda kapalı kalır (API `true` değerini reddeder).
- **Veri modeli (yalnızca ekleme):**
  - Yeni tablolar: `ServiceDesk` (hizmet masası), `ServiceDeskHours`, `ServiceDeskSpecialty`, `CoordinatorProfile`, `ServiceDeskMember`, `CoordinatorTimeOff` ve `ServiceConsultation` (hizmet randevusu).
  - `ServiceConsultation` bir **`ExternalMeeting`'e 1:1 bağlanır** (oda, misafir bağlantısı, zaman penceresi ve süpürücü AG'den gelir). Kişisel veri ve rızalar AH'nin **`ConsultationRequest` + `CrmLead`** kaydında tutulur (şifreleme, saklama süresi ve CRM akışı AH'den hazır gelir).
  - Mevcut `Appointment` / `AppointmentBooking` kullanılmaz; gerekçe §2.1'de.
- **Koordinatör:** Yeni `SiteRole` yok. Koordinatör, AG'nin `canHostMeetings` yetkisine sahip bir panel kullanıcısıdır ve bir `CoordinatorProfile`'ı vardır (görünen ad, diller, saat dilimi). Hizmet masalarına `ServiceDeskMember` ile atanır. Doktor profili olan kullanıcı koordinatör olamaz; bu yüzden etikette unvan çıkmaz.
- **Slot üretimi:** Mevcut saf `generateAvailableSlots` fonksiyonu (`availability.ts:88`) masanın haftalık saatleri ve saat dilimiyle çalıştırılır. Ardından slot başına "uygun koordinatör var mı" hesabı yapılır: hizmet randevuları, koordinatörün diğer AG toplantıları ve izinleri çakışma sayılır. Hasta yalnızca saati seçer; koordinatör sunucuda Serializable işlem içinde **otomatik atanır**.
- **Görüşme:**
  - Koordinatör, AG ev sahibi ucuyla (`POST /meetings/:id/host-token`) odaya girer.
  - Misafir hasta, e-postayla gelen AG misafir bağlantısıyla (`/{lang}/meet/join#mg_…`) girer.
  - Hesaplı hasta, portaldaki "Join" düğmesiyle girer. Bu düğme, AG'nin misafir kabul mantığını paylaşan yeni ve oturumlu bir uca gider.
  - Ad etiketi: `Patient Coordinator · Ayşe K.`. Kayıt yok.
- **Kırmızı çizgi:**
  - `consultation-room.tsx`, `telehealth.livekit.routes.ts` (doktor meeting-token ucu), `lib/livekit.ts` ve tüm `room_` kuralları **değişmez. İstisna gerekmez** (§6).
  - compose, Dockerfile'lar, Nginx, `.env`, LiveKit sunucu ayarları ve `docs/legal/` değişmez.
  - Yeni npm paketi yok. Migration yalnızca ekleme yapar.
- **Bağımlılık:** AG İş 3 master'a alınırken §6.4'teki küçük ek uyarlamalar (hizmete bağlı toplantıların korunması, ev sahibi adı, ortak misafir kabul fonksiyonu) AG koduna eklenir. Bunlar AG'nin kendi kurallarını gevşetmez.
- **Büyüklük:** AG İş 3 tamamlandıktan sonra yaklaşık **7–8 iş günü** (§13).

---

## 1. Mevcut altyapıdan neler yeniden kullanılır?

### 1.1 Slot, takvim ve randevu (backend, master)

| Parça | Yer | Kullanım |
|---|---|---|
| Saf slot üretimi | `backend/src/modules/telehealth/lib/availability.ts:88` `generateAvailableSlots`, `:134` `isBookableSlotStart` | **Aynen.** `DoctorAvailabilityRule` arayüzü (`:9-14`) yalnızca `dayOfWeek/startMinute/endMinute/isActive` ister; `ServiceDeskHours` satırları buna birebir uyar. DST kuralı (`:83-86`) miras alınır. `bookedStartTimesMs` boş verilir; doluluk koordinatör bazında ayrıca hesaplanır (§4). |
| Saat dilimi yardımcıları | `lib/timezone.ts:50` `getWallClockParts`, `:95` `getStartOfCalendarDayInTimeZone`, `:123` `wallTimeToUtc` | Aynen. |
| Haftalık kural doğrulama | `lib/weekly-availability.ts:22` `normalizeWeeklyRules`, `:38` `findWeeklyOverlaps` (saf) | Masa saatleri admin ucunda aynen kullanılır. `replaceWeeklyAvailability` (`:52`) doktor tablosuna yazdığı için **kullanılmaz**; masa için aynı desende ayrı bir yazıcı yazılır. |
| Çakışma ve izin | `lib/time-off.ts:72` `overlaps`, `:77` `subtractTimeOff`, `:18` izin türleri | Koordinatör izni (`CoordinatorTimeOff`) aynı türlerle ve aynı fonksiyonlarla işlenir. |
| Arama ufku | `lib/earliest-availability.ts:12` `EARLIEST_WINDOW_DAYS = 30` | Masa varsayılanı `horizonDays = 30`. |
| Çifte rezervasyon disiplini | `lib/booking.ts:171` `runSerializable`, `:209-211` "kısmi rezervasyon yok", `:311-319` P2002/P2034 → `SlotTakenError` | Aynı desen. Kısmi tekil indeks (§2.3) DB düzeyinde ikinci savunma hattıdır. |
| Okunabilir numara | `lib/booking.ts:79` `generateBookingNumber` | Desen olarak. Hizmet randevusu numarası `SVC-` + 5 haneli `seq` olur (AH'deki `REQ-` biçimiyle aynı). |
| Doktor hesabıyla hasta randevusu yasağı | `telehealth.routes.ts:552-563` | Aynı kural: doktor profilli kullanıcı hizmet randevusu alamaz (403). |
| Ücretsiz seans yolu | `telehealth.routes.ts:608-623` (`totalCents === 0` → anında onay) | **Kullanılmaz.** Bu yol `confirmBookingPayment` ve `provisionPatientAccountForBooking` (`patient-account.ts:26`) zincirine bağlı ve doktor booking'ine özgü. Ücretli seçenek ileride açılırsa bu desen örnek alınır (§5.5). |
| Misafir hesap provizyonu | `lib/patient-account.ts:26-60` | **Bu turda kullanılmaz** (veri minimizasyonu). Gerekçe §5.3, açık soru S6. |
| Hatırlatma süpürücüsü | `src/lib/appointment-reminders.ts:8-9` (bantlar), `:29` (5 dk aralık), `:43-44`, `:79-121` ("önce sahiplen, sonra gönder"), `:163` kayıt | Aynı desende **ayrı bir süpürücü** yazılır (`service-consultation-reminders.ts`). Mevcut süpürücü yalnızca `appointment` tablosunu tarar; ona dokunulmaz. |
| Bağlantının yenilenerek yeniden gönderimi | `modules/telehealth/lib/notifications.ts:399-418` `resendBookingAccessLink` (her çağrı yeni belirteç üretir, yalnızca kayıtlı adrese gönderir) | Hizmet randevusunda "bağlantıyı yeniden gönder" ve 60 dk hatırlatması aynı ilkeyle çalışır (§9). |
| Hasta e-posta dili | `notifications.ts:94` `patientEmailLocale`, `src/lib/branded-email.ts:32` `toCustomerEmailLocale` (tr→en) | Aynen. |
| Otomatik kapanış fikri | `src/lib/appointment-auto-close.ts:31-37` (`start_evidence` / `no_start_evidence`) | Desen olarak. Görüşme bitince sonuç (yapıldı veya gelmedi) AG kayıtlarından türetilir (§3.6). |

### 1.2 Talep formu, CRM ve admin bildirimi (AH ve AG, master)

| Parça | Yer | Kullanım |
|---|---|---|
| Talep gövdesi, rıza kuralları, honeypot | `modules/consultation-requests/consultation-requests.routes.ts:44-87` (Zod), `:26-28` (rıza metni sürümü), `:76-84` (iletişim rızası zorunlu; mesaj varsa sağlık verisi rızası zorunlu), `:118` (honeypot) | Rezervasyon gövdesi bu şemayı **genişletir**: alanlar ve kurallar aynı kalır, `startsAt`, `patientTimeZone` ve `locale` eklenir. |
| `ConsultationRequest` + `CrmLead` | `schema.prisma:4215-4250`, routes `:153-190` (aynı işlemde lead + talep, mesaj AES-256-GCM ile şifreli) | Her hizmet randevusu bir `ConsultationRequest` satırı da açar. Kişisel veri, rızalar ve mesaj **yalnızca orada** tutulur; saklama ve anonimleştirme AH kuralıyla işler. |
| Admin bildirim altyapısı | `modules/telehealth/lib/admin-booking-notifications.ts:24-31` (olay türleri), `:55` `bookingEventKey`, `:273` `notifyAdminsOfBookingEvent`, `:351` süpürücü; AH emsali `consultation_request` (bilgi `payload`'da) | Yeni olay türleri `service_consultation_booked`, `…_cancelled`, `…_rescheduled` ve `…_reassigned`. Bilgi `payload: { serviceConsultationId }` içinde taşınır. **`admin_notifications` tablosu değişmez.** |
| Müşteri onay e-postası deseni | `consultation-request-email.ts:99-162` (8 dil sözlüğü + `renderBrandedEmail`) | Hizmet randevusu e-postaları aynı desenle yazılır (§9). |

### 1.3 Görüşme altyapısı — AG İş 3 (`f5b6efa`, yarım)

| Parça | Yer (`git show f5b6efa:<dosya>`) | Kullanım |
|---|---|---|
| Veri | `backend/prisma/migrations/20261112090000_external_meetings/migration.sql`; `ExternalMeeting` (`roomName` `meet_…`, `guestTokenHash`, `autoAdmitGuests`, `hostJoinedAt`, `maxParticipants`, `status`, `closedAt`) ve `ExternalMeetingGuest` | Her hizmet randevusu için bir `ExternalMeeting` açılır (§2.2). **Bu tabloya kolon eklenmez.** |
| Token üretici | `backend/src/modules/telehealth/lib/meeting-livekit.ts:20-44` (önekler, kimlikler), `:60` `ensureMeetingRoom`, `:72` TTL (`endsAt` + 10 dk ek süre, tavanı `LIVEKIT_TOKEN_TTL_MIN`), `:105` `createMeetingHostToken` (kamera, mikrofon, ekran paylaşımı), `:123` `createMeetingGuestToken` (yalnızca kamera ve mikrofon), `:167` `kickAllMeetingParticipants` | Aynen. Koordinatör `meet-host:<userId>`, hasta `meet-guest:<guestId>` olur. `roomAdmin` ve `roomRecord` verilmez; `canUpdateOwnMetadata` false. |
| Ev sahibi ucu | `meetings.routes.ts:297-337` `POST /meetings/:id/host-token` (503 → yetki → kendi toplantısı → pencere → oda → token → `hostJoinedAt` → audit) | Koordinatör bu uçla girer. Görünen ad için küçük bir ek gerekir (§6.4-4). |
| Ev sahibi yetkisi | `backend/src/lib/meeting-host.ts` `isMeetingHostEligible` (panel rolü veya doktor), `canHostMeetings`; `meetings.service.ts:106` `requireMeetingHost` (her istekte DB'den taze okuma, 2FA istenmez — S2) | Koordinatör ataması bu yetkiyi ön koşul sayar (§3). |
| Misafir uçları | `meetings.guest.routes.ts:44-64` `resolveMeeting` (aynı 404, sabit zamanlı karşılaştırma), `:67-85` preflight, `:87-182` join (pencere → oturum `gs_v1` → bekleme kapısı → kapasite → token → audit, ad ve IP audit'e yazılmaz) | Misafir hasta aynen kullanır. Hesaplı hasta için adım 3–7 ortak bir fonksiyona çıkarılır (§6.4-5). |
| Belirteçler | `meeting-tokens.ts:16` `mg_` biçimi, `:31` üretim (yalnızca SHA-256 özeti saklanır), `:44` `buildGuestLink` (belirteç `#` parçasında), `:54-61` `gs_v1` oturumu (HKDF "meeting-guest-v1") | Aynen. Rezervasyon anında bağlantı üretilir ve **yalnızca o an** e-postaya konur. Bu, AG S5 ilkesiyle aynıdır. |
| İptal ve süpürücü | `meetings.service.ts:158` `cancelMeeting` (belirteç iptali, atma, audit); `lib/meeting-sweeper.ts` (yalnızca `meet_` odaları; bitiş + 10 dk) | Hizmet randevusu iptali bu fonksiyonu çağırır. Oda kapanışını süpürücü sağlar. |
| Frontend oda | `frontend/src/components/site/meeting/meeting-room.tsx:35-43, 108` (`mode: host / guest`, `fetchToken`, `endsAt`, `onExit`), `meeting-stage.tsx:28` (ızgara), `host-meeting-room.tsx:31, 94`, `guest-join-flow.tsx:32` (parçayı okur ve adres çubuğundan siler), `:105`, `:320`; `meeting-guest-control-bar.tsx` (ekran paylaşımı yok) | Koordinatör `HostMeetingRoom` kullanır. Misafir hasta `GuestJoinFlow` kullanır. Hesaplı hasta, `GuestJoinFlow`'un enjekte edilebilir katılım fonksiyonlu hâlini kullanır (§6.4-7). |
| Ad etiketi | `frontend/src/components/site/telehealth/room/participant-label.ts:44` (bilinen önekler), `:111` (bilinmeyen rolde etiket token `name`'inden gelir, identity asla gösterilmez) | `meet-host:` ve `meet-guest:` "unknown" roldür, etiket token adından gelir. Böylece `participant-label.ts` **değişmez**; "Patient Coordinator · Ayşe K." sunucuda token adına yazılır (§6.3). |

### 1.4 Doktor görüşme altyapısı — DEĞİŞMEZ, KULLANILMAZ

| Parça | Yer | Neden kullanılmıyor |
|---|---|---|
| Doktor meeting-token ucu | `telehealth.livekit.routes.ts:60-85` (erişim: hasta, doktor veya `?t=`; Paket E), `:93-207` | Randevu ve doktor kimliğine (`doctor:` / `patient:`) bağlı. Ödeme şartı var (`:152`). Dokunulmaz. |
| Token grant'ı | `lib/livekit.ts:117-153` `createMeetingToken` | Dokunulmaz. AG üreticisi ayrı dosyada. |
| Oda bileşeni | `frontend/src/components/site/telehealth/consultation-room.tsx:628` (`isDoctor` = `doctorProfileId` eşleşmesi), `:688` (`requestMeetingToken(appointment.id)`), `:581-610` (kayıt sinyali ve kontrolleri) | Randevu, doktor ve kayıt kavramlarına bağlı. Dokunulmaz. |
| 1:1 sahne | `room/stage.tsx:194-268` `ConsultationStage` (`appointmentId`, `InterpreterPresence`) | AG `meeting-stage.tsx` kullanılır. |
| Tercüman (Paket AA) | `schema.prisma:3802-3870` (`AppointmentInterpreter` ve `InterpreterRequest` → `bookingId` FK), `lib/interpreters.ts:92`, `lib/livekit.ts:220` `createInterpreterToken` (yalnızca `room_` booking odası) | Atama tablosu `AppointmentBooking`'e bağlı. Hizmet randevusunda tercüman bu turda **kayıt ve yönlendirme** düzeyinde kalır; odaya canlı tercüman katılımı Faz B'ye bırakılır (§5.4, S4). |

---

## 2. Veri modeli (migration yalnızca ekleme)

### 2.1 Karar: mevcut `Appointment` değil, ayrı `ServiceConsultation` + `ExternalMeeting`

| Seçenek | Değerlendirme |
|---|---|
| **A. Mevcut `Appointment` / `AppointmentBooking`'e bağlanmak** | **Reddedildi.** `Appointment.doctorId` NOT NULL (`schema.prisma:2535`) ve `@@unique([doctorId, startsAt])` (`:2603`); `AppointmentBooking.doctorId` da NOT NULL (`:2644`). Doktorsuz randevu için `DROP NOT NULL` gerekir; bu "yalnızca ekleme" kuralını aşar. Ayrıca booking ödeme alanları, kimlik bloğu (TCKN/pasaport, `:2654-2690`), doktor kazancı, analitik, hatırlatma ve otomatik kapanış gibi tüm doktor merkezli sorgulara sızar. "Sahte koordinatör doktor profili" ise AH'nin "sitede doktor yok" kuralını ve `consultation-room.tsx` korumasını bozar. |
| **B. Yalnızca `ExternalMeeting`** | **Yetersiz.** Hizmet, masa, koordinatör ataması, slot tekilliği, hasta bağı, rıza ve sonuç alanları yok. Bunları AG tablosuna eklemek AG'nin genel toplantı alanını hizmet kavramıyla kirletir. |
| **C. Ayrı `ServiceConsultation`, 1:1 `ExternalMeeting` ve 1:1 `ConsultationRequest`** | **Seçildi.** Sorumluluklar ayrılır: **zaman ve iş kuralı** `ServiceConsultation`'da (masa, koordinatör, durum, hatırlatma, sonuç); **oda, bağlantı, pencere ve kapanış** `ExternalMeeting`'de (AG kuralları olduğu gibi); **kişisel veri ve rıza** `ConsultationRequest`'te (AH şifreleme, saklama ve CRM). AG tablosuna kolon eklenmez; ilişki FK ile `ServiceConsultation` tarafında durur (Prisma'da yalnızca ters ilişki alanı, SQL kolonu yok). |

### 2.2 Prisma taslağı (bağlayıcı alan listesi; migration SQL'ini db-agent yazar)

Migration: `backend/prisma/migrations/2026111x090000_service_consultations/migration.sql`. İçeriği yalnızca `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, `ADD CONSTRAINT` (FK ve CHECK) ve `ALTER TABLE "site_settings" ADD COLUMN`. **Ön koşul:** AG'nin `20261112090000_external_meetings` migration'ı uygulanmış olmalı (FK hedefi).

```prisma
enum ServiceConsultationStatus {
  /// Ücretli seçenek için baştan tanımlanır; bu turda HİÇBİR KOD YAZMAZ (BookingPaymentStatus.REFUNDED emsali).
  PENDING_PAYMENT
  SCHEDULED
  COMPLETED
  CANCELLED
  NO_SHOW
}

/// Hizmet masası: bir hizmet (uzmanlık) veya hizmet grubu için çalışma saatleri, süre ve koordinatör havuzu.
model ServiceDesk {
  id            String   @id @default(uuid())
  seq           Int      @unique @default(autoincrement())
  /// Panel adı (EN kanonik), ör. "Surgery & Oncology desk". Ziyaretçiye gösterilmez.
  name          String
  isActive      Boolean  @default(false)
  /// Eşlemesi olmayan aktif uzmanlıklar bu masaya düşer. En çok 1 (kısmi tekil indeks, migration'da elle).
  isDefault     Boolean  @default(false)
  /// Haftalık saatlerin yorumlandığı IANA dilimi.
  timeZone      String   @default("Europe/Istanbul")
  /// 15–60, 5'in katı (AG süre kuralıyla uyumlu: 15–120/5).
  durationMin   Int      @default(30)
  /// Aynı koordinatörün iki görüşmesi arasındaki boşluk (0–30).
  bufferMin     Int      @default(0)
  /// En erken rezervasyon: şimdi + minNoticeMin (0–2880). Varsayılan 120 dk (S8).
  minNoticeMin  Int      @default(120)
  /// İleriye en çok kaç gün (1–90).
  horizonDays   Int      @default(30)
  /// Ev sahibi dahil oda sınırı (2–4). Varsayılan 3: koordinatör + hasta + 1 yakın.
  maxParticipants Int    @default(3)
  /// Ücretli seçenek — bu turda API true değerini 422 PAID_CONSULTATIONS_DISABLED ile reddeder.
  paidEnabled   Boolean  @default(false)
  priceCents    Int?
  currency      String   @default("EUR")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  hours         ServiceDeskHours[]
  specialties   ServiceDeskSpecialty[]
  members       ServiceDeskMember[]
  consultations ServiceConsultation[]

  @@index([isActive])
  @@map("service_desks")
}

/// DoctorAvailability ile aynı anlam: dakika, masanın timeZone'unda duvar saati. Slot satırı TUTULMAZ.
model ServiceDeskHours {
  id          String  @id @default(uuid())
  deskId      String
  dayOfWeek   Int     // ISO 1–7
  startMinute Int
  endMinute   Int
  isActive    Boolean @default(true)
  desk ServiceDesk @relation(fields: [deskId], references: [id], onDelete: Cascade)
  @@unique([deskId, dayOfWeek, startMinute])
  @@map("service_desk_hours")
}

/// Uzmanlık → masa eşlemesi. Bir uzmanlık en çok bir masaya bağlıdır (specialtyId tekil).
/// Alt uzmanlık (ESD/ERCP/POEM) kendi eşlemesi yoksa üst uzmanlığının masasına çözülür.
model ServiceDeskSpecialty {
  id          String @id @default(uuid())
  deskId      String
  specialtyId String @unique
  desk      ServiceDesk @relation(fields: [deskId], references: [id], onDelete: Cascade)
  specialty Specialty   @relation(fields: [specialtyId], references: [id], onDelete: Cascade)
  @@index([deskId])
  @@map("service_desk_specialties")
}

/// Hasta koordinatörü profili (InterpreterProfile deseni). Doktor profili olan kullanıcıya AÇILAMAZ.
model CoordinatorProfile {
  id          String   @id @default(uuid())
  seq         Int      @unique @default(autoincrement())
  userId      String   @unique
  /// Odada ve e-postada görünen ad; varsayılan baş harfli biçim ("Ayşe K."). Unvan yok.
  displayName String
  /// Görüşebildiği diller (site kodları + ISO), otomatik atamada tercih sebebi.
  languages   String[]
  timeZone    String   @default("Europe/Istanbul")
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  user          User                  @relation("CoordinatorProfileUser", fields: [userId], references: [id], onDelete: Restrict)
  memberships   ServiceDeskMember[]
  timeOff       CoordinatorTimeOff[]
  consultations ServiceConsultation[]
  @@map("coordinator_profiles")
}

model ServiceDeskMember {
  id             String    @id @default(uuid())
  deskId         String
  coordinatorId  String
  isActive       Boolean   @default(true)
  /// Round-robin için son atama anı.
  lastAssignedAt DateTime?
  addedById      String?
  createdAt      DateTime  @default(now())
  desk        ServiceDesk        @relation(fields: [deskId], references: [id], onDelete: Cascade)
  coordinator CoordinatorProfile @relation(fields: [coordinatorId], references: [id], onDelete: Cascade)
  @@unique([deskId, coordinatorId])
  @@map("service_desk_members")
}

/// DoctorTimeOff ile aynı disiplin: [startsAt, endsAt), note iç nottur ve sağlık verisi içermez.
model CoordinatorTimeOff {
  id            String   @id @default(uuid())
  coordinatorId String
  startsAt      DateTime
  endsAt        DateTime
  kind          String   // VACATION | OTHER (time-off.ts listesiyle doğrulanır)
  note          String?
  createdById   String?
  createdAt     DateTime @default(now())
  coordinator CoordinatorProfile @relation(fields: [coordinatorId], references: [id], onDelete: Cascade)
  @@index([coordinatorId, startsAt])
  @@map("coordinator_time_off")
}

/// Hizmet bazlı online ön görüşme. KİŞİSEL VERİ BURADA TUTULMAZ (ad/e-posta/telefon/mesaj → ConsultationRequest).
model ServiceConsultation {
  id                  String                    @id @default(uuid())
  /// Görünen numara: "SVC-" + 5 hane dolgulu seq.
  seq                 Int                       @unique @default(autoincrement())
  deskId              String
  coordinatorId       String
  /// 1:1 — oda, misafir bağlantısı, pencere ve kapanış AG kurallarıyla yönetilir.
  meetingId           String                    @unique
  /// 1:1 — kişisel veri + rızalar. Talep CRM saklama süresiyle anonimleşir; bağ korunur.
  requestId           String?                   @unique
  specialtyId         String?
  packageId           String?
  /// Hizmet adı anlık görüntüsü (EN).
  serviceName         String
  /// Hesaplı hasta (oturum açıkken rezervasyon); misafirde NULL.
  patientUserId       String?
  startsAt            DateTime
  endsAt              DateTime
  status              ServiceConsultationStatus @default(SCHEDULED)
  /// Gösterim için hastanın IANA dilimi ve site dili (e-postalar bu dilde; tr → en).
  patientTimeZone     String?
  locale              String?
  needsInterpreter    Boolean                   @default(false)
  interpreterLanguage String?
  /// Ücretli seçenek ileride: anlık görüntü. Bu turda daima false / null.
  paymentRequired     Boolean                   @default(false)
  priceCents          Int?
  consentVersion      String
  /// Hatırlatma damgaları ("önce sahiplen, sonra gönder"; appointment-reminders deseni).
  reminded24hAt       DateTime?
  reminded60mAt       DateTime?
  cancelledAt         DateTime?
  /// "patient" | "admin" | "system" — kişi kimliği audit'te.
  cancelledBy         String?
  outcomeAt           DateTime?
  /// "manual" | "auto"
  outcomeSource       String?
  createdAt           DateTime                  @default(now())
  updatedAt           DateTime                  @updatedAt

  desk        ServiceDesk          @relation(fields: [deskId], references: [id], onDelete: Restrict)
  coordinator CoordinatorProfile   @relation(fields: [coordinatorId], references: [id], onDelete: Restrict)
  meeting     ExternalMeeting      @relation(fields: [meetingId], references: [id], onDelete: Restrict)
  request     ConsultationRequest? @relation(fields: [requestId], references: [id], onDelete: SetNull)
  specialty   Specialty?           @relation(fields: [specialtyId], references: [id], onDelete: SetNull)
  package     HealthPackage?       @relation(fields: [packageId], references: [id], onDelete: SetNull)
  patientUser User?                @relation("ServiceConsultationPatient", fields: [patientUserId], references: [id], onDelete: SetNull)

  @@index([coordinatorId, startsAt])
  @@index([deskId, startsAt])
  @@index([status, startsAt])
  @@index([patientUserId])
  @@map("service_consultations")
}
```

`SiteSettings`'e eklenen tek kolon: `serviceBookingEnabled Boolean @default(false)`. Bu, genel açma/kapama anahtarıdır. Kapalıyken header'daki "Book a consultation" ve tüm "Book an online consultation" düğmeleri talep formuna (`/request`) gider; İş 2'deki "İş 3 canlıya çıkana kadar" kuralı buradan yönetilir. Public uçlar kapalıyken 404 döner.

### 2.3 Elle eklenen SQL (Prisma ifade edemez; `appointment_interpreters_one_active_per_booking` emsali)

```sql
-- Aynı koordinatöre aynı başlangıçta iki etkin görüşme olamaz (çakışmanın ikinci savunma hattı).
CREATE UNIQUE INDEX "service_consultations_coordinator_active_start"
  ON "service_consultations"("coordinatorId", "startsAt")
  WHERE "status" IN ('SCHEDULED', 'PENDING_PAYMENT');
-- En çok bir varsayılan masa.
CREATE UNIQUE INDEX "service_desks_one_default" ON "service_desks"("isDefault") WHERE "isDefault" = true;
-- Basit aralık denetimleri.
ALTER TABLE "service_consultations" ADD CONSTRAINT "service_consultations_time_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "service_desk_hours" ADD CONSTRAINT "service_desk_hours_range_check"
  CHECK ("dayOfWeek" BETWEEN 1 AND 7 AND "startMinute" >= 0 AND "endMinute" <= 1440 AND "endMinute" > "startMinute");
```

Not: Kısmi tekil indeks yalnızca aynı başlangıcı engeller. Farklı başlangıçlı **örtüşme** (masa süreleri farklıysa veya ara boşluk varsa) Serializable işlem içindeki denetimle engellenir (§4.3). Uyarı (AA emsali): `prisma db push` kullanılmaz, yalnızca `migrate deploy`.

### 2.4 Değişmeyen tablolar

`appointments`, `appointment_bookings`, `external_meetings`, `external_meeting_guests`, `consultation_requests`, `crm_leads`, `admin_notifications` ve `specialties` tablolarına kolon eklenmez veya değiştirilmez. `CrmLeadChannel`'a yeni değer eklenmez: hizmet randevusu lead'i mevcut `CONSULTATION_REQUEST` kanalıyla açılır. Ayrım, `ConsultationRequest → ServiceConsultation` ilişkisinden yapılır (lead detayında "Online consultation booked" kartı). İsteğe bağlı ayrı kanal: S10.

---

## 3. Koordinatör rolü ve yetkileri

### 3.1 Kim koordinatör olabilir?

- **Yeni `SiteRole` yok.** `SiteRole` (`schema.prisma:68-77`) değişmez. Koordinatör bir yetenek olarak tanımlanır (AG `canHostMeetings` deseni).
- Bir kullanıcının **etkin koordinatör** sayılması için şunların hepsi gerekir:
  1. `status = ACTIVE`.
  2. AG `canHostMeetings(user) === true` (`lib/meeting-host.ts`; yani ADMIN veya ev sahibi yetkisi verilmiş panel rolü).
  3. `CoordinatorProfile.isActive = true`.
  4. **`DoctorProfile` yok.** Profil açılırken doktor profili varsa 422 `COORDINATOR_NOT_ELIGIBLE` döner. Böylece ev sahibi adı hiçbir koşulda "Dr. …" olamaz (AG `hostDisplayName` doktor için unvan üretir, `meetings.service.ts:132-139`).
- Önerilen rol: **EDITOR** (panel girişi var, ödeme ve kullanıcı yönetimi yok). MANAGER da olabilir. Hizmet masası uçlarında yetki **rolden değil**, her istekte taze okunan koordinatör profilinden gelir (`requireDoctorPortalAccess` ve `requireMeetingHost` deseni). → S2.
- Admin ekranında "Koordinatör yap" işlemi tek adımdır. Kullanıcıda ev sahibi yetkisi yoksa aynı onay diyaloğunda AG yetkisi de verilir (`PATCH /admin/users/:id/meeting-host`). İkisi de audit'e ayrı yazılır.

### 3.2 Yetki matrisi

| İşlem | ADMIN | MANAGER | Koordinatör (kendi kaydı) | Diğer |
|---|---|---|---|---|
| Masa oluştur/düzenle, saatler, uzmanlık eşlemesi | ✔ | ✔ | — | — |
| Koordinatör profili aç/kapat, masaya ata | ✔ | ✔ | — | — |
| Koordinatör izni | ✔ | ✔ | Kendi izni (S3) | — |
| Tüm hizmet randevularını listele/detay | ✔ | ✔ | — | — |
| Kendi randevuları: liste/detay (ad, ülke, dil, tercüman, iletişim) | — | — | ✔ | — |
| Talep mesajını (sağlık verisi) çözerek görme | ✔ (2FA, audit — AH kuralı) | — | **Varsayılan hayır** (S1) | — |
| Görüşmeye ev sahibi olarak girme | Yalnızca kendisine atanmışsa | Yalnızca kendisine atanmışsa | ✔ (yalnızca kendisine atanmış) | — |
| İptal, saat değiştirme, yeniden atama | ✔ | ✔ | — (S3) | — |
| Sonuç işaretleme (Completed / No-show) | ✔ | ✔ | ✔ (kendi) | — |
| Bağlantıyı yeniden gönderme | ✔ | ✔ | ✔ (kendi) | — |

- **Paket E ilkesi korunur:** Rol, odaya girme hakkı vermez. ADMIN başkasına atanmış görüşmeye giremez. AG `loadOwnMeeting` (`meetings.service.ts:141`) zaten `hostUserId` eşleşmesi ister; başkasının toplantısında 404 döner.
- Başkasının kaydı her zaman **404** alır (403 değil, varlık sızdırılmaz).

### 3.3 AG yetki geri alımı ile ilişki

AG S3'e göre yetki geri alınınca kullanıcının gelecek toplantıları iptal edilir. Bu kural hizmet randevularını sessizce iptal etmemelidir. Bu nedenle:
- Kullanıcının gelecekte `SCHEDULED` hizmet randevusu varsa AG yetki geri alma ucu **409 `COORDINATOR_HAS_UPCOMING_CONSULTATIONS`** döner. Mesaj: "Önce N görüşmeyi yeniden atayın".
- Aynı kural `CoordinatorProfile.isActive = false`, masadan çıkarma ve kullanıcı askıya alma için de geçerlidir. Admin ekranında "Tümünü otomatik yeniden ata" düğmesi bulunur (§10).

---

## 4. Slot üretimi

### 4.1 Masa çözümü

1. İstekte `service=<specialtySlug>` veya `package=<packageSlug>` gelir.
2. Uzmanlık aktif değilse 404 döner.
3. `ServiceDeskSpecialty` eşlemesi aranır. Yoksa ve uzmanlık alt uzmanlıksa (`parentId`, AG İş 1) üst uzmanlığın eşlemesi denenir. O da yoksa `isDefault` masaya düşülür.
4. Paket için `HealthPackage.relatedSpecialtyIds` sırasıyla aynı çözüm uygulanır; hiçbiri eşlenmezse varsayılan masa kullanılır.
5. Masa aktif değilse, saati yoksa veya etkin üyesi yoksa sonuç `SERVICE_NOT_BOOKABLE` (404) olur. Arayüz bu durumda talep formuna yönlendirir.

Bu yapı "hizmet **veya** grup" isteğini karşılar. Örneğin "Surgery & Oncology desk" dört uzmanlığa bağlanır; İş 1'in grup alanı ise yalnızca menü görünümü içindir. Masa ile menü grubunun bağımsız olması, İş 1'in alan biçimine bağımlılık doğurmaz. → S9.

### 4.2 Algoritma (saf fonksiyon + tek DB okuması)

`lib/service-slots.ts`, `computeDeskSlots({ desk, hours, members, busy, from, to, now })`:

1. **Aday slotlar:** `generateAvailableSlots({ timeZone: desk.timeZone, sessionDurationMin: desk.durationMin, rules: hours, fromDate, toDate, now, bookedStartTimesMs: new Set() })` (`availability.ts:88`). DST davranışı miras alınır.
2. **Tampon:** `startsAt < now + minNoticeMin` ve `startsAt > now + horizonDays` olan slotlar elenir.
3. **Koordinatör uygunluğu:** Her aday slot için `[startsAt − bufferMin, endsAt + bufferMin)` aralığında şunlardan **hiçbiriyle** örtüşmeyen etkin üye aranır:
   - kendisine atanmış `SCHEDULED` veya `PENDING_PAYMENT` `ServiceConsultation`;
   - ev sahibi olduğu `SCHEDULED` `ExternalMeeting` (AG genel toplantıları dahil; böylece koordinatörün diğer toplantılarıyla çakışma olmaz);
   - `CoordinatorTimeOff`.
4. Slot `available = (uygun üye sayısı ≥ 1)` olur. **Yanıtta yalnızca `startsAt/endsAt` döner.** Koordinatör kimliği ya da uygun koordinatör sayısı dönmez (kapasite ve personel bilgisi sızmaz).
5. Tek DB okuması: Masa üyelerinin `[from − buffer, to + buffer]` aralığındaki üç meşguliyet kaynağı tek seferde çekilir; hesap bellekte yapılır. İstek aralığı en çok 14 gündür.

Koordinatör bazında ayrı haftalık saat bu turda **yoktur**. Masa saatleri ortaktır; bireysel yokluk izinle girilir. → S7.

### 4.3 Otomatik atama (rezervasyon anında, `runSerializable` içinde)

1. Masa, saatler ve üyeler işlem içinde taze okunur. `isBookableSlotStart` (`availability.ts:134`) ile slot yapısal olarak doğrulanır, ardından tampon ve ufuk kontrol edilir.
2. Uygun üyeler §4.2-3'teki kuralla bulunur. Hiç yoksa **409 `SLOT_TAKEN`** döner (mevcut hata sınıfı ve mesajı).
3. Seçim sırası:
   - **(a)** `contactLanguage` veya tercüman dili koordinatörün `languages` listesinde olanlar;
   - **(b)** o gün en az görüşmesi olan;
   - **(c)** `lastAssignedAt` en eski olan (round-robin);
   - **(d)** eşitlikte kriptografik rastgele seçim.
4. Yazma sırası (tek işlem):
   - `CrmLead` + `ConsultationRequest` (AH ile aynı alanlar);
   - `ExternalMeeting` (§6.2);
   - `ServiceConsultation`;
   - `ServiceDeskMember.lastAssignedAt` güncellemesi.
5. P2002 (kısmi tekil indeks) veya P2034 alınırsa işlem **bir kez** yeniden denenir (seçilen koordinatör artık uygun olmayacağı için bir sonraki seçilir). İkinci hatada 409 `SLOT_TAKEN` döner (`booking.ts:311-319` deseni).
6. E-postalar, admin bildirimi ve koordinatör bildirimi **işlem sonrasında**, best-effort olarak gider (AG ve AH ilkesi; e-posta hatası rezervasyonu bozmaz).

### 4.4 Saat dilimleri

- Kurallar masanın `timeZone`'unda (varsayılan `Europe/Istanbul`) yorumlanır. Tüm anlar UTC saklanır.
- İstemci tarayıcının IANA dilimini (`Intl.DateTimeFormat().resolvedOptions().timeZone`) gönderir. Slotlar **hastanın saatinde** gösterilir, yanında küçük "Istanbul time" satırı bulunur (Paket R emsali). E-postalarda iki saat birlikte yazılır.
- Gün gruplaması hastanın diliminde yapılır. Masa diliminde gece yarısını aşan slotlar hasta takviminde doğru güne düşer.

---

## 5. Rezervasyon akışı (misafir veya hesaplı)

### 5.1 Ekran akışı — `/{lang}/book-consultation?service=<slug>` (veya `?package=<slug>`)

1. **Hizmet:** Parametre varsa seçili gelir ve değiştirilebilir. Yoksa İş 1'deki gruplu liste gösterilir; yalnızca rezerve edilebilir hizmetler etkindir, diğerlerinin yanında "Request" bağlantısı olur.
2. **Tarih ve saat:** Hafta görünümü (mobilde gün şeridi + saat çipleri), hastanın saat diliminde. Görüşme süresi ("30-minute video call with a patient coordinator") ve "free of charge" yazar.
3. **Bilgiler:** AH talep formuyla **aynı alanlar ve kurallar**:
   - ad soyad, e-posta;
   - telefon veya WhatsApp (isteğe bağlı);
   - ülke;
   - iletişim dili (8 dil);
   - **tercüman ihtiyacı** (evet/hayır; evetse dil seçimi);
   - mesaj (isteğe bağlı, en çok 1000 karakter; "Do not share detailed medical information here" uyarısıyla);
   - **iletişim açık rızası** (zorunlu) ve aydınlatma metni bağlantısı;
   - **sağlık verisi açık rızası** (mesaj doluysa zorunlu, sunucuda da);
   - görüşme notu: "This is not a medical examination. Medical assessment and treatment decisions are made by physicians at authorized healthcare facilities." ve aracı kuruluş ibaresi;
   - honeypot (`website`).
4. **Onay ekranı:** `SVC-00042`, tarih ve saat (iki dilimde), "Join link sent to your e-mail; the room opens 15 minutes before". Hesaplı hastada ek olarak "View in My account" bağlantısı.

Formda **kimlik numarası veya pasaport istenmez.** Mevcut booking'in kimlik adımı (`telehealth.routes.ts:565-568`) bu akışa taşınmaz (veri minimizasyonu; görüşme ön bilgilendirmedir).

### 5.2 Uçlar (kontrat `docs/architecture/openapi.yaml`'a yeni `ServiceConsultations` etiketiyle eklenir; kodlamanın ilk adımı)

| Yöntem ve yol | Kimlik | Not |
|---|---|---|
| `GET /service-desks/bookable` | yok | `{ enabled, specialtySlugs[], packageSlugs[] }`. Düğmelerin görünürlüğünü besler. Kısa önbellek (60 sn). |
| `GET /service-consultations/slots?service=\|package=&from=&to=` | yok | `{ timeZone, durationMin, slots: [{ startsAt, endsAt }] }`. Aralık en çok 14 gün. 60/dk IP. |
| `POST /service-consultations` | isteğe bağlı (`authenticateOptional`) | Gövde = AH talep gövdesi + `startsAt`, `patientTimeZone`, `locale`. **201** `{ consultationNumber, startsAt, endsAt, durationMin, joinOpensAt }`. Yanıtta bağlantı veya belirteç yok; bağlantı yalnızca e-postaya gider. 5/dk IP. |
| `POST /service-consultations/cancel` | yok | `{ t }` (misafir bağlantısının belirteci). Hasta kendi görüşmesini iptal eder. Geçersiz belirteçte AG ile aynı tek tip 404 döner. |
| `POST /service-consultations/resend-link` | yok | `{ consultationNumber, email }`. **Her durumda 202.** Yalnızca eşleşirse yeni bağlantı üretilip **kayıtlı adrese** gönderilir (`resendBookingAccessLink` ilkesi). 1/dk IP + numara başına saatte 3. |
| `GET /me/service-consultations` | oturum | Hastanın kendi görüşmeleri. |
| `POST /me/service-consultations/:id/join` | oturum | AG `/meet/guest/join` ile **aynı yanıt biçimi** (`waiting \| ready`, `guestSession`, token). §6.2. |
| `POST /me/service-consultations/:id/cancel` | oturum | Kendi görüşmesi; başlangıçtan önce. |

Yanıt ve hata kodları:

| HTTP | code | Ne zaman |
|---|---|---|
| 404 | `SERVICE_NOT_BOOKABLE` | Hizmet, masa, saat veya üye yok; ya da `serviceBookingEnabled` kapalı |
| 409 | `SLOT_TAKEN` (mevcut) | Slot dolu veya artık geçersiz |
| 409 | `SERVICE_CONSULTATION_LIMIT` | Aynı e-postaya ait 2'den fazla gelecek görüşme |
| 409 | `CONSULTATION_NOT_CANCELLABLE` | Başlamış, bitmiş veya iptal edilmiş görüşme |
| 403 | `FORBIDDEN` (mevcut) | Doktor profilli kullanıcı rezervasyon yapmaya çalışıyor |
| 422 | `VALIDATION_ERROR` (mevcut) | Rıza ve alan kuralları (AH ile aynı mesajlar) |
| 422 | `PAID_CONSULTATIONS_DISABLED` | Admin masada `paidEnabled: true` denedi |
| 429 | `RATE_LIMITED` (mevcut) | |

### 5.3 Hesaplı ve misafir farkı

- **Oturum açıkken:** Ad ve e-posta hesaptan önceden doldurulur. `ServiceConsultation.patientUserId` yazılır. Görüşme "My account" altında yeni bir **"Online consultations"** sekmesinde görünür (`/{lang}/patient/consultations`). Katılım ve iptal buradan yapılır. E-postadaki bağlantı da çalışır.
- **Misafir:** Hesap **açılmaz.** `provisionPatientAccountForBooking` (`patient-account.ts:26`) çağrılmaz. Gerekçe: o akışın hukuki dayanağı randevu rıza metni `v3`'tür ("hesap yönetimi" amacı, `booking.ts:70-76`). Burada rıza metni farklıdır ve ücretsiz bir ön görüşme için kalıcı hesap açmak veri minimizasyonuna aykırıdır. → S6.

### 5.4 Tercüman

- Kayıt düzeyi: `needsInterpreter` ve `interpreterLanguage` hem `ConsultationRequest`'e (mevcut alan) hem `ServiceConsultation`'a yazılır.
- **Otomatik atama dil uyumunu önceler** (§4.3-3a). Dil uyumlu koordinatör atanırsa admin bildiriminde "Interpreter: requested (ar) — coordinator speaks ar" yazar.
- Dil uyumlu koordinatör yoksa admin bildirimi ve panel kaydı "**Interpreter needed (ar)**" işaretiyle gelir.
- Oda kapasitesi varsayılan 3'tür (koordinatör + hasta + 1 yakın). Paket AA tercüman ataması `AppointmentBooking`'e bağlı olduğu (`schema.prisma:3828-3870`) ve tercüman token'ı yalnızca `room_` booking odası için üretildiği için (`lib/livekit.ts:220`) bu turda kullanılamaz. Bu yüzden Faz A'da dil desteği **aynı dili konuşan koordinatörün** atanmasıyla sağlanır.
- Faz B: `ServiceConsultationInterpreter` tablosu ve AA tercüman panelinde "meet_ odası" katılımı ayrı iş olarak tasarlanır. → S4.

### 5.5 Ücretli seçenek (bu turda kapalı)

- **Bayrak:** `ServiceDesk.paidEnabled` (varsayılan false) ve `priceCents`/`currency`. Admin formunda anahtar görünür ama kilitlidir ("Coming later"). API `true` değerini 422 ile reddeder.
- **İleride açıldığında plan:**
  - Rezervasyon `PENDING_PAYMENT` durumunda, 30 dk tutma süresiyle oluşur (`BOOKING_HOLD_MS` deseni).
  - Ödeme oturumu integration-agent'ın sahasıdır (Stripe Checkout); webhook ödemeyi onaylayınca durum `SCHEDULED` olur ve e-postalar o anda gider.
  - Slot hesabı `PENDING_PAYMENT`'ı zaten meşgul sayar (§4.2). Enum değeri baştan tanımlı olduğu için ileride migration gerekmez.
- Bu turda hiçbir kod `PENDING_PAYMENT` yazmaz. Ödeme backend'i ve AH'nin kapalı sepeti etkilenmez.

### 5.6 Kötüye kullanım (takvim doldurma)

- **Oran sınırı:** `POST` için 5/dk IP. Ayrıca IP başına günde 10 rezervasyon ve aynı e-postaya en çok 2 gelecek görüşme.
- **Honeypot** (AH ile aynı).
- **Saatlik uyarı:** Site genelinde saatte 20'yi aşan rezervasyonda adminlere saatte en çok 1 uyarı gider (AH `consultation_cap_reached` deseni).
- **İptal:** Admin listesinde toplu iptal vardır. İptal edilen slot hemen boşalır (kısmi indeks yalnızca etkin durumları kapsar).
- **E-posta doğrulaması (OTP):** Bu turda **yok.** Mevcut OTP altyapısı (`lib/otp`) eklenebilir ama sürtünme getirir. → S5.

---

## 6. Görüşme token'ı ve oda

### 6.1 Kırmızı çizgi değerlendirmesi: istisna gerekmiyor

- Hizmet görüşmesi **yalnızca `meet_` odalarında** yapılır ve yalnızca AG'nin uçları ile `lib/meeting-livekit.ts` kullanılır.
- `telehealth.livekit.routes.ts`, `lib/livekit.ts::createMeetingToken`, `consultation-room.tsx`, `room/stage.tsx`, `room/control-bar.tsx` ve `room/participant-label.ts` **hiç değişmez.** Doktor kimlik önekleri (`doctor:` / `patient:`), Paket E erişim kuralı, ödeme şartı ve kayıt akışı aynı kalır.
- AG'nin süpürücüsü yalnızca `meet_` odalarına dokunur. Doktor süpürücüleri (`qa-listener-sweeper`, `interpreter-sweeper`, otomatik kapanış) `meet_` odalarını görmez. İki dünya oda öneki ve kimlik öneki düzeyinde ayrıdır.
- **Sonuç: `consultation-room.tsx` ve mevcut görüşme token kuralları için istisna GEREKMEZ.** Gerekli tüm değişiklikler AG İş 3'ün kendi (henüz master'da olmayan) dosyalarına küçük eklemelerdir (§6.4).

### 6.2 Akış

**Rezervasyon anında (sunucu):**
1. `ExternalMeeting` oluşturulur. Alanlar:
   - `hostUserId` = atanan koordinatörün `userId`'si;
   - `title` = sabit genel ad `"WM Health online consultation"` (hasta adı ve hizmet adı yok; bkz. §7);
   - `note` = null;
   - `startsAt/endsAt/durationMin` = slot;
   - `maxParticipants` = masa değeri (varsayılan 3);
   - `autoAdmitGuests` = false (hasta koordinatörü bekler);
   - `roomName` = `generateMeetingRoomName()` (`meet_` + 32 hex).
2. `generateGuestToken()` ile `mg_…` üretilir; DB'ye yalnızca özeti yazılır. Düz belirteç yalnızca bu istek boyunca bellekte tutulur ve onay e-postasındaki `buildGuestLink(token, locale)` bağlantısına konur (AG S5 "yalnızca oluşturma anında" ilkesi).

**Koordinatör (ev sahibi):**
- Panelde "My consultations" → **Join** → AG ev sahibi sayfası `/{lang}/meet/{meetingId}` (`HostMeetingRoom`). Bu sayfa `POST /meetings/:id/host-token` çağırır.
- Kural AG ile aynıdır: pencere `startsAt − 15 dk ≤ şimdi < endsAt`; iptal edilmiş görüşmede 409; başkasının görüşmesinde 404.
- Token `meet-host:<userId>` kimliğiyle verilir; ekran paylaşımı açıktır, `roomAdmin` ve `roomRecord` yoktur.
- Hasta sayfası bekleme yoklamasındayken koordinatör odaya girince hasta otomatik olarak alınır.

**Misafir hasta (bağlantıyla):**
- `/{lang}/meet/join#mg_…` → AG `GuestJoinFlow`: parça okunur ve adres çubuğundan silinir → `preflight` → ad girişi → `join`.
- Koordinatör yoksa yanıt `waiting` olur ve 5 sn'lik yoklama başlar. Koordinatör gelince `ready` döner ve oda açılır.
- Token `meet-guest:<guestId>` kimliğiyle verilir; yalnızca kamera ve mikrofon izinlidir. Bitişte süpürücü odayı kapatır.
- Hasta adını kendisi girer (AG kuralı, 2–40 karakter, sunucuda doğrulanır). Ad yalnızca `ExternalMeetingGuest`'te tutulur ve 90 gün sonra silinir (AG S6).

**Hesaplı hasta (portaldan):**
- `/{lang}/patient/consultations` → **Join** → `/{lang}/meet/consultation/{consultationId}`.
- Bu sayfa `GuestJoinFlow`'u enjekte edilmiş fonksiyonlarla çalıştırır: `preflight` yerine `GET /me/service-consultations/:id`, `join` yerine `POST /me/service-consultations/:id/join` çağrılır. Ad formu atlanır.
- Sunucu sırası:
  1. Oturum zorunludur.
  2. `consultation.patientUserId === user.id` değilse **404**.
  3. Durum `SCHEDULED` olmalıdır.
  4. AG'nin misafir kabul fonksiyonu (`admitMeetingGuest`, §6.4-5) aynı adımları uygular: pencere, oturum (`gs_v1`), bekleme kapısı, kapasite, token ve audit. Görünen ad olarak hesabın adı kullanılır (hastanın kendi girdiği ad; normalize edilir, kurala uymazsa "Patient" yedeği kullanılır).
- Böylece hesaplı hasta **misafir bağlantısına ihtiyaç duymaz** ve bağlantıyı döndürmek (rotate) gerekmez. Token yine `meet-guest:` kimliklidir; grant'lar misafirle birebir aynıdır.

### 6.3 Ad etiketi: "Patient Coordinator · Ayşe K."

- Ev sahibi token'ının `name` alanı, hizmete bağlı toplantılarda sunucuda `Patient Coordinator · ${coordinatorProfile.displayName}` olarak üretilir. Kaynak `user.name` ya da doktor unvanı **değildir**.
- İstemcide etiket `participant-label.ts:111` ile token adından gelir. Dosya **değişmez.** `canUpdateOwnMetadata: false` olduğu için misafir kendi adını "Patient Coordinator …" yapamaz.
- Misafir adı doğrulamasına ek kural: AG ad doğrulayıcısı `Patient Coordinator` ve `Coordinator` ile başlayan adları reddeder (taklit önlemi; AG `meeting-guest-name.ts`'e küçük ek).
- "Patient Coordinator" ibaresi token'da İngilizce sabittir. Etiketin izleyicinin dilinde gösterilmesi istenirse AG `meeting-room.tsx` etiket bağlamına bir eşleme eklenir. → S11.
- **Kayıt yok**, üç katmanda: grant'ta `roomRecord` yok; `startRoomCompositeRecording` yalnızca `telehealth.recording.routes.ts`'te ve `Appointment` ile çağrılır; AG oda bileşeni kayıt bileşeni içe aktarmaz. AG'deki statik "grep" testi bunu kapsar.

### 6.4 AG İş 3'e eklenecek uyarlamalar (AG master'a alınırken veya AI İş 3'ün ilk adımında)

Bu eklemeler AG dosyalarına yapılır. Doktor görüşme dosyalarına dokunulmaz ve AG'nin güvenlik kuralları gevşemez.

1. **Sınır sayacı:** `MAX_FUTURE_MEETINGS_PER_HOST = 20` (`meetings.service.ts:10`) hizmete bağlı toplantıları **saymaz** (`where: { serviceConsultation: null }`). Aksi hâlde yoğun bir koordinatör 20 rezervasyondan sonra kilitlenir.
2. **Koruma:** Hizmete bağlı toplantıda AG'nin `PATCH /meetings/:id`, `POST /:id/cancel`, `POST/DELETE /:id/guest-link`, `POST /:id/invite-email` ve admin iptal uçları **409 `MEETING_MANAGED_BY_SERVICE_DESK`** döner. Zaman, iptal ve bağlantı yalnızca hizmet masası uçlarından yönetilir; böylece randevu ile oda tutarlı kalır ve hastanın e-postadaki bağlantısı sessizce geçersizleşmez.
3. **Yetki geri alma:** AG S3 otomatik iptali hizmete bağlı toplantıları kapsamaz. Gelecek hizmet randevusu varsa geri alma 409 döner (§3.3).
4. **Ev sahibi adı:** `host-token` içinde, toplantı hizmete bağlıysa görünen ad `Patient Coordinator · <displayName>` olur (§6.3). Preflight yanıtındaki `hostName` de aynı değeri döner.
5. **Ortak misafir kabul fonksiyonu:** `meetings.guest.routes.ts:100-182` (pencere → oturum → bekleme → kapasite → token → audit) `admitMeetingGuest(app, meeting, { guestSession?, name? })` olarak servise çıkarılır. AG `/meet/guest/join` adım 1–2'den (belirteç ve 503) sonra bunu çağırır; AI'nın `/me/service-consultations/:id/join` ucu da sahiplik kontrolünden sonra çağırır. Davranış değişmez; AG testleri regresyon güvencesidir.
6. **Preflight amacı:** Preflight yanıtına `purpose: "general" | "service_consultation"` eklenir. Misafir ekranı amaç `service_consultation` olduğunda sözlükten "Online consultation with your WM Health patient coordinator" başlığını, aracı kuruluş ibaresini ve "This is not a medical examination" notunu gösterir. Bekleme ekranında "Your coordinator will admit you shortly" yazar.
7. **`GuestJoinFlow` enjeksiyonu:** İsteğe bağlı `preflightFn`, `joinFn` ve `skipName` prop'ları eklenir (varsayılanlar AG'nin bugünkü davranışı). Hesaplı hasta sayfası bunları kullanır.
8. **"Toplantılar" listesi:** Hizmete bağlı satırlarda "Service consultation · SVC-00042" rozeti gösterilir; düzenle, iptal ve bağlantı eylemleri gizlenir; "Join" kalır.

---

## 7. KVKK/GDPR

- **Sınıflandırma:**
  - Ad, e-posta, telefon, ülke ve dil kişisel veridir.
  - Mesaj ve "hangi hizmet için görüşme" bilgisi **sağlık verisiyle ilişkili özel nitelikli veri** sayılabilir (bir kişinin obezite cerrahisi danışması yaptırdığı bilgisi).
  - Görüşme sırasında konuşulanlar **kaydedilmez** ve hiçbir yerde saklanmaz.
- **Rıza:**
  - İletişim açık rızası zorunludur.
  - Mesaj doluysa sağlık verisi açık rızası zorunludur (AH ile aynı; sunucuda zorlanır).
  - Rıza metni sürümü yeni bir değerdir: **`service-consultation-v1`**. AH'nin `consultation-v1` metni "koordinatörün sizinle iletişime geçmesi" amacını kapsar; burada ek olarak görüntülü görüşme planlama, koordinatör ataması, adın odada görünmesi ve dil eşleştirmesi vardır.
  - Rıza metinleri hukuk onayına gider. `docs/legal/` bu turda **değişmez**; aydınlatma metnine eklenecek maddeler hukuk kontrol listesine yazılır.
- **Veri minimizasyonu:**
  - Kimlik numarası, doğum tarihi ve belge yükleme yok.
  - Hasta adı token'a ve oda başlığına girmez. Misafir hasta odada görünen adı kendisi girer.
  - Oda başlığı ve e-posta konu satırları **hizmet adı içermez** (AH onay e-postası ilkesi: yanlış adrese giden e-posta sağlık bilgisi sezdirmemeli).
  - Admin bildiriminde ad, e-posta, telefon ve mesaj yoktur.
- **Erişim:** Koordinatör yalnızca kendisine atanmış kayıtların iletişim bilgisini görür. Mesajı yalnızca ADMIN, 2FA ile ve audit kaydıyla çözer (AH kuralı; koordinatör için açılması S1). Her detay görüntüleme `service_consultation.viewed` audit'ine yazılır (metadata'da kişisel veri yok).
- **Saklama:**
  - `ConsultationRequest`: AH kuralları (IP ve tarayıcı bilgisi 30 gün, mesaj 365 gün, CRM saklama süresi sonunda anonimleşme).
  - `ServiceConsultation`: kişisel veri içermez (FK, zaman ve durum). Bu yüzden istatistik ve iş kaydı olarak kalır. `requestId` SetNull, `patientUserId` SetNull.
  - `ExternalMeetingGuest` adı: 90 gün sonra silinir (AG S6).
  - Audit: kişisel veri, belirteç ve URL yazılmaz.
- **Hak talepleri:** Hasta iptali bağlantıyla veya portaldan yapılır. Sağlık rızasının geri çekilmesi AH'deki admin ucuyla yürür (`withdraw-health-consent`). Silme talebi CRM anonimleştirmesiyle karşılanır.
- **Yurt dışı aktarım:** LiveKit kendi sunucumuzda çalışır ve yeni bir 3. taraf eklenmez. E-posta sağlayıcısı mevcut olanla aynıdır.
- compliance-agent, rıza metinlerini, mesajın koordinatöre açılıp açılmayacağını (S1) ve saklama sürelerini onaylar.

---

## 8. Admin bildirimi (AG altyapısı, kişisel veri yok)

- Yeni olay türleri (`BookingNotificationEvent` birleşimine eklenir; `admin_notifications` şeması değişmez):
  - `service_consultation_booked` — anahtar `svc:<id>:booked`;
  - `service_consultation_cancelled` — anahtar `svc:<id>:cancelled`;
  - `service_consultation_rescheduled` — anahtar `svc:<id>:rescheduled:<eski>:<yeni>`;
  - `service_consultation_reassigned` — anahtar `svc:<id>:reassigned:<koordinatörId>`.
- Bilgi `payload: { serviceConsultationId }` içinde taşınır (AH `consultation_request` emsali).
- Alıcılar "Randevu bildirimi alıcıları" ayarından gelir (AG İş 2). Gönderim mekanizması aynıdır: alıcı başına gönderim, yeniden deneme (1, 5, 15 dk) ve 90 gün saklama.
- **İçerik (EN, personel şablonu):**
  - Konu: `New online consultation SVC-00042 — <masa adı> — 2026-11-20 14:00 (Europe/Istanbul)`. Personel e-postasında hizmet ve masa adı yer alır (AG İş 2'de hekim adı olduğu gibi).
  - Gövde: numara, hizmet, tarih ve saat (Istanbul + hastanın dilimi), süre, koordinatör görünen adı, iletişim dili, tercüman (`yes (ar)` / `no` / `coordinator speaks ar`), kaynak (hizmet sayfası, paket veya Find your treatment) ve "Open consultation" bağlantısı (`/admin/service-desk/consultations/<id>`).
  - **Ad, e-posta, telefon ve mesaj yok.** Mevcut AC PII testi yeni türleri otomatik kapsar; ayrıca fixture değerleriyle negatif test yazılır.
- **Koordinatöre bildirim:** Personel e-postası gönderilir: "New consultation assigned to you" / iptal / saat değişikliği. Aynı içerik kuralları geçerlidir (kişisel veri yok, panel bağlantısı var). Aynı altyapıyla gider; alıcı yalnızca koordinatördür. Yeni alan gerekmez: `payload: { serviceConsultationId, audience: "coordinator" }`.

---

## 9. Hasta e-postaları

Kurumsal şablon (`renderBrandedEmail`, `sendBrandedMail`) kullanılır ve aracı kuruluş footer'ı otomatik eklenir. Dil hastanın dilidir (`toCustomerEmailLocale`, tr → en), 8 dil. Sözlük `service-consultation-email.ts` içinde, AH `consultation-request-email.ts` deseniyle tutulur. Yeni `EmailTemplatePurpose` değeri **eklenmez** (ALTER TYPE gerekmez); "mevcut şablon" kurumsal marka şablonudur.

| E-posta | Ne zaman | İçerik |
|---|---|---|
| Onay | Rezervasyondan hemen sonra | `SVC-…`, tarih ve saat (hasta dilimi + Istanbul), süre, "with a WM Health patient coordinator", **Join** düğmesi (misafir bağlantısı `#mg_…`), "opens 15 minutes before", tarayıcı ve cihaz önerisi, iptal bağlantısı (aynı bağlantı sayfasında "Cancel"), not "This is not a medical examination…" ve aracı kuruluş ibaresi. **Hizmet adı yok.** |
| Hatırlatma (24 saat) | `startsAt − 24 saat` bandı | Bağlantısız bilgilendirme: tarih ve saat, "Your join link will arrive 1 hour before" ve hesaplı hastaya "or join from My account". |
| Hatırlatma (60 dk) | `startsAt − 60 dk` bandı | **Yeni bağlantı üretilir** (eskisi geçersiz olur; `resendBookingAccessLink` ilkesi). E-postada "This link replaces previous links" notu yer alır. Gerekçe: Düz belirteç saklanmadığı için hatırlatmaya bağlantı koymanın tek güvenli yolu budur. Pencere 15 dk önce açıldığı için 60 dk'da odada kimse olmaz; yenileme bekleyen bir oturumu kesmez. → S12. |
| İptal | Hasta, admin veya sistem iptalinde | Numara, eski tarih ve "Book a new time" bağlantısı. |
| Saat değişikliği | Admin değiştirince | Yeni tarih ve **yeni bağlantı** (eskisi geçersiz). |
| Bağlantıyı yeniden gönder | Hasta formu, admin veya koordinatör | Yeni bağlantı; eskisi geçersiz. |

- **Hatırlatma süpürücüsü:** `service-consultation-reminders.ts` 5 dk aralıkla çalışır ve "önce sahiplen, sonra gönder" yöntemini kullanır (`reminded24hAt` / `reminded60mAt` koşullu `updateMany`). `app.ts`'e kayıt eklenir. İptal ve saat değişikliğinde damgalar sıfırlanır.
- **Sınırlar:** Onay e-postasında adres başına saatte 3, site genelinde saatte 50 (AH ile aynı).
- **Gizlilik:** Konu satırlarında hizmet adı yoktur: "Your online consultation is confirmed — SVC-00042".

---

## 10. Admin ekranları (`/admin/service-desk/*`; ADMIN ve MANAGER, koordinatör ekranı hariç)

Kenar çubuğuna "Hizmet Masası" grubu eklenir. "Görüşmelerim" öğesi `isServiceCoordinator` ile görünür; bu değer `/users/me`'ye türetilmiş alan olarak eklenir (`canHostMeetings` deseni).

1. **Masalar:** Liste (ad, aktif, varsayılan, süre, üye sayısı, bağlı hizmetler). Form alanları:
   - ad, saat dilimi, süre (15/20/30/45/60), ara boşluk, en erken rezervasyon, ufuk, oda sınırı (2–4);
   - ücretli anahtarı (kilitli);
   - aktif ve varsayılan seçimi;
   - **Bağlı hizmetler:** İş 1 gruplarına göre gruplu, çoklu seçim. Başka masaya bağlı uzmanlık "(Desk X)" etiketiyle görünür ve seçilirse oraya taşınır; onay istenir.
2. **Çalışma saatleri:** Doktor haftalık saat düzenleyicisinin görsel deseni (gün başına aralıklar, çakışma uyarısı). Önizleme: "Next 7 days: 42 slots".
3. **Koordinatörler:**
   - Panel kullanıcıları arasından seçilir ("Koordinatör yap"; doktor profilli kullanıcı listelenmez).
   - Görünen ad (varsayılan "Ayşe K."), diller, saat dilimi, aktiflik.
   - Masalara atama (çoklu).
   - İzinler.
   - Pasifleştirmede gelecek görüşme varsa "Yeniden ata" diyaloğu çıkar (§3.3).
4. **Hizmet randevuları:**
   - **Liste:** Süzgeçler tarih, masa, koordinatör, durum, tercüman ve "Interpreter needed". Satırda numara, hizmet, tarih ve saat, koordinatör, dil, tercüman ve durum bulunur. Hasta adı listede **yalnızca baş harfli** gösterilir (AA deseni).
   - **Detay:** Hasta bilgileri (ad, e-posta, telefon, ülke, dil); "Mesajı göster" (yalnızca ADMIN, 2FA, audit); CRM lead bağlantısı; oda durumu (koordinatör katıldı mı, hasta kabul edildi mi — AG `hostJoinedAt` ve misafir `admittedAt`); zaman çizelgesi (audit).
   - **Eylemler:** İptal (gerekçe kodu), Saat değiştir (uygun slotlar; koordinatör yeniden otomatik atanır veya elle seçilir), Koordinatörü değiştir, Bağlantıyı yeniden gönder, Sonuç (Completed / No-show).
   - Saat değişikliği aynı `ExternalMeeting` üzerinde `startsAt/endsAt` günceller ve yeni bağlantı üretir. Koordinatör değişikliği `hostUserId`'yi günceller. Bu yazmalar hizmet masası servisinde yapılır ve AG'nin korumalı uçlarını kullanmaz (§6.4-2).
5. **Görüşmelerim (koordinatör):** Bugün ve yaklaşan görüşmeler. Satırda saat, hizmet, hasta adı, dil, tercüman ve **Join** (pencere açıkken) bulunur. Detay ve sonuç işaretleme de buradadır. AG "Toplantılar" listesinde de aynı görüşmeler rozetle görünür (§6.4-8).
6. **Ayarlar:** Ayarlar → Genel → "Online consultation booking" anahtarı (`serviceBookingEnabled`, yalnızca ADMIN). Kapalıyken tüm düğmeler talep formuna gider.

**Otomatik sonuç (süpürücü, 15 dk aralık):** `endsAt + 30 dk` geçmiş `SCHEDULED` kayıtlarda AG kayıtlarına bakılır:
- koordinatör katılmış ve en az bir misafir kabul edilmişse → `COMPLETED` (`outcomeSource: "auto"`);
- koordinatör katılmış, misafir yoksa → `NO_SHOW`;
- koordinatör hiç katılmamışsa durum değişmez, kayıt panelde "Needs review" olarak işaretlenir.

---

## 11. Görünüm (ziyaretçi; görsel kararlar ui-designer'da)

| Yer | Düğme / davranış |
|---|---|
| Header | "Book a consultation" → `/book-consultation` (hizmet seçimiyle başlar). `serviceBookingEnabled` kapalıyken `/request`'e gider (İş 2 kuralı). |
| Mega menü sağ paneli | "Book an online consultation" → `/book-consultation`. |
| `/specialties` kartları ve bölüm sayfaları | "Book" → `/book-consultation?service=<slug>` (yalnızca `bookable` listesindeyse), "Request" → `/request?service=<slug>`. |
| Find your treatment sonucu | Her önerilen hizmet için "Book an online consultation" (rezerve edilebilirse) ve "Request a consultation". Kırmızı bayrak ekranında **rezervasyon düğmesi yok**; acil yönlendirme aynen kalır. |
| Paket detay sayfası | "Book an online consultation" → `?package=<slug>`, ayrıca mevcut "Request this package". |
| Hesabım | "Online consultations" sekmesi: liste, Join ve Cancel. |

- **Rezervasyon sayfası:** 8 dil, RTL, Türkçe yok (ziyaretçi Türkçe taraması kapsar). Sayfa üst bilgisi seo-agent'ın kararıdır; öneri `noindex` (form ve kişisel adım). Structured data yok.
- **Düğme görünürlüğü** `GET /service-desks/bookable` ile belirlenir. Rezerve edilemeyen hizmette yalnızca "Request" görünür; ölü düğme olmaz.

---

## 12. Test listesi

### 12.1 Backend (Vitest + test DB, sıralı)

1. Migration: yalnızca ekleme (SQL'de `DROP`, `RENAME` ve `ALTER COLUMN` yok — statik test). Kısmi tekil indeks: aynı koordinatör ve başlangıçta iki `SCHEDULED` kayıt P2002 verir; `CANCELLED` + `SCHEDULED` birlikte bulunabilir.
2. Masa çözümü: uzmanlık eşlemesi, alt uzmanlık → üst uzmanlık, varsayılan masa, paket `relatedSpecialtyIds`, pasif masa, üyesiz masa → `SERVICE_NOT_BOOKABLE`. `serviceBookingEnabled=false` → 404.
3. `computeDeskSlots` (saf):
   - saat, süre ve DST (Europe/Istanbul ve hasta Europe/Berlin değişim haftası);
   - en erken rezervasyon, ufuk;
   - ara boşluk;
   - koordinatörün hizmet görüşmesi, **AG genel toplantısı** ve izni çakışması;
   - iki üyeden biri meşgulse slot açık, ikisi de meşgulse kapalı.
4. Slot yanıtında koordinatör kimliği ve sayısı yok.
5. Rezervasyon:
   - geçerli istek → `ConsultationRequest` + `CrmLead` + `ExternalMeeting` (`meet_`, `autoAdmitGuests=false`, genel başlık, `note=null`) + `ServiceConsultation`, tek işlemde;
   - yanıtta belirteç yok; DB'de düz belirteç yok;
   - kimlik alanı istenmiyor.
6. Rıza kuralları AH ile aynı (iletişim rızası zorunlu; mesaj varsa sağlık rızası); honeypot; oran sınırı; e-posta başına 2 gelecek görüşme; IP başına günlük sınır.
7. Otomatik atama: dil önceliği, gün yükü, round-robin. **Eşzamanlılık:** aynı slota iki paralel istek → iki üye varsa ikisi de farklı koordinatöre, tek üye varsa biri `SLOT_TAKEN`.
8. Doktor profilli kullanıcı → 403. Oturumlu hasta → `patientUserId` dolu. Misafir → hesap **açılmaz**.
9. `paidEnabled: true` → 422. Hiçbir yol `PENDING_PAYMENT` yazmaz (grep testi).
10. Hesaplı katılım: başkasının görüşmesi 404, iptal edilmiş 409/404, pencere öncesi 409 `opensAt`, koordinatör yokken `waiting`, koordinatör gelince `ready`; token `meet-guest:` kimlikli ve ekran paylaşımı yok (JWT çözülerek).
11. Ev sahibi: atanan koordinatör `host-token` alır ve adı `Patient Coordinator · <displayName>` olur; başka koordinatör ve ADMIN 404 alır; doktor unvanı hiçbir koşulda yok.
12. AG korumaları (§6.4-2): hizmete bağlı toplantıda AG düzenleme, iptal, bağlantı ve davet uçları 409; sınır sayacı hizmet toplantılarını saymıyor; yetki geri alma 409.
13. Misafir adı "Patient Coordinator X" → 422.
14. İptal: hasta (belirteçle veya portaldan) → durum `CANCELLED` ve `ExternalMeeting` iptal (belirteç null); slot hemen yeniden açılıyor; admin ve koordinatör bildirimi kuyrukta. Geçersiz belirteç tek tip 404.
15. Saat değişikliği ve yeniden atama: `ExternalMeeting` zamanı ve `hostUserId` güncelleniyor; eski bağlantı geçersiz; yeni bağlantı e-postada; hatırlatma damgaları sıfırlanıyor; olay anahtarları tekil.
16. Bağlantıyı yeniden gönder: her durumda 202; eşleşmede yalnızca kayıtlı adrese gidiyor; oran sınırı.
17. Hatırlatmalar: 24 saat ve 60 dk bantları; çift gönderim yok; 60 dk'da bağlantı yenileniyor; iptal edilmiş kayda gitmiyor.
18. Admin bildirimi ve koordinatör e-postası: içerikte ad, e-posta, telefon ve mesaj yok (fixture negatif testi + AC PII testi). E-posta hatası rezervasyonu bozmuyor.
19. RBAC: masa ve koordinatör uçları yalnızca ADMIN/MANAGER; koordinatör yalnızca kendi kayıtları; mesaj çözme yalnızca ADMIN + 2FA + audit; EDITOR koordinatör olmayan → 403.
20. Otomatik sonuç süpürücüsü: üç dal (`COMPLETED`, `NO_SHOW`, "Needs review").
21. **Regresyon:** mevcut `meeting-token`, booking, hatırlatma, otomatik kapanış, tercüman ve AG İş 3 testleri değişmeden geçer. `createMeetingToken` grant anlık görüntüsü değişmez.

### 12.2 Frontend birim testleri (Vitest + Testing Library)

1. Rezervasyon sihirbazı: hizmet ön seçimi, slot ızgarası (hasta dilimi + Istanbul satırı), rıza mantığı (mesaj → sağlık rızası), tercüman dili, hata eşlemeleri (`SLOT_TAKEN` → takvimi yenile), başarı ekranı.
2. Düğme görünürlüğü: `bookable` listesine göre "Book" ve "Request"; anahtar kapalıyken header `/request`'e gidiyor.
3. Find your treatment sonucu: iki düğme; kırmızı bayrakta rezervasyon düğmesi yok.
4. `GuestJoinFlow` enjeksiyonu: `skipName` + `joinFn` ile hesaplı akış; `purpose=service_consultation` metinleri.
5. Hesabım "Online consultations": liste, Join penceresi, iptal onayı.
6. Admin: masa formu (ücretli anahtarı kilitli), saat düzenleyici çakışma uyarısı, koordinatör atama, randevu listesi (baş harfli ad), detay eylemleri, "Görüşmelerim" görünürlüğü (`isServiceCoordinator`).
7. 8 dil sözlük anahtar eşitliği, RTL, ziyaretçi Türkçe taraması (`visitor-no-turkish`) yeni dosyaları kapsıyor.
8. `consultation-room.tsx`, `room/stage.tsx`, `room/control-bar.tsx` ve `room/participant-label.ts` için "değişmedi" denetimi (kırmızı çizgi git diff kontrolü, rapor adımı).

### 12.3 E2E (Playwright, headless, `--workers=1`, `saas_e2e`)

1. Admin masa oluşturur, saat girer, Gastroenterology'yi bağlar, bir EDITOR'ü koordinatör yapar (ev sahibi yetkisiyle birlikte). Ayar açılır.
2. Ziyaretçi `/specialties/gastroenterology` → "Book" → slot seçer → formu doldurur → onay ekranını görür. Admin bildirimi ve onay e-postası (yerel posta kutusu) gider; e-postada hizmet adı yok.
3. Koordinatör "Görüşmelerim" → Join → oda. Misafir (ayrı bağlam) e-postadaki bağlantıyla girer → bekleme → otomatik kabul. Ad etiketi "Patient Coordinator · …"; doktor unvanı yok; misafirde ekran paylaşımı düğmesi yok.
4. Hesaplı hasta portaldan Join → ad formu yok → odaya girer.
5. Aynı slotu ikinci ziyaretçi görmez (tek üyeli masa).
6. Hasta bağlantıdan iptal eder → slot yeniden açılır → koordinatör listesinde "Cancelled".
7. Admin saati değiştirir → eski bağlantı geçersiz ekranı, yeni bağlantı çalışıyor.
8. Find your treatment sonucunda "Book an online consultation" görünür; kırmızı bayrakta görünmez.
9. Paket sayfasından `?package=` ile rezervasyon.
10. Regresyon: mevcut consultation e2e paketi (doktor/hasta görüşmesi) ve AG İş 3 e2e paketi değişmeden yeşil.

(LiveKit gerektiren adımlar mevcut yerel kuruluma bağlıdır; kurulum yoksa 3, 4 ve 7 numaralı adımlar mevcut atlama kuralını izler.)

---

## 13. Tahmini iş büyüklüğü (AG İş 3 tamamlandıktan sonra)

| Katman | Dosya (yeni / değişen) | Satır (yaklaşık, test hariç) | Test satırı |
|---|---|---|---|
| OpenAPI kontratı (architect) | 0 / 1 | ~600 | — |
| Prisma + migration (db-agent) | 1 / 1 | ~180 | — |
| Backend: `service-desks.admin.routes.ts`, `service-consultations.routes.ts` (public + me), `coordinator.routes.ts`, `lib/service-slots.ts`, `lib/service-booking.ts` (atama), `lib/service-consultation-reminders.ts`, `lib/service-consultation-outcome.ts`, `service-consultation-email.ts`, şemalar, hatalar, bildirim türleri, `/users/me` alanı, `app.ts` kaydı | 10 / 6 | ~2.300 | ~1.800 |
| AG İş 3 uyarlamaları (§6.4) | 0 / 7 | ~200 | ~250 |
| Frontend: rezervasyon sihirbazı (4 adım), Hesabım sekmesi, hesaplı katılım sayfası, düğme entegrasyonları (header, mega menü, specialties, Find your treatment, paket), admin (masalar, saatler, koordinatörler, randevu listesi ve detay, Görüşmelerim, ayar), API istemcisi | ~18 / 8 | ~2.600 | ~1.000 |
| Sözlükler (8 dil ziyaretçi + admin TR/EN) | 9 / 3 | ~800 | (tamlık testi) |
| E2E | 1 / 0 | — | ~450 |
| **Toplam** | **~39 yeni / ~26 değişen** | **~6.700** | **~3.500** |

- **Süre (tek geliştirici akışı, sıralı test koşuları dahil):**
  - kontrat + migration: **0,5 gün**;
  - backend: **2,5–3 gün**;
  - AG uyarlamaları: **0,5 gün**;
  - frontend: **2,5–3 gün**;
  - e2e + güvenlik ve KVKK denetimi + düzeltmeler: **1 gün**.
- **Toplam yaklaşık 7–8 gün.** AG İş 3'ün tamamlanması bu sürenin dışındadır.
- Kapsam daraltma seçenekleri:
  - Faz A'da koordinatör izinleri ve otomatik sonuç süpürücüsü çıkarılırsa yaklaşık 1 gün azalır.
  - Hesaplı hasta katılımı çıkarılırsa (yalnızca e-posta bağlantısı) yaklaşık 0,5 gün azalır.
- **Ajan sırası (onaydan sonra release-coordinator'a):**
  1. AG İş 3'ün master'da tamamlanması;
  2. architect (openapi);
  3. db-agent (migration);
  4. backend-agent ∥ notification-agent (e-postalar, hatırlatmalar, bildirim türleri) ∥ integration-agent (AG uyarlamaları: `admitMeetingGuest`, host-token adı);
  5. ui-designer (slot ızgarası ve rezervasyon adımları) → frontend-agent;
  6. seo-agent (rezervasyon sayfası meta, `noindex`);
  7. security-agent → compliance-agent;
  8. qa-agent;
  9. documentation-agent.

---

## 14. Açık sorular (onay gerekli)

- **S1 — Koordinatör mesajı görebilsin mi?** Talep mesajı sağlık verisi olabilir. AH kuralında yalnızca ADMIN (2FA) çözebiliyor. Koordinatörün kendisine atanmış görüşmede mesajı görmesi görüşmeye hazırlığı kolaylaştırır. Öneri: **evet, yalnızca kendi kaydında, 2FA zorunlu ve her görüntüleme audit'li.** compliance-agent onayıyla.
- **S2 — Koordinatörlerin panel rolü:** EDITOR mı (öneri: içerik yetkisi var, ödeme ve kullanıcı yönetimi yok), MANAGER mı? Yetki rolden değil koordinatör profilinden gelir; soru yalnızca panelde başka neleri görecekleri.
- **S3 — Koordinatör kendi iznini girebilsin ve görüşme iptal edebilsin mi?** Öneri: izin evet, iptal hayır (yalnızca ADMIN/MANAGER).
- **S4 — Canlı tercüman:** Faz A'da tercüman ihtiyacı kaydedilir, dil uyumlu koordinatör öncelikli atanır, uyum yoksa admin işaretlenir. Paket AA tercümanının `meet_` odasına katılımı (yeni atama tablosu ve tercüman paneli uyarlaması) Faz B'ye mi kalsın?
- **S5 — E-posta doğrulaması (OTP):** Sahte rezervasyonla takvim doldurmaya karşı rezervasyon onayından önce e-posta kodu istensin mi? Öneri: bu turda hayır (oran sınırları + günlük sınır + saatlik uyarı); kötüye kullanım görülürse açılsın.
- **S6 — Misafire hesap açılsın mı?** Öneri: **hayır** (ücretsiz ön görüşme; veri minimizasyonu; mevcut provizyon rıza metni `v3`'e bağlı). Hesaplı kullanıcı yine portaldan katılır.
- **S7 — Koordinatör bazında çalışma saati:** Masa saatleri ortak, bireysel yokluk izinle girilir (öneri). Koordinatör başına ayrı haftalık saat gerekiyor mu?
- **S8 — Varsayılanlar:** Süre 30 dk, en erken rezervasyon 2 saat, ufuk 30 gün, oda sınırı 3 (koordinatör + hasta + 1 yakın). Uygun mu?
- **S9 — Masa ile menü grubu:** Masalar menü gruplarından (İş 1) bağımsız ve uzmanlık eşlemesiyle kuruluyor. Başlangıçta İş 1'deki dört gruba karşılık dört masa ve bir varsayılan masa mı açılsın, yoksa tek bir "General desk" mi?
- **S10 — CRM kanalı:** Hizmet randevuları mevcut `CONSULTATION_REQUEST` kanalıyla mı açılsın (öneri; enum migration'ı yok), yoksa raporlama için ayrı `SERVICE_CONSULTATION` kanalı mı (yalıtılmış `ALTER TYPE … ADD VALUE`)?
- **S11 — Etiket dili:** "Patient Coordinator" token adında İngilizce sabit (öneri, `participant-label.ts` değişmez). İzleyicinin dilinde gösterilmesi istenirse AG `meeting-room.tsx`'e küçük bir eşleme eklenir.
- **S12 — Bağlantı yenileme:** 60 dk hatırlatmasında yeni bağlantı üretilip eskisinin geçersiz kılınması öneriliyor (düz belirteç saklanmadığı için). Alternatif: bağlantıyı AES-GCM ile şifreli saklamak; bağlantı değişmez ama DB ve anahtar sızıntısında katılım bağlantıları açığa çıkar. Öneri: yenileme.
- **S13 — Bekleme kuralı:** Hasta, koordinatör odaya girene kadar bekler (`autoAdmitGuests=false`). Koordinatör geç kalırsa, örneğin 10 dk sonra hastaya "Your coordinator is running late; we will contact you" mesajı ve admin uyarısı gitsin mi?
- **S14 — Hukuk kontrol listesi:** `service-consultation-v1` rıza metinleri (8 dil), "This is not a medical examination" notu ve aydınlatma metnine "koordinatörle görüntülü ön görüşme" amacının eklenmesi (`docs/legal/` bu turda değişmez) hukuk onayına gider. Uygun mu?

---

## 15. Ek (2026-11-03): eski randevu arayüzünün birebir yeniden kullanımı ve hızlı ilk sürüm

Kullanıcı notu: eski doktor online randevu ekranının tarzı aynen geri istendi. Doktor yerine "hizmet" ve "Patient Coordinator" gelecek; doktor adı ve unvanı hiçbir yerde görünmeyecek.

### 15.1 Yeniden kullanılan parçalar
Takvim (`availability-calendar.tsx`, gün durumları, saat dilimi bandı, 12/24 saat tercihi), adım göstergesi (`booking-stepper-bar.tsx`), çift saat gösterimi (`dual-time.tsx`), bilgiler adımı (`booking-intake-step.tsx`), özet kartı (`booking-summary-card.tsx`), müsaitlik açıklaması ve sihirbaz iskeleti (`booking-wizard.tsx`). Bileşenler kopyalanmaz. Yalnızca geriye uyumlu opsiyonel prop'lar eklenir: dışarıdan slot kaynağı ve doktor alanlarını gizleyen mod. Doktor akışı aynen kalır. E-postalar mevcut kurumsal şablonla (`renderBrandedEmail`) ve AH talep e-postası deseniyle yazılır.

### 15.2 Süreye etkisi
| Kalem | §13 tahmini | Yeniden kullanım + hızlı kapsam |
|---|---|---|
| Ziyaretçi rezervasyon arayüzü | 2,5–3 gün (sıfırdan sihirbaz) | ~1 gün (mevcut bileşenler + adaptör) |
| Backend | 2,5–3 gün | ~1,5 gün (tek masa, eşleme/izin/sonuç süpürücüsü/portal yok) |
| Admin ekranları | (frontend içinde) ~1 gün | ~0,5 gün (tek masa ekranı, mevcut haftalık saat deseni) |
| AG uyarlamaları | 0,5 gün | ~0,3 gün (yalnız ad, amaç, bayrak) |
| E2E + güvenlik/KVKK | 1 gün | ~0,5–1 gün |
| **Toplam** | **7–8 gün** (AG İş 3 tamamlandıktan sonra) | **~3,5–4 gün**. AG İş 3'ün tamamı beklenmez; yalnız gereken kısmı tamamlanır. |

### 15.3 En hızlı canlıya alınabilecek ilk sürüm (HIZLI SÜRÜM — uygulanan kapsam)
- Tek genel masa. Admin koordinatörleri atar (EDITOR personel), haftalık saatleri ve tatil günlerini girer. Slot 30 dk, en erken 2 saat, en fazla 30 gün.
- Ödemesiz. Onay ve hatırlatma e-postaları (24 saat ve 60 dk) 8 dilde. Admin bildirimi kişisel veri içermez. Hasta yönetim bağlantısıyla iptal ve saat değişikliği yapar.
- Görüşme AG `meet_` odasında yapılır: koordinatör ev sahibi, hasta misafir, kayıt yok. Genel harici toplantı ekranları bayrakla kapalıdır.
- Koordinatör paneli: "Bugünkü görüşmelerim" ve "Görüşmeye katıl". Mesajı görmek için 2FA gerekir ve her görüntüleme audit'e yazılır.
- Sonraya kalanlar: birden fazla masa, hizmet→masa eşlemesi, koordinatör bazında saat ve izin, hesaplı hasta portal sekmesi, otomatik sonuç, admin ekranından saat değiştirme ve yeniden atama, harici toplantı misafir yönetimi, raporlama, ücretli seçenek.
- Bağlayıcı uygulama kontratı: dal `feat/ai3-coordinator-booking-nov03`. Sonuç ve testler `docs/prompts/2026-11-03-AI-IS3-HIZLI-RAPOR.md` içinde.
