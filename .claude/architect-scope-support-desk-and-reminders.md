# Architect — Kapsam Kararı: Erken Katılım Uyarısı · Randevu Hatırlatma E-postaları · Canlı Destek Masası

**Karar mercii:** architect · **Tarih:** 2026-09-16 · **Durum:** BAĞLAYICI
**Branş:** `feature/support-desk-and-reminders`
**Bu tur kod YAZILMADI.** Değişen dosyalar: bu doküman, `docs/architecture/openapi.yaml`,
`.claude/architect-scope-rbac-5-tier.md` (§12'ye TEK satır takip kalemi eklendi).

**İlgili bağlayıcı dokümanlar:**
- `.claude/architect-scope-rbac-5-tier.md` — **YÜRÜRLÜKTEDİR, REVİZE EDİLMEDİ.** §3'teki rol
  kararı o dokümanla ÇELİŞMEZ, onun §5.1 türetme kuralını UYGULAR (bkz. §3.2).
- `.claude/architect-scope-telehealth-template.md` [TCT] §9.7.6/§9.7.8 — katılım penceresi ve
  bildirim tetikleyicileri. §1 ve §2 bu dokümanın üstüne inşa eder.
- `.claude/compliance-notes-telehealth.md` — sağlık verisi/KVKK; §3.7 buna eskale edilir.

**Ajanlar arası çelişkide hakem sırası:** `openapi.yaml` → bu doküman → ilgili eski scope dokümanı.

---

## 0. Yönetici özeti — bir bakışta karar

| # | Konu | Karar | Gerekçe özeti |
|---|---|---|---|
| 1 | Erken katılım kontrolü nerede | **YALNIZCA FRONTEND** (uyarı modalı). Backend ENGELLEMEZ, yeni uç YOK | Modalın "Anladım, Odaya Katıl" butonu tanım gereği katılıma İZİN VERİR; backend reddi özelliği kendi kendine çelişkili kılar |
| 1b | Backend'de ne değişir | Sadece **audit metadata**: `earlyJoin`, `minutesBeforeStart` (SUNUCU saatinden) | İstemci saati manipüle edilse bile denetim izi doğru kalır |
| 2 | Worker teknolojisi | **Süreç-içi `setInterval` sweeper** (`lib/booking-expiry.ts` deseni), 5 dk | Projede BullMQ/Redis/pg-boss/node-cron **yok**; 5 dakikalık idempotent DB taraması için yeni altyapı gereksiz |
| 2b | Çift gönderim engeli | **Claim-first `updateMany`** (damgayı ÖNCE bas, sonra gönder) | Kuyruk yokluğunda tek-instance varsayımına GÜVENİLMEZ; DB koşullu yazımı çok-instance'ta da güvenlidir |
| 3 | Rol | **`SUPPORT_AGENT` EKLENMEZ.** `/admin/support/*` → `ROLES_ADMIN_MANAGER` | rbac-5-tier §5.1 türetmesi: destek masası 5 ADMIN-özel kategoriden hiçbirine girmez → normal panel operasyonu → MANAGER |
| 3b | Gerçek zamanlılık | **POLLING** (`?afterSeq=` artımlı). SSE/WebSocket **YOK** | Projede tek bir SSE/WS kullanımı yok; `import-progress-panel.tsx` mevcut bağlayıcı desen |
| 3c | Mesaj formatı | **DÜZ METİN** (HTML/Markdown saklanmaz, render edilmez) | "Zengin metin yok" kuralı, "temizle" kuralından güvenlidir; `sanitizeRichHtml` bu akışta KULLANILMAZ |

---

## 1. Talep 1 — Erken Katılım Güvenlik Onay Modalı

### 1.1 Mevcut durum tespiti (doğrulandı)

`backend/src/modules/telehealth/telehealth.livekit.routes.ts` satır 136-148:
2026-09-15'te integration-agent, `getBookingJoinWindow`/`isWithinJoinWindow` ile uygulanan
**10dk-önce / 15dk-sonra katılım penceresini TAMAMEN KALDIRDI.** Bugün geçerli tek şart:

```
status ∈ {SCHEDULED, IN_PROGRESS}  VE  (booking varsa) booking.paymentStatus === "PAID"
```

`openapi.yaml`'daki `POST /appointments/{id}/meeting-token` açıklaması bu değişiklikten sonra
**GÜNCELLENMEMİŞTİ** (hâlâ "katılım penceresi dışındaysa 409" diyordu). Bu tur bu **kontrat
kayması (drift) architect tarafından düzeltildi** — kod kazandı, metin koda uyduruldu.

`joinableFrom`/`joinableUntil` DTO alanları KALIR — artık bir KISIT değil, `JoinMeetingButton`'ın
"X dk içinde" / "Süresi Geçti" rozetlerini besleyen **bilgilendirici** alanlardır.

### 1.2 KARAR: kontrol saf frontend'dedir

- **Yeni uç AÇILMAZ.** `startsAt` istemciye zaten geliyor
  (`AppointmentBookingSchema.appointments[].startsAt`, `AppointmentSchema.startsAt`) — ek bir
  "erken mi" sorgusu ağa çıkmaya değmez.
- **Backend REDDETMEZ.** Gerekçe (tartışmaya kapalı):
  1. İstenen davranış bir **uyarıdır**, kısıt değildir — modal "Anladım, Odaya Katıl" seçeneği
     sunar. Backend reddederse bu buton çalışmaz; özellik kendi kendisiyle çelişir.
  2. Bir backend reddi, 2026-09-15'te **bilinçli olarak kaldırılan** pencere kısıtını geri
     getirirdi. Doktorun odayı önceden test edebilmesi ve geç kalınmış bir görüşmeye
     girilebilmesi o turun açık gereksinimiydi.
  3. "Kullanıcı saatini manipüle edip modalı atlarsa?" — **kabul edilen bir risktir.** Atladığında
     eriştiği şey, backend'in ZATEN herkese açık tuttuğu bir kaynaktır. Modal bir yetkilendirme
     sınırı değil, bir bilgilendirmedir; onu atlamak bir güvenlik ihlali üretmez.
- **Yine de KÖR kalmayız:** sunucu, mevcut `telehealth.meeting_token.issued` audit kaydına
  `metadata.earlyJoin: boolean` ve `metadata.minutesBeforeStart: integer` ekler (negatif =
  randevu saatinden sonra). **İstemci bu değerleri GÖNDERMEZ** — sunucu `startsAt` ile kendi
  saatinden hesaplar. Böylece "kaç kişi erken giriyor" ölçülebilir; ileride bir kısıt istenirse
  karar tahminle değil VERİYLE verilir.
- Eşik sabiti tek yerde yaşar: `EARLY_JOIN_WARNING_THRESHOLD_MINUTES = 10`. Frontend'de
  `frontend/src/lib/telehealth-format.ts` (veya yanına yeni bir sabit modülü), backend'de audit
  hesabı için `backend/src/modules/telehealth/lib/livekit.ts` yanında. İki tarafta da **10**;
  kopyalanmış sihirli sayı YASAK.

### 1.3 Modalın konumu — TEK bir yer

`JoinMeetingButton` (`frontend/src/components/site/telehealth/join-meeting-button.tsx`) projedeki
**TEK katılım girişidir** (doğrulandı — kullanan 4 dosya: `booking-list-view.tsx`,
`booking-summary-card.tsx`, `patient-hero-panel.tsx`, `doctor-console-patient-card.tsx`; hasta ve
doktor portalları dahil). Modal **YALNIZCA bu bileşene** eklenir; çağıran 4 dosyanın hiçbiri
değişmez, hasta/doktor için ayrı ayrı uygulanmaz.

**Davranış (bağlayıcı):**
- Tetik: `firstAppointment.startsAt - now > 10 dk` → `<a>`'nın varsayılan navigasyonu
  `preventDefault` ile durdurulur ve modal açılır. Aksi hâlde davranış **BUGÜNKÜYLE BİREBİR AYNI**
  (doğrudan navigasyon) — mevcut e2e testleri kırılmaz.
- Metin (kullanıcıya dönük, birebir):
  > Dikkat: Randevu saatinizden erken katılıyorsunuz. Görüşmeyi erken başlatıp sonlandırmanız
  > durumunda, asıl randevu saatinizde odaya yeniden giriş yapılamayabilir. Devam etmek istiyor
  > musunuz?
- Butonlar: **[Vazgeç]** (ikincil, modalı kapatır, navigasyon YOK) · **[Anladım, Odaya Katıl]**
  (birincil, `window.location.assign(href)` — `href` zaten mutlak/göreceli olarak hesaplanmış).
- Aynı randevu için oturum başına bir kez onaylandıktan sonra tekrar sorulmaz
  (`sessionStorage`, anahtar: `early-join-ack:<appointmentId>`). `localStorage` **YASAK** (paylaşılan
  cihazda randevu id'si kalıcı iz bırakır).
- Erişilebilirlik: mevcut `Dialog` primitifi kullanılır (yeni bir modal bileşeni İCAT EDİLMEZ),
  odak tuzağı + `Esc` = Vazgeç.
- ui-designer'a iş DÜŞMEZ — mevcut `Dialog` + `Button` tokenleri yeterlidir, yeni görsel dil yok.

---

## 2. Talep 2 — 1 Saat / 30 Dakika Hatırlatma E-postaları

### 2.1 KARAR: worker teknolojisi — süreç-içi `setInterval` sweeper

**Doğrulanmış tespit:** `backend/package.json` içinde `bullmq`, `pg-boss`, `node-cron`, `agenda`
**YOK**; Redis servisi de yok. Projede zamanlanmış işlerin TEK ve tutarlı deseni, `app.ts`'in
`onReady` kancasında kendi `try/catch`'i ile kaydedilen süreç-içi `setInterval` sweeper'larıdır —
**7 örnek:** `lib/booking-expiry.ts`, `lib/cart-retention.ts`, `lib/contact-retention.ts`,
`lib/intake-retention.ts`, `lib/recording-retention.ts`, `lib/scheduled-publish.ts`,
`modules/import/import.retention.ts`, `modules/reports/reports.retention.ts`.

**Karar:** `backend/src/lib/appointment-reminders.ts` — `lib/booking-expiry.ts` ile **BİREBİR AYNI
iskelet** (aynı kadans: `APPOINTMENT_REMINDER_SWEEP_INTERVAL_MS = 5 * 60 * 1000`, açılışta bir kez
çalışır, `timer.unref()`, `onClose`'da `clearInterval`).

**Neden BullMQ/pg-boss DEĞİL (gerekçe, bağlayıcı):**
1. BullMQ **Redis zorunludur** → yeni bir container, yeni env, yeni bir düşme modu, devops-agent'a
   yeni bir bakım yüzeyi. Bunların hiçbiri, 5 dakikada bir indeksli bir `findMany` çalıştıran bir
   iş için bedelini ödemez.
2. Kuyruğun asıl kazancı (yeniden deneme, gecikmeli iş, ölü-mektup) burada **zaten gereksizdir**:
   süpürücü doğası gereği idempotenttir ve bir tur kaçarsa bir sonraki tur aynı satırı yakalar
   (bkz. §2.3 geniş bant).
3. `node-cron` Redis gerektirmez ama `setInterval`'e göre **hiçbir şey eklemez** ve projeye
   9. bir zamanlama deseni sokar. Tutarlılık > çeşitlilik.
4. Bu bir "şimdilik böyle" değil, **kayıtlı bir sınırdır**: iş sayısı arttığında veya çok-instance
   yatay ölçekleme gerektiğinde tek bir kuyruk altyapısına geçiş, takip kalemi
   `chore/background-job-runtime` altında ve **tüm 9 sweeper birlikte** değerlendirilir.

### 2.2 KARAR: şema (db-agent'a devredilir)

`Appointment` modeline (satır ~2122) **iki nullable kolon**:

```prisma
/// Hatırlatma süpürücüsü damgası — "1 saat kaldı" e-postası gönderildi (veya bilinçli
/// olarak bastırıldı, bkz. çoklu-slot kuralı). NULL = henüz gönderilmedi.
/// Süpürücü BU alana koşullu `updateMany` ile önce YAZAR, sonra gönderir (claim-first).
reminded60mAt DateTime?
/// "30 dakika kaldı" e-postası damgası. Aynı disiplin.
reminded30mAt DateTime?
```

**Bağlayıcı kurallar:**
1. **Hiçbir DTO'da DÖNMEZ** (`AppointmentSchema`, `AppointmentBookingSchema`, admin şemaları —
   hiçbiri). Bu dâhilî süpürücü durumudur; "hatırlatma gönderildi mi" bir UI ihtiyacı olarak
   TALEP EDİLMEDİ. İstenirse takip kalemi: `feature/admin-reminder-visibility`.
2. **YENİ İNDEKS EKLENMEZ.** Süpürücü sorgusunun ana filtresi `status` + `startsAt`'tir ve
   `@@index([status, startsAt])` ZATEN VARDIR. `reminded*At IS NULL` yüksek seçicilikte bir
   post-filtredir. Spekülatif indeks açılmaz (rbac-5-tier §2.4 madde 4 ile aynı ilke) —
   ihtiyaç ÖLÇÜMLE kanıtlanırsa performance-agent açar.
3. Migration **`ALTER TABLE ... ADD COLUMN` (nullable, default YOK)** — kilit almayan, geri
   alınabilir, veri dokunuşu olmayan bir değişiklik. §2.4'teki enum migration'ı ile **AYNI
   dosyaya KONABİLİR** (ikisi de additive), ama §3'teki destek masası şemasıyla **KARIŞTIRILMAZ**.

### 2.3 KARAR: uygunluk ve bant (çift gönderim engeli)

**Uygunluk yüklemi (bağlayıcı) — "CONFIRMED/PAID" bu projede şu demektir:**
```
appointment.status === "SCHEDULED"
  AND (appointment.bookingId IS NULL OR booking.paymentStatus === "PAID")
```
Not: `Appointment.status` enum'ında `CONFIRMED` **YOKTUR** (`PENDING_PAYMENT | SCHEDULED |
IN_PROGRESS | COMPLETED | CANCELLED | NO_SHOW`); ödeme `AppointmentBooking.paymentStatus`'ta
yaşar. Yüklem, `meeting-token` ucunun katılabilirlik kuralıyla **BİLEREK AYNIDIR** — hatırlatma
alan bir hasta odaya kesinlikle girebilmelidir. `IN_PROGRESS` hariçtir (görüşme zaten başlamış).

**Bantlar (bağlayıcı):**

| E-posta | Koşul |
|---|---|
| 1 saat | `reminded60mAt IS NULL` AND `startsAt` ∈ `(now + 35dk, now + 65dk]` |
| 30 dakika | `reminded30mAt IS NULL` AND `startsAt` ∈ `(now + 5dk, now + 35dk]` |

- **Üst sınır** (65/35) = hedef + bir süpürme turu (5dk) + marj. Bir tur gecikirse e-posta
  KAYBOLMAZ, biraz geç gider.
- **Alt sınır** (35/5) zorunludur: onsuz, başlangıcına 10 dakika kala oluşturulan bir randevu
  **aynı turda HEM "1 saat kaldı" HEM "30 dakika kaldı"** e-postası alırdı — ikisi de yalan.
  Bantların dışında kalan (çok geç rezerve edilmiş) randevu **hiç hatırlatma almaz**; bu
  DOĞRUDUR — onay e-postası zaten katılım bağlantısını taşır.

**Claim-first (çift gönderim engeli, bağlayıcı desen):**
```
count = updateMany({ where: { id, reminded60mAt: null }, data: { reminded60mAt: now } })
if (count === 1) → e-postayı GÖNDER
```
Damga **gönderimden ÖNCE** basılır. Gerekçe: `booking-expiry.ts`'in "tek-instance varsayımı"
orada zararsızdı (silme idempotent), burada **DEĞİLDİR** — çift gönderim kullanıcıya görünür bir
hatadır. Koşullu `updateMany` tek bir satır kilidiyle yarışı DB'de çözer; iki instance aynı anda
çalışsa bile yalnızca biri `count === 1` alır. **Bedeli kabul edilmiştir:** SMTP hatasında e-posta
kaybolur (damga basılı kalır). Bu bilinçli bir tercihtir — bir hatırlatmanın KAYBOLMASI,
İKİ KEZ gitmesinden iyidir; ayrıca gönderim `app.log.error` ile mutlaka loglanır (sessiz
başarısızlık yok).

**Çoklu slot bastırması (bağlayıcı):** bir booking'de arka arkaya iki slot varsa (14:00 ve 14:30)
hasta 13:30'da bir, 14:00'te bir daha "30 dk kaldı" almamalıdır. Kural: bir randevu iddia
edildiğinde (`claim`), **aynı booking'in, iddia edilen randevudan sonraki 90 dakika içinde
başlayan** diğer randevuları da AYNI transaction içinde damgalanır — **ama onlar için e-posta
GÖNDERİLMEZ.** 90 dakikadan uzak bir slot (ör. başka bir gün) kendi hatırlatmasını AYRI alır.

### 2.4 KARAR: e-posta şablonları (mevcut altyapı — yeni mailer İCAT EDİLMEZ)

Kullanılan mevcut yol: `lib/mail.ts` (SMTP) ← `modules/email-templates/email-templates.service.ts
::sendTemplateEmail(app, purpose, to, vars)` ← tetikleyici
`modules/telehealth/lib/notifications.ts`. Yeni tetikleyiciler **aynı dosyaya** eklenir:
`triggerAppointmentReminderEmail(app, { appointment, kind: "60m" | "30m" })`.
`triggerAppointmentRescheduledEmail` ile **BİREBİR aynı best-effort disiplini** (tek `try/catch`,
çağıran akışı asla bozmaz, `app.log.error` her zaman çağrılır).

**İki YENİ `EmailTemplatePurpose` değeri:** `APPOINTMENT_REMINDER_60M`, `APPOINTMENT_REMINDER_30M`.
Tek bir `APPOINTMENT_REMINDER` + `minutes_left` değişkeni **REDDEDİLDİ**: konu satırları farklıdır
("Randevunuza 1 Saat Kaldı" / "Randevunuza 30 Dakika Kaldı"), admin ikisini ayrı ayrı
düzenleyebilmelidir, ve değişken setleri farklıdır (`join_link` yalnızca 30 dk'da).
Enum genişletmesi **geri alınamaz** (`ALTER TYPE ... ADD VALUE`) → `schema.prisma`'daki mevcut
kurala göre **izole migration**.

**Alıcılar** (`triggerAppointmentRescheduledEmail` deseniyle aynı): hasta (booking varsa
`booking.patientEmail`, yoksa `appointment.patientEmail`) **her zaman**; doktor **yalnızca
`DoctorProfile.userId` DOLUYSA** (DEMO doktorların çoğunda boştur → sessizce atlanır, hata DEĞİL).

**Değişken setleri** (`lib/email-variables.ts::SYSTEM_VARIABLES_BY_PURPOSE`'a eklenir):

| Değişken | 60M | 30M | Not |
|---|:-:|:-:|---|
| `recipient_name` | ✔ | ✔ | Hastaya hasta adı, doktora doktor adı |
| `booking_number` | ✔ | ✔ | Booking yoksa `APT-<id ilk 8 hex>` (mevcut desen) |
| `doctor_name` | ✔ | ✔ | `DoctorProfile.title + fullName` |
| `slot_summary` | ✔ | ✔ | `DD.MM.YYYY HH:mm`, doktorun IANA diliminde (`formatSlotsSummary`) |
| `join_link` | ✖ | ✔ | bkz. §2.5 |

**Sızma yasağı (§9.7.5 madde 8 aynen geçerli):** uzmanlık adı, şikâyet/intake notu, epikriz,
belge adı bu e-postalarda **ASLA** yer almaz.
`prisma/seed.ts`'e iki varsayılan şablon (TR, `BLOCKS` modu) eklenir — **notification-agent'ın
sahası**; backend-agent şablon İÇERİĞİNİ yazmaz, yalnızca tetikleyiciyi bağlar.

### 2.5 KARAR: 30 dakika e-postasındaki katılım bağlantısı — **token ROTATE EDİLMEZ**

Süpürücü ham `accessToken`'ı bilemez (yalnızca hash saklanır). Üç seçenek değerlendirildi:

| Seçenek | Karar |
|---|---|
| `resendBookingAccessLink` gibi token'ı ROTATE et | **REDDEDİLDİ.** Onay e-postasındaki bağlantı ANINDA ölürdü. Çok günlü bir booking'de hasta, Pazartesi'nin hatırlatması yüzünden Çarşamba randevusunun onay bağlantısını kaybederdi. Üstelik "bağlantım çalışmıyor" durumunda ürün içinde bir kurtarma yolu YOK (`resend-link` ucunu yalnızca `booking-wizard.tsx` çağırıyor — doğrulandı). |
| Ham token'ı DB'de sakla | **REDDEDİLDİ.** "HAM DEĞER SAKLANMAZ" bağlayıcı güvenlik kuralını ihlal eder. |
| Ayrı, kalıcı bir "hatırlatma token'ı" kolonu | **REDDEDİLDİ.** İkinci bir sır yüzeyi + şema borcu; kazanç marjinal. |

**Karar:** `join_link` **token'sız derin bağlantıdır**:
- Hastaya, booking'e bağlıysa: `{FRONTEND_URL}/{varsayılan dil}/patient/bookings/{bookingId}`
- Hastaya, booking'siz (deprecated tekil randevu): `{FRONTEND_URL}/{varsayılan dil}/patient/appointments`
- Doktora: `{FRONTEND_URL}/{varsayılan dil}/doctor`

Dil segmenti `getLocaleSet(app).default.code` ile çözülür (`buildMagicLink` ile AYNI kaynak).

**Misafir hasta boşluğunu kapatan ZORUNLU frontend eki (frontend-agent, bağlayıcı):**
`/{lang}/patient/bookings/{bookingId}` sayfası, geçerli bir `?t=` ve sahip oturumu OLMADAN
açıldığında bugün ne gösteriyorsa göstersin — ek olarak **"Bu bağlantıya erişmek için onay
e-postanızdaki bağlantıyı kullanın veya yeni bir bağlantı isteyin"** durumunu ve
`POST /appointments/bookings/{bookingId}/resend-link` ucunu çağıran bir butonu render eder.
Bu **var olan bir ucu** kullanır (yeni kontrat yüzeyi YOK), misafiri çıkmazda bırakmaz ve
hiçbir mevcut bağlantıyı GEÇERSİZ KILMAZ.

### 2.6 KARAR: yeniden planlama damgaları sıfırlar

`PATCH /admin/telehealth/appointments/{id}/reschedule`, randevunun `reminded60mAt` ve
`reminded30mAt` alanlarını **aynı transaction içinde `null`'lar** (kontrata yazıldı). Aksi hâlde
saati ileri alınan randevu bir daha ASLA hatırlatma almaz — sessiz bildirim kaybı.
`cancel` akışında sıfırlama GEREKMEZ (`status ≠ SCHEDULED` zaten uygunluk yüklemini düşürür).

---

## 3. Talep 3 — Canlı Destek Yönetim Masası ve Temsilci Atama

### 3.1 Önceki kararın bilinçli olarak tersine çevrilmesi

`frontend/src/components/site/live-chat-widget.tsx` satır 67-68:
> "İSTEMCİ TARAFLI MOCK … Yeni bir backend/websocket altyapısı İCAT EDİLMEDİ (görev talimatı,
> bağlayıcı)."

Bu not 2026-09-15'te **doğruydu** (o turun talimatı gereği). **BU DOKÜMANLA YÜRÜRLÜKTEN
KALKAR** — `liveChatProvider = "internal"` modu artık gerçek, kalıcı, sunucu tarafı bir sohbet
sistemidir. `SiteSettings.liveChatEnabled` / `liveChatProvider` / `liveChatScriptId`
mekanizmasının KENDİSİNE ve `crisp`/`tawkto` dallarına **DOKUNULMAZ**.

> **Düzeltme (tespit):** aynı dosyanın 17-21. satırlarındaki "backend `toSiteSettingsDto`/
> `SiteSettingsSchema`/openapi bu alanları HENÜZ TAŞIMIYOR" notu **ARTIK YANLIŞTIR** — alanlar
> `schemas/entities.ts:838-840`, `mappers/index.ts:429-431` ve `openapi.yaml`'da MEVCUTTUR.
> frontend-agent bu yorumu siler; `=== true` katı kontrolü KALIR (savunma amaçlı, zararsız).

### 3.2 KARAR: rol — `SUPPORT_AGENT` EKLENMEZ, `/admin/support/*` = ADMIN + MANAGER

`.claude/architect-scope-rbac-5-tier.md` §5.1 türetme kuralı: *MANAGER = ADMIN'in tüm yetkileri,
EKSİ beş kategori* — (a) ayrıcalık yükseltme yüzeyi, (b) kimlik bilgisi yüzeyi, (c) keyfi kod
yürütme, (d) site-geneli kill switch, (f) denetim izi.

**Destek masası bu beşten HİÇBİRİNE girmez** → kural mekanik olarak `ADMIN, MANAGER` verir.
Ek olarak §5.3 satır 4 **birebir emsaldir**: iletişim formu gönderimleri (ziyaretçi adı/e-postası/
mesajı) `A, M`'dir ve EDITOR oradan **"ziyaretçi PII'si, EDITOR kapsamı dışı"** gerekçesiyle
çıkarılmıştır. Destek sohbeti aynı veri sınıfıdır → aynı eşik. Tutarlılık bedava gelir.

**6. enum değeri neden REDDEDİLDİ (bağlayıcı gerekçe):**
1. `SUPPORT_AGENT`, EDITOR'den bile DAR bir rol olurdu; panel kapısını geçebilmesi için
   `PANEL_ROLES`'a eklenmesi gerekirdi — bu, **yalnızca `requirePanelAccess()` taban çizgisiyle
   korunan her `/admin/*` ucunun** yüzeyini sessizce genişletir. rbac §4.3 istisna listesinin
   genişletilemez olması ve §4.4 zorlama testinin varlığı, bu kapının ne kadar hassas olduğunun
   kanıtıdır.
2. `ALTER TYPE ... ADD VALUE` **geri alınamaz**; izole bir migration borcu doğurur.
3. 21 modüllük §5.3 tablosunun tamamı yeni rol için **yeniden triyaj** edilmek zorunda kalırdı
   (rbac §5.4 tam da bu triyajı bir daha yaşamamak için sabitleri getirmişti).
4. Bugün işi **yalnızca destek** olan tek bir kullanıcı bile yok. Bu, rbac §3.2 madde 3'te
   açıkça reddedilen **spekülatif esnekliktir**.
5. Alternatif "ADMIN/MANAGER'a yetki bayrağı" da **REDDEDİLDİ**: rbac §3 tüm `User.canX`
   bayraklarını kaldırdı ve §1.7 "ikinci bir bayrak eklenmeden ÖNCE architect'e eskale edilir"
   kuralını yürürlükte bıraktı. Eskalasyon yapıldı, cevap: **bayrak eklenmiyor.**

**Bu karar rbac-5-tier'i REVİZE ETMEZ, TEYİT EDER.** Gerçek bir "yalnızca destek" personeli
ihtiyacı doğarsa takip kalemi: **`feature/rbac-support-agent-role`** (rbac §12 tablosuna eklendi).

**Atama kısıtı:** `assignedAgentId` yalnızca `status = ACTIVE`, `deletedAt IS NULL` ve
`role ∈ {ADMIN, MANAGER}` bir `User`'a işaret edebilir; aksi hâlde **422**.

**Yeni uç gerekçesi — `GET /admin/support/agents`:** atama dropdown'ı `GET /admin/users`'ı
KULLANAMAZ (rbac §5.3 satır 21: o uç ADMIN-only, MANAGER `GET`'te bile 403 alır). Bu yüzden
`{ id, name, role }` döndüren, **e-posta DÖNDÜRMEYEN**, sayfalamasız, filtresi sunucuda SABİT
dar bir uç açılır. Bu, "MANAGER kullanıcı listesini göremez" kuralının **ihlali değil**,
minimum-ifşa ile korunmuş bir istisnasıdır.

### 3.3 KARAR: gerçek zamanlılık — POLLING

**Doğrulanmış tespit:** backend kaynak ağacında `text/event-stream`, `EventSource`, `WebSocket`
veya bir ws eklentisi **SIFIR kez** geçiyor. Frontend'deki tek "realtime" deneyimi
`import-progress-panel.tsx`'tir ve dosya kendi yorumunda şöyle der: *"realtime altyapı
(SSE/WebSocket) YOK — uç 2 saniyede bir poll edilir."*

**Karar: POLLING.** Gerekçe:
1. **Tutarlılık:** SSE eklemek, projenin ikinci bir taşıma modeli ve ilk uzun-ömürlü bağlantı
   yüzeyi demektir (Fastify'da ayrı bir eklenti, reverse-proxy/timeout/buffering ayarları —
   devops-agent'a yeni bir yüzey).
2. **Ölçek gerçeği:** eşzamanlı sohbet sayısı onlarca mertebesindedir; 5 saniyede bir indeksli
   `WHERE sessionId = ? AND seq > ?` sorgusu ihmal edilebilir bir yüktür.
3. **Artımlı çekim zorunludur:** `?afterSeq=` ile yalnızca yeni mesajlar taşınır — poll'ün asıl
   maliyeti (tam diziyi tekrar tekrar indirmek) yapısal olarak ortadan kalkar. `seq`,
   `createdAt` yerine kullanılır (aynı milisaniyede iki mesaj olabilir).
4. Ölçümle ihtiyaç kanıtlanırsa takip kalemi: `feature/support-chat-sse`.

**Bağlayıcı kadanslar:** ziyaretçi paneli açıkken **5 sn**, kapalıyken poll **YOK**; admin oturum
listesi **15 sn**; admin açık sohbet dizisi **5 sn**. Her iki tarafta da **10 dakika
etkisizlikten sonra poll DURUR** (kullanıcı etkileşimiyle yeniden başlar) — açık bırakılmış bir
sekmenin sonsuza dek istek üretmesi engellenir.

### 3.4 Şema taslağı (db-agent'a devredilir — alan/ilişki taslağıdır, son söz db-agent'ındır)

```prisma
enum SupportSessionStatus { PENDING ANSWERED CLOSED }   // sıra bağlayıcı
enum SupportMessageSenderType { VISITOR AGENT }

model SupportChatSession {
  id              String  @id @default(uuid())
  seq             Int     @unique @default(autoincrement())   // cursor anahtarı
  status          SupportSessionStatus @default(PENDING)
  visitorName     String?          // BEYAN, doğrulanmamış
  visitorEmail    String?          // BEYAN, doğrulanmamış
  visitorUserId   String?          // oturum açıksa; Cart.siteUserId deseni
  accessTokenHash String  @unique  // SHA-256; HAM DEĞER SAKLANMAZ
  assignedAgentId String?
  assignedAt      DateTime?
  closedAt        DateTime?
  closedById      String?
  lastMessageAt        DateTime?
  lastVisitorMessageAt DateTime?
  lastAgentMessageAt   DateTime?
  messageCount    Int     @default(0)   // 200 üst sınırını O(1) kontrol için
  pageUrl         String?  // bağlam; DOĞRULANMAZ
  locale          String?
  ipAddress       String?  // 30 gün sonra null
  userAgent       String?  // 30 gün sonra null
  piiRedactedAt   DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  visitorUser   User? @relation("SupportVisitor", fields: [visitorUserId],   references: [id], onDelete: SetNull)
  assignedAgent User? @relation("SupportAgent",   fields: [assignedAgentId], references: [id], onDelete: SetNull)
  closedBy      User? @relation("SupportCloser",  fields: [closedById],      references: [id], onDelete: SetNull)
  messages      SupportChatMessage[]

  @@index([status, seq])        // liste + sekme filtresi
  @@index([assignedAgentId])    // "bana atananlar"
  @@index([createdAt])          // saklama süpürücüsü
  @@map("support_chat_sessions")
}

model SupportChatMessage {
  id           String @id @default(uuid())
  seq          Int    @unique @default(autoincrement())  // ?afterSeq= anahtarı (global monoton)
  sessionId    String
  senderType   SupportMessageSenderType
  senderUserId String?                    // VISITOR'da null
  /// Gönderim ANINDAKİ ad SNAPSHOT'ı (OrderItem.productTitle disiplini) — temsilci
  /// silinse de "kim yanıtladı" kaydı bozulmaz. E-POSTA ASLA YAZILMAZ.
  senderDisplayName String?
  /// DÜZ METİN, en fazla 2000 karakter. HTML/Markdown ne saklanır ne render edilir.
  body         String   @db.Text
  createdAt    DateTime @default(now())

  session    SupportChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  senderUser User?              @relation("SupportMessageSender", fields: [senderUserId], references: [id], onDelete: SetNull)

  @@index([sessionId, seq])
  @@map("support_chat_messages")
}

model SupportReplyTemplate {
  id          String   @id @default(uuid())
  seq         Int      @unique @default(autoincrement())
  title       String
  body        String   @db.Text   // düz metin, <=2000
  sortOrder   Int      @default(0)
  isActive    Boolean  @default(true)
  usageCount  Int      @default(0)
  createdById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  createdBy User? @relation("SupportTemplateAuthor", fields: [createdById], references: [id], onDelete: SetNull)

  @@index([isActive, sortOrder])
  @@map("support_reply_templates")
}
```

Notlar: (1) `SupportChatMessage.seq` **global** autoincrement'tır — oturum içinde de monoton
artar, `?afterSeq=` için yeterlidir; oturum-başı sayaç GEREKMEZ. (2) `messageCount` denormalize
sayaçtır, mesaj ekleme ile **aynı transaction'da** artar. (3) `User`'a üç yeni ters ilişki adı
eklenir — db-agent bunları `User` modeline yazar.

### 3.5 Uç listesi (tamamı `openapi.yaml`'a yazıldı)

**Ziyaretçi (PUBLIC, `security: []`, `liveChatEnabled && provider==="internal"` değilse 404):**
- `POST /support/sessions` — oturum + İLK MESAJ birlikte. `accessToken` **bir kez** döner.
  3/dk/IP.
- `GET /support/sessions/{sessionId}/messages?t=&afterSeq=` — poll. 60/dk/IP.
- `POST /support/sessions/{sessionId}/messages?t=` — mesaj. 10/dk/IP.

**Yönetim (`ADMIN` veya `MANAGER`):**
- `GET /admin/support/sessions` — cursor, `status`/`assignedAgentId`(`me`|`unassigned`|uuid)/`q`
  filtreleri, `meta.counts` sekme rozetleri.
- `GET|PATCH|DELETE /admin/support/sessions/{sessionId}`
- `GET|POST /admin/support/sessions/{sessionId}/messages`
- `PATCH /admin/support/sessions/{sessionId}/assign`
- `GET /admin/support/agents`
- `GET|POST /admin/support/templates`, `PATCH|DELETE /admin/support/templates/{templateId}`

**Kontrata yazılmış davranış kuralları (özet):** `ANSWERED` **türev** durumdur, `PATCH` ile elle
set edilemez (422); temsilci yanıt gönderince oturum **ATANMAMIŞSA gönderene otomatik atanır**
("yanıtlayan sahiplenir"), başkasına atanmışsa sessiz devralma YOK; ziyaretçi yeni mesaj
yazınca `ANSWERED → PENDING`; `GET` uçları **yan etkisizdir** (okundu işaretlemez);
liste yanıtı mesaj gövdesi taşımaz (`lastMessagePreview`, 120 karakter).

### 3.6 Güvenlik sınırları (security-agent bunları DENETLER, backend-agent UYGULAR)

1. **Ziyaretçi token'ı** `lib/tokens.ts::generateOpaqueToken` + `hashToken`; karşılaştırma
   **`timingSafeEqualHex`** (`telehealth.livekit.routes.ts` disiplini, düz `===` YASAK).
   Yanlış/eksik token → **404** (varlık sızdırılmaz).
2. **Ziyaretçi yüzeyi `senderUserId` ve personel e-postası DÖNDÜRMEZ** — yalnızca
   `senderDisplayName`.
3. **Düz metin zorunlu:** gövde depolanmadan önce HTML etiketleri temizlenmez, **reddedilir/
   kaçırılır ve istemci `textContent` olarak basar**. XSS yüzeyi yapısal olarak kapalıdır.
4. **Kötüye kullanım sınırları:** 3 oturum/dk/IP, 10 mesaj/dk/IP, 60 poll/dk/IP,
   oturum başına 200 mesaj (409), mesaj başına 2000 karakter (422). Yeni sabitler
   `lib/rate-limit.ts`'e eklenir (`SUPPORT_SESSION_CREATE_RATE_LIMIT`,
   `SUPPORT_MESSAGE_RATE_LIMIT`, `SUPPORT_POLL_RATE_LIMIT`).
5. **Audit metadata'ya mesaj İÇERİĞİ veya ziyaretçi adı/e-postası ASLA yazılmaz**
   (`contact.submission_status_change` disiplini). Eylemler: `support.session_status_change`,
   `support.session_assigned`, `support.message_sent`, `support.session_delete`.
6. `/admin/support/*` plugin'i `requirePanelAccess()` + `requireSiteRole(...ROLES_ADMIN_MANAGER)`
   ile korunur ve **rbac §4.4 route-tablosu zorlama testinin kapsamına girer**.

### 3.7 KVKK — compliance-agent'a İŞARETLENMİŞTİR (architect karar VERMEZ)

Ziyaretçi mesajları serbest metindir ve **isim, e-posta ve sağlık anlatımı** içerebilir; bir
telesağlık sitesinde bu, KVKK md.6 **özel nitelikli kişisel veri** riski demektir.
Bu, compliance-agent'ın alanıdır ve nihai kararı ONA aittir. Architect'in ÖNERDİĞİ (onaya tabi)
başlangıç noktası:

- `ipAddress`/`userAgent` **30 gün** sonra `null` + `piiRedactedAt` — `ContactSubmission`
  §10.16.10 ile BİREBİR aynı.
- `CLOSED` oturumlar **180 gün** sonra kalıcı silinir (mesajlar `Cascade`).
- Widget'ta, ilk mesaj gönderilmeden önce görünür bir uyarı: **"Lütfen sağlık durumunuza ilişkin
  ayrıntı paylaşmayın; tıbbi konular için randevu oluşturun."**
- `DELETE /admin/support/sessions/{id}` veri sahibi silme talebinin karşılığıdır.
- Saklama süpürücüsü `lib/support-retention.ts` olarak, `contact-retention.ts` ile aynı
  saatlik kadansta kurulur (compliance-agent onayından SONRA).

---

## 4. Ajan iş bölümü

Sıra: **db-agent → backend-agent (+ notification-agent şablon içerikleri) → frontend-agent
(+ ui-designer yalnızca §4.4 madde 5) → security-agent → compliance-agent → qa-agent →
code-quality-agent → documentation-agent → devops-agent/observability-agent.**
Üç bağımsız parça olduğu için ayrıntılı sıralama/bağımlılık planı **release-coordinator**'a
devredilir; aşağıdaki listeler **kapsam sınırıdır, takvim değildir.**

> **Paralelleştirme ipucu (release-coordinator için):** Talep 1 (erken katılım) DB'ye hiç
> dokunmaz ve tamamen frontend'dir — db-agent'ı BEKLEMEZ, ilk günden paralel gidebilir.

### 4.1 db-agent — üç AYRI migration (karıştırılmaz)

| # | Migration | İçerik | Not |
|---|---|---|---|
| M1 | `add_appointment_reminder_stamps` | `Appointment.reminded60mAt`, `reminded30mAt` (nullable, default YOK) | **İndeks EKLEME** (§2.2 madde 2) |
| M2 | `add_appointment_reminder_email_purposes` | `EmailTemplatePurpose` += `APPOINTMENT_REMINDER_60M`, `APPOINTMENT_REMINDER_30M` | `ALTER TYPE ... ADD VALUE` → **İZOLE**, tek başına |
| M3 | `add_support_chat` | `SupportSessionStatus`, `SupportMessageSenderType` enumları + `SupportChatSession`, `SupportChatMessage`, `SupportReplyTemplate` tabloları + `User`'a 4 ters ilişki | §3.4 taslağı. Yeni tablo → geri alınabilir |

**YAPMA:** guard, iş mantığı, DTO, süpürücü kodu. **`SiteRole` enum'ına DOKUNMA** (§3.2).
`///` yorumlarında bu dokümana referans ver.

### 4.2 backend-agent

1. `lib/appointment-reminders.ts` — sweeper (§2.1/§2.3): `runAppointmentReminderSweep(app)` +
   `registerAppointmentReminderSweeper(app)`. `booking-expiry.ts` iskeleti birebir.
2. `app.ts` `onReady` — kendi `try/catch`'i ile kayıt (mevcut 8 kaydın desenine uy).
3. `modules/telehealth/lib/notifications.ts` — `triggerAppointmentReminderEmail` (§2.4).
   **Şablon İÇERİĞİNİ YAZMA** (notification-agent).
4. `lib/email-variables.ts` — iki yeni `SYSTEM_VARIABLES_BY_PURPOSE` girdisi (§2.4 tablosu).
5. `telehealth.livekit.routes.ts` — audit `metadata`'ya `earlyJoin` + `minutesBeforeStart`
   (§1.2). **Başka HİÇBİR ŞEY değişmez; katılım reddi EKLEME.**
6. Reschedule akışında `reminded60mAt`/`reminded30mAt` → `null` (§2.6).
7. **Yeni modül `modules/support/`**: `support.routes.ts` (admin), `support.public.routes.ts`
   (ziyaretçi — `telehealth.notifications.routes.ts`'in ayrık-dosya desenine uy),
   `support.schemas.ts`, `support.service.ts`; `app.ts`'e kayıt.
8. `lib/rate-limit.ts` — üç yeni sabit (§3.6 madde 4).
9. `schemas/entities.ts` + `mappers/index.ts` — Support DTO'ları, **`openapi.yaml`'a birebir
   uyarak** (kontrat kazanır; drift yok).
10. Unit test (zorunlu kapsam): sweeper bant sınırları (35/65 ve 5/35 kenarları), claim-first'ün
    ikinci turda hiç e-posta üretmemesi, çoklu-slot bastırması (90 dk), `PENDING_PAYMENT`/
    ödenmemiş booking'in hatırlatma ALMAMASI, reschedule'ın damgaları sıfırlaması;
    support: yanlış token → 404, `CLOSED` oturuma mesaj → 409, 201. mesaj → 409,
    `ANSWERED` elle set → 422, atanmamış oturuma yanıt → otomatik atama, başkasına atanmışsa
    atamanın DEĞİŞMEMESİ, `agentId` = EDITOR/CUSTOMER/pasif kullanıcı → 422,
    `liveChatEnabled=false` iken public uçlar → 404.
11. **YAPMA:** şema tasarımı (§4.1'i tüket), e-posta şablon metni, görsel karar, meta/SEO.

### 4.3 notification-agent

`prisma/seed.ts`'e iki yeni `EmailTemplate` satırı (`APPOINTMENT_REMINDER_60M`,
`APPOINTMENT_REMINDER_30M`; TR, `BLOCKS` modu, `isActive: true`). Konu satırları:
"Randevunuza 1 Saat Kaldı" / "Randevunuza 30 Dakika Kaldı". §2.4 sızma yasağına uy.
**Tetikleyici kodunu YAZMA** (backend-agent).

### 4.4 frontend-agent

1. **Erken katılım modalı** — YALNIZCA `join-meeting-button.tsx` (§1.3). Çağıran 4 dosya
   DEĞİŞMEZ. `sessionStorage` onay hatırlama.
2. `/{lang}/patient/bookings/{bookingId}` — token'sız/yetkisiz durumda "yeni bağlantı iste"
   durumu + `resendBookingLink()` butonu (§2.5). **Var olan ucu kullanır.**
3. **Widget'ı gerçek backend'e bağla** (`live-chat-widget.tsx`): `InternalChatPanel`'in mock'u
   (`AUTO_REPLY_TEXT`, `setTimeout`) **SİLİNİR**; `POST /support/sessions` → `sessionStorage`
   token → 5 sn `?afterSeq=` poll (panel kapalıyken poll YOK, 10 dk etkisizlikte durur).
   Yanlış/eksik token (404) → "yeni sohbet başlat" durumu. `isConsultationRoute` kısıtı ve
   `crisp`/`tawkto` dalları **DEĞİŞMEZ**. Satır 17-21'deki eskimiş "backend wiring eksik" notu
   silinir (§3.1).
4. **Admin destek masası** — `app/admin/support/page.tsx` (iki panelli: sol oturum listesi +
   sekme rozetleri/filtre/arama, sağ sohbet dizisi + yanıt kutusu + şablon seçici + atama
   dropdown'ı) ve `app/admin/support/templates/page.tsx` (şablon CRUD).
   `components/admin/support/*`. Sidebar (`components/admin/sidebar.tsx`): **"Canlı Destek"
   öğesi ADMIN ve MANAGER'a görünür, EDITOR'e GÖRÜNMEZ** (rbac §8.2 tablosuna yeni satır).
   Atama dropdown'ı `GET /admin/support/agents`'ı kullanır — `/admin/users` **KULLANILMAZ**.
5. `lib/api/types.ts` + `lib/api/support.ts` — kaynak `openapi.yaml`.
6. **YAPMA:** görsel/stil kararı (ui-designer), meta tag/SEO (seo-agent), yeni realtime taşıma
   (SSE/WS — §3.3 bağlayıcı).

### 4.5 ui-designer

Yalnızca **admin destek masası** için: iki panelli düzen, sohbet baloncuğu (ziyaretçi/temsilci)
ve `PENDING`/`ANSWERED`/`CLOSED` rozet tonları (mevcut `Badge` tone tokenleri:
`warning`/`success`/`neutral` — yeni renk İCAT EDİLMEZ). Widget'ın görsel dili ve erken katılım
modalı **DEĞİŞMEZ** (mevcut `Dialog` tokenleri yeterli).

### 4.6 security-agent

1. Ziyaretçi token'ının **sabit zamanlı** karşılaştırıldığını ve yanlış token'ın **404**
   (403/401 değil) döndürdüğünü doğrula (IDOR/numaralandırma).
2. Ziyaretçi yüzeyinin `senderUserId`/personel e-postası **sızdırmadığını** doğrula.
3. **XSS:** ziyaretçi mesajının hiçbir yüzeyde HTML olarak render edilmediğini (admin paneli
   dahil — `dangerouslySetInnerHTML` sıfır kez) doğrula.
4. `/admin/support/*`'ın **rbac §4.4 route-tablosu zorlama testine** dahil olduğunu; EDITOR/
   CUSTOMER/USER'ın hepsinde **403** aldığını doğrula.
5. **Ayrıcalık yükseltme:** `PATCH .../assign` ile ADMIN/MANAGER dışı bir kullanıcının
   atanamadığını; atamanın hedefe **yeni yetki VERMEDİĞİNİ** doğrula.
6. `GET /admin/support/agents`'ın e-posta/`status`/`lastLoginAt` **döndürmediğini** ve
   filtresinin **istemciden gelmediğini** doğrula.
7. **Kötüye kullanım:** 3/10/60 dk-limitlerinin, 200 mesaj ve 2000 karakter sınırlarının
   gerçekten uygulandığını; `liveChatEnabled=false` iken public uçların **404** verdiğini
   doğrula.
8. Audit metadata'sının mesaj içeriği/ziyaretçi PII'si **taşımadığını** doğrula.
9. §1.2'yi **onayla veya itiraz et**: erken katılımın backend'de engellenmemesi bilinçli bir
   karardır; security-agent aynı fikirde değilse architect'e **eskale eder**, tek taraflı
   kısıt EKLEMEZ.

### 4.7 compliance-agent

§3.7'nin tamamı (saklama süreleri, özel nitelikli veri riski, widget uyarı metni, aydınlatma
metni/çerez politikası etkisi, `DELETE` ucunun veri sahibi hakkı olarak konumlandırılması).
Çıktı: `.claude/compliance-notes-support-desk.md` + `lib/support-retention.ts` için bağlayıcı
süreler. **Hatırlatma e-postaları da değerlendirilir** — e-posta gövdesinde sağlık verisi
OLMADIĞI (§2.4 sızma yasağı) teyit edilir.

### 4.8 qa-agent (e2e — kritik akışlar)

**Talep 1:**
1. Randevusuna 2 saat kalan hasta "Toplantıya Katıl" → **modal açılır**, metin birebir doğrulanır.
2. [Vazgeç] → sayfada kalınır, `/consultation/...`'a **gidilmez**.
3. [Anladım, Odaya Katıl] → odaya girilir; **aynı oturumda ikinci tıklamada modal AÇILMAZ**.
4. Randevusuna 5 dk kalan hasta → **modal HİÇ açılmaz**, doğrudan gider (regresyon koruması).
5. **Doktor konsolundan** erken katılım → modal aynı şekilde çalışır (tek bileşen, iki portal).

**Talep 2:**
6. `startsAt = now + 62dk` ödenmiş booking → sweep → hasta **ve** doktor "1 Saat Kaldı" alır;
   `startsAt = now + 20dk` → 60 dk e-postası **gelmez**.
7. Aynı sweep'i **ikinci kez** çalıştır → **hiç e-posta gitmez** (claim-first kanıtı).
8. 30 dk e-postasındaki `join_link` tıklanabilir ve doğru booking sayfasına gider.
9. Ödenmemiş (`PENDING`) booking → **hiç hatırlatma yok**.
10. Arka arkaya iki slotlu booking → **her tür için tek** e-posta (90 dk bastırması).
11. Reschedule sonrası yeni saat için hatırlatmalar **tekrar gönderilir**.

**Talep 3:**
12. Ziyaretçi widget'tan mesaj yazar → **sayfa yenilenince mesaj DURUR** (kalıcılık kanıtı —
    eski mock'un düştüğü yer).
13. Admin panelinde oturum "Bekleyen"de görünür → temsilci yanıtlar → ziyaretçi widget'ında
    **5 sn içinde** görünür → oturum "Yanıtlandı"ya geçer ve **yanıtlayana otomatik atanır**.
14. Şablon seçilerek yanıt gönderme; şablon CRUD.
15. MANAGER hesabıyla `/admin/support` **erişilebilir**; EDITOR hesabıyla **403**
    (UI'da bağlantı olmaması KANIT DEĞİLDİR — doğrudan API isteğiyle test edilir).
16. `liveChatEnabled=false` → widget render **edilmez** ve public uçlar **404**.
17. Kapatılmış oturuma ziyaretçi mesajı → **409**, widget "yeni sohbet başlat" gösterir.

### 4.9 code-quality-agent · documentation-agent · devops-agent · observability-agent

- **code-quality-agent:** lint/format; yeni `modules/support/` dosya adlandırmasının mevcut
  modül desenine uyumu; `AUTO_REPLY_TEXT`/`AUTO_REPLY_DELAY_MS` gibi ölü sabitlerin GERÇEKTEN
  silindiği; eskimiş yorumların (§3.1 tespiti, §1.1 kontrat kayması) temizlendiği.
- **documentation-agent:** `ARCHITECTURE.md`'ye yeni bölüm (destek masası + hatırlatma
  süpürücüsü), `CHANGELOG.md` — **BREAKING DEĞİL** (hepsi additive), ama "canlı destek artık
  gerçek backend" notu öne çıkarılır.
- **devops-agent:** yeni env **YOK**, yeni servis **YOK** (§2.1 kararının doğrudan faydası).
  Yalnızca: hatırlatma e-postaları gerçek SMTP gerektirir → `SMTP_*` değişkenlerinin
  production'da dolu olduğu deploy kontrol listesine eklenir. Kod değişikliği sonrası
  `docker compose up --build -d` (proje kuralı).
- **observability-agent:** sweeper her turda `{ reminded60m, reminded30m, failed }` sayaçlarını
  loglar; SMTP hatası `app.log.error` (sessiz başarısızlık YOK). Support: `PENDING` oturum
  sayısı ve "en eski yanıtlanmamış oturumun yaşı" metrik adayıdır (uygulama kodu YAZMAZ).

---

## 5. Definition of Done (bu görev için ek maddeler)

- [ ] `openapi.yaml` geçerli YAML; tüm `$ref`'ler çözümleniyor (doğrulandı: 247 path,
      354 şema, 0 kırık ref).
- [ ] `frontend/src/lib/api/types.ts` ile `openapi.yaml` arasında Support DTO'ları için
      **sıfır drift**.
- [ ] Üç migration AYRI dosyalarda; M2 (`ALTER TYPE`) **izole**.
- [ ] `reminded60mAt`/`reminded30mAt` hiçbir DTO'da/`openapi.yaml`'da **dönmüyor**.
- [ ] `live-chat-widget.tsx`'te `AUTO_REPLY_TEXT`/`AUTO_REPLY_DELAY_MS` **sıfır kez** geçiyor.
- [ ] Backend kaynak ağacında `EventSource`/`text/event-stream`/`WebSocket` **sıfır kez**
      geçiyor (§3.3 kararının kanıtı).
- [ ] `SiteRole` enum'ı **hâlâ 5 değer** (`SUPPORT_AGENT` eklenmedi — §3.2).
- [ ] `/admin/support/*`'ın tamamı rbac §4.4 route-tablosu zorlama testinden geçiyor.
- [ ] compliance-agent saklama sürelerini onayladı (§3.7) ve `lib/support-retention.ts` bu
      onaya göre yazıldı.

---

## 6. Bilinçli olarak KAPSAM DIŞI

| Konu | Neden | Takip branşı |
|---|---|---|
| Erken katılımın backend'de ENGELLENMESİ | §1.2 — modalın kendisiyle çelişir; 2026-09-15 kararını bozar | — (istenirse audit VERİSİYLE yeniden değerlendirilir) |
| SSE/WebSocket ile gerçek zamanlı sohbet | §3.3 — ölçekle gerekçelendirilmedi | `feature/support-chat-sse` |
| Ayrı `SUPPORT_AGENT` rolü | §3.2 — spekülatif | `feature/rbac-support-agent-role` |
| Destek mesajlarında tam metin arama | Özel nitelikli veri içerebilir | `feature/support-message-search` |
| Ziyaretçiye dosya/ekran görüntüsü yükleme | İstenmedi; yeni depolama + tarama yüzeyi | — |
| Destek sohbetinden randevuya/booking'e bağ | İstenmedi | — |
| Temsilciye "yeni mesaj" push/e-posta bildirimi | İstenmedi; notification-agent'ın ayrı bir turu | `feature/support-agent-notifications` |
| Kuyruk altyapısına (BullMQ/pg-boss) geçiş | §2.1 madde 4 — 9 sweeper birlikte ele alınır | `chore/background-job-runtime` |
| Hatırlatma sürelerinin admin panelinden ayarlanabilmesi | İstenmedi; 60/30 sabittir | — |
| "Hatırlatma gönderildi" bilgisinin admin UI'da görünmesi | §2.2 madde 1 — talep edilmedi | `feature/admin-reminder-visibility` |

---

## 7. EK KARAR — 2026-09-16: Ön görüşme (pre-chat) formu

Mevcut desenlerin doğrudan genişlemesidir; yeni bir mimari/KVKK kararı DEĞİLDİR.
Tek doğru kaynak yine `docs/architecture/openapi.yaml` (bu turda güncellendi).

### 7.1 Şema (db-agent — TEK SAHİP)

`SiteSettings` (`liveChatScriptId`in hemen altına, aynı blokta):

| Alan | Tip | Default |
|---|---|---|
| `liveChatPreChatEnabled` | `Boolean` | `false` |
| `liveChatRequireName` | `Boolean` | `true` |
| `liveChatRequirePhone` | `Boolean` | `true` |
| `liveChatRequireEmail` | `Boolean` | `false` |

`SupportChatSession` (`visitorName`/`visitorEmail` ile AYNI blokta):

| Alan | Tip | Not |
|---|---|---|
| `visitorPhone` | `String?` | Beyan, doğrulanmamış; index YOK (aranmaz) |

Tek migration, geri dönüşlü, backfill GEREKMEZ (default'lar mevcut davranışı korur).

### 7.2 KVKK (architect onayı, ayrı compliance turu GEREKMEZ)

`visitorPhone`, `compliance-notes-support-desk.md` §1'deki `visitorName`/`visitorEmail`
kaydının AYNI risk sınıfıdır: ziyaretçinin KENDİ beyan ettiği iletişim bilgisi, sağlık
verisi DEĞİL, m.5/2-f meşru menfaat (destek talebine dönüş). Dolayısıyla:
**30 günlük PII redaksiyonuna TABİ DEĞİL** (`lib/support-retention.ts` DEĞİŞMEZ —
yalnızca `ipAddress`/`userAgent` null'lanır), **maskelenmez**, oturum kalıcı silinene
kadar yaşar. compliance-agent bir sonraki turunda `compliance-notes-support-desk.md`
§1 tablosuna satırı eklesin (bilgilendirme, blokaj değil).

### 7.3 Uçlar (backend-agent)

1. `GET /settings` (public) + `GET/PATCH /admin/settings`: 4 alan mevcut DTO'ya eklenir
   (`entities.ts::SiteSettingsSchema`, `mappers/index.ts`, `settings.schemas.ts`,
   `settings.routes.ts::DEFAULTS`). YENİ UÇ YOK. 4 alan public `GET /settings`'te de
   döner — misafir widget formu render edip etmeyeceğini bilmek zorundadır; sır değildir.
2. `POST /support/sessions`: gövdeye opsiyonel `visitorPhone` (`maxLength: 40`, format
   doğrulaması YOK). Sunucu bu alanı HİÇBİR ayarda ZORUNLU KILMAZ — `liveChatRequire*`
   YALNIZCA istemci tarafı kuralıdır (ayar PATCH'lenince açık widget akışları kırılmasın).
3. `POST /support/sessions` artık `authenticateOptional` preHandler taşır
   (`checkout.routes.ts` deseni). `security: []` DOĞRU kalır. Token geçerliyse:
   `visitorUserId` = kullanıcı id'si (§3.4'teki "hep null" sınırlaması KALKTI) ve
   `visitorName/Phone/Email` **sunucuda** `User.name/phone/email`'den doldurulur, gövdeden
   gelen aynı adlı alanlar YOKSAYILIR. `User.phone` null ise sütun null kalır, gövdeye
   geri düşülmez.
4. Admin DTO'ları (`SupportChatSessionSummary` + detay): `visitorPhone` eklenir.
   Liste araması `q` GENİŞLETİLMEZ (name/email'de kalır).

### 7.4 Frontend (frontend-agent) / Admin UI

- Widget: `liveChatPreChatEnabled && !oturumAçık` → ilk mesajdan ÖNCE form
  (Ad Soyad / Telefon / E-posta; zorunluluk `liveChatRequire*`). Giriş yapmış kullanıcıda
  form ATLANIR, istek `Authorization: Bearer` ile gider (auto-fill sunucuda olur —
  istemci `visitor*` alanlarını göndermez).
- Üç `liveChatRequire*` de `false` iken form gösterilir ama hiçbir alan zorunlu değildir;
  bu geçerli bir yapılandırmadır (`422` yok).
- Admin ayarlar sayfası: 4 toggle, `liveChatEnabled` grubunun altında; `liveChatRequire*`
  yalnızca `liveChatPreChatEnabled` açıkken etkin görünür (salt UI davranışı).
- Admin destek masası: `visitorPhone` `visitorName`/`visitorEmail` ile aynı yerde,
  "ziyaretçi beyanı" etiketiyle; `tel:` linki serbest.
