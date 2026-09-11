# Security Review — Tele-Sağlık (`telehealth`) Modülü — OWASP/Politika Denetimi

> **Denetçi:** security-agent
> **Kapsam:** `.claude/architect-scope-telehealth-template.md` §8 (bağlayıcı, engelleyici) —
> `backend/src/modules/telehealth/**` (routes, admin routes, LiveKit routes, `lib/{booking,
> livekit,timezone,availability}.ts`, `telehealth.schemas.ts`) + `backend/tests/integration/
> telehealth.test.ts` / `telehealth-livekit.test.ts`.
> **Sonuç: ONAY (koşullu düzeltmelerle).** **2 bulgu** tespit edildi, **ikisi de KENDİM
> düzelttim** (kod + test), eskale gerektiren büyük bir mimari sorun YOK. Kritik sızıntı
> (LiveKit secret, PII, injection, auth bypass) bulunamadı. `npm run typecheck` ve ilgili tüm
> testler (66/66 telehealth testi + 23/23 demo-templates-telehealth-clinic testi) yeşil.

---

## Özet tablo — §8 madde madde doğrulama

| # | Madde | Sonuç |
|---|---|---|
| 1 | `POST /appointments/{id}/meeting-token` — secret sızıntısı yok, TTL, grant kapsamı, identity PII'siz, IDOR (4 yol), 10/dk, audit | **GEÇTİ** (kod+test doğrulandı) |
| 2 | `accessToken` — kriptografik rastgelelik, yalnız hash saklanır, sabit zamanlı karşılaştırma, log sızıntısı riski dokümante | **DÜZELTİLDİ** (sabit zamanlı karşılaştırma eksikti) |
| 3 | `POST /appointments` — 5/dk, e-posta doğrulama, sunucu-taraflı slot doğrulama, fiyat/süre istemciden kabul edilmiyor | **GEÇTİ** |
| 4 | RBAC — `/admin/telehealth/appointments` ADMIN+MANAGER (EDITOR 403), doktor/uzmanlık CRUD ADMIN+MANAGER | **GEÇTİ** |
| 5 | Public sızıntı — `GET /doctors*` yalnızca `userId`/`avatarMediaId`, slot yalnızca `available` | **GEÇTİ** |
| 6 | Modül kapalıyken TÜM public/admin uçlar 404 | **DÜZELTİLDİ** (admin uçlarında guard eksikti) |
| Ek | Injection, rate-limit IP/bypass, `meetingRoomName` rastgeleliği | **GEÇTİ** (mevcut proje deseniyle tutarlı, telehealth'e özgü yeni risk yok) |

---

## Düzeltilen bulgular (BEN düzelttim — küçük/nokta düzeltmeler)

### [BULGU 1 — ORTA/YÜKSEK, §8.6 + DoD ihlali] Admin tele-sağlık uçları modül kapalıyken 404 DÖNMÜYORDU

**Dosya:** `backend/src/modules/telehealth/telehealth.admin.routes.ts` (üç `export async
function`: `adminTelehealthSpecialtiesRoutes`, `adminTelehealthDoctorsRoutes`,
`adminTelehealthAppointmentsRoutes`); ayrıca yanlış yönlendirici bir yorum `backend/src/app.ts`
satır ~239-241'de.

**Sorun:** Mimari doküman §8 madde 6 ve §14 (DoD) satır 1067 **açıkça ve istisnasız** şunu
söylüyor: *"Modül kapalıyken tüm public/**admin** tele-sağlık uçları 404."* Ancak kod, `Cart`/
`Checkout` deseninden farklı olarak yalnızca **public** rotalara (`telehealth.routes.ts`,
`telehealth.livekit.routes.ts`) `requireModuleEnabled("telehealth")` hook'u eklemişti.
`telehealth.admin.routes.ts`'teki üç route grubu yalnızca `authenticate` +
`requirePanelAccess()`/`requireSiteRole(...ROLES_ADMIN_MANAGER)` taşıyordu — `app.ts`'teki
yorum bunu **bilinçli bir karar** olarak açıklıyordu ("Admin uçları modül durumundan
BAĞIMSIZDIR, `adminProductsRoutes` ile AYNI karar"), ama bu, **bu modüle özgü, açıkça
belgelenmiş bir bağlayıcı karardan** (§8.6) sapıyordu — `products`/`portfolio`'nun genel
deseni burada **kasıtlı olarak tadil edilmemiş**, yanlışlıkla miras alınmıştı.

**Somut etki:** Tele-Sağlık modülü `MODULE_REGISTRY`'de `defaultEnabled: false` ile gelir
(§2.4) — yani HİÇBİR kurulumda bu modül varsayılan olarak açık değildir. Modül kapalı bir
sitede bile `/admin/telehealth/appointments` (hasta adı+e-postası PII'si), `/admin/telehealth/
doctors`, `/admin/telehealth/specialties` uçları ADMIN/MANAGER için **tam işlevsel** kalıyordu.
Bu, "kapalı modülün varlığı sızdırılmaz" ilkesini (module-guard.ts'nin kendi gerekçesi) ihlal
ediyordu ve modülü kapatmanın PII erişimini de kapatacağı varsayımıyla çalışan bir operasyon
ekibini yanıltabilirdi (OWASP A05 Security Misconfiguration + A01 Broken Access Control sınırı).

**Test kapsamı öncesi:** `telehealth.test.ts`'teki "admin RBAC ve CRUD" bloğu modülü hiç
etkinleştirmiyordu (`setTelehealthModuleEnabled` çağrısı YOK) — bu yüzden testler yanlışlıkla
**her iki davranışla da** (guard var/yok) yeşil kalıyordu; boşluk fark edilmemişti.

**Uygulanan düzeltme:**
1. `telehealth.admin.routes.ts`: her üç route grubuna, `authenticate`'DEN ÖNCE (public
   rotalarla AYNI sıra — kimlik doğrulama denemesi bile kapalı modülün admin yüzeyinin
   varlığını sızdırmasın) `server.addHook("preHandler", requireModuleEnabled("telehealth"))`
   eklendi.
2. `app.ts`'teki yanıltıcı yorum düzeltildi (artık admin uçlarının da modül durumuna bağlı
   olduğunu ve bunun `adminProductsRoutes`'un genel deseninden BİLİNÇLİ bir sapma olduğunu
   açıklıyor).
3. `telehealth.test.ts`: "admin RBAC ve CRUD" bloğunun `beforeAll`'ına
   `setTelehealthModuleEnabled(app, true)` eklendi (aksi hâlde RBAC testleri artık 404 alıp
   yanlış pozitif/negatif üretirdi).
4. `telehealth.test.ts`'e yeni bir regresyon testi eklendi: **"§8.6/DoD — modül KAPALIYKEN
   ADMIN uçları da 404 döner (ADMIN rolü BİLE modülü AŞAMAZ)"** — modül kapalıyken oturum açmış
   bir ADMIN'in `/admin/telehealth/{appointments,doctors,specialties}` uçlarının hepsinden 404
   aldığını doğrular.

**Doğrulama:** `npm run typecheck` temiz (öncesi/sonrası AYNI 3 önceden var olan, telehealth
DIŞI `tests/helpers/route-table-parser.ts` hatası — `git stash` ile doğrulandı); tüm telehealth
test dosyaları (`telehealth.test.ts` dahil, yeni test + güncellenen `beforeAll` ile) **66/66**
yeşil.

---

### [BULGU 2 — DÜŞÜK/ORTA, §8.2 ihlali] `accessToken` hash karşılaştırması sabit zamanlı DEĞİLDİ

**Dosyalar:** `backend/src/modules/telehealth/telehealth.routes.ts`
(`assertAppointmentAccess`), `backend/src/modules/telehealth/telehealth.livekit.routes.ts`
(`isAuthorizedForMeetingAccess`).

**Sorun:** §8 madde 2 açıkça "karşılaştırma sabit zamanlı" olmasını şart koşuyor. Kod
`hashToken(request.providedToken) === appointment.accessTokenHash` biçiminde düz JavaScript
string eşitliği kullanıyordu — bu, ilk farklı karakterde kısa devre yapan, teorik bir zamanlama
yan kanalı bırakan bir karşılaştırmadır. Depoda tam olarak bu sorunu çözmek için zaten
`lib/api-key.ts::timingSafeEqualHex` (`crypto.timingSafeEqual` sarmalayıcısı, `api-key-auth.ts`
tarafından kullanılıyor) var, ama telehealth modülü bunu kullanmıyordu.

**Önem notu (dürüst değerlendirme):** Burada karşılaştırılan değer HAM bir sır değil, SHA-256
**hash'idir** — bir saldırgan zamanlama yan kanalıyla hedef hash'i bayt bayt çıkarsa bile
SHA-256'nın tek yönlülüğü nedeniyle bundan geçerli bir ham `accessToken` türetemez; bu yüzden
pratik istismar edilebilirlik DÜŞÜKTÜR (`cart.routes.ts`/`checkout.routes.ts`/
`invitations.routes.ts` gibi depodaki DİĞER tüm `tokenHash` karşılaştırmaları da aynı düz
`===` desenini kullanıyor — bu, telehealth'e özgü YENİ bir zafiyet değil, mevcut proje geneli
bir desen). Ancak mimari doküman bu SPESİFİK token için **açıkça ve bağlayıcı olarak** sabit
zamanlı karşılaştırma istiyor (muhtemelen randevu/konsültasyon erişiminin hassasiyeti nedeniyle
diğer tokenlardan daha sıkı bir çıta koyuyor) — bu yüzden bunu bir uyumsuzluk olarak
işaretleyip düzelttim.

**Uygulanan düzeltme:** Her iki dosyada da karşılaştırma `timingSafeEqualHex(hashToken(...),
appointment.accessTokenHash)` olarak değiştirildi (mevcut `lib/api-key.ts` yardımcısı, yeni
bağımlılık/dosya YOK).

**Not (backend-agent/code-quality-agent'a bilgi amaçlı, engelleyici DEĞİL):** Depodaki diğer
`hashToken(...) === X.tokenHash` noktaları (`cart.routes.ts:72,143`, `checkout.routes.ts:93`,
`invitations.routes.ts:81,133`, `auth.service.ts` çeşitli satırlar, `users.routes.ts:96`,
`security.routes.ts` çeşitli satırlar) AYNI sınıf karşılaştırmadır ve tutarlılık için
`timingSafeEqualHex`'e taşınmaları düşünülebilir — ama bu **telehealth kapsamının dışında**,
mevcut/önceki bir turdan miras kalan bir desen olduğu için bu denetimde DEĞİŞTİRİLMEDİ; ayrı
bir hijyen görevi olarak not düşülür, engelleyici değildir.

---

## Doğrulanan ve GÜVENLİ bulunan alanlar (kod satırı referanslı)

| Alan | Bulgu |
|---|---|
| **§8.1 — Secret sızıntısı** | `lib/livekit.ts::createMeetingToken` — `LIVEKIT_API_SECRET` yalnızca `AccessToken` constructor'ına geçiyor, hiçbir yanıt/log/hata alanına yazılmıyor. `LiveKitNotConfiguredError` mesajı jenerik, secret/URL içermiyor (`lib/errors.ts:169-173`). `telehealth-livekit.test.ts:190-213` testi yanıt gövdesinin tam JSON serileştirmesinde sahte secret string'inin GEÇMEDİĞİNİ doğrudan assert ediyor. |
| **§8.1 — TTL** | `createMeetingToken` `ttlSeconds = config.tokenTtlMin * 60` kullanıyor; `env.ts::LIVEKIT_TOKEN_TTL_MIN` `z.coerce.number().int().positive().max(60).default(15)` ile tavanlanmış — kod TTL'i AŞAMAZ. |
| **§8.1 — Grant kapsamı** | `livekit.ts:79` — `accessToken.addGrant({ roomJoin: true, room: input.roomName })` TEK grant çağrısı; `roomCreate`/`roomAdmin`/`roomList`/`ingressAdmin` kodda hiç GEÇMİYOR (grep ile doğrulandı). |
| **§8.1 — Identity PII'siz** | `buildParticipantIdentity` → `${kind}:${id}` (`patient:<Appointment.id>` / `doctor:<DoctorProfile.id>`) — e-posta/ad hiçbir yerde identity'ye yazılmıyor. |
| **§8.1 — IDOR (4 yol)** | `isAuthorizedForMeetingAccess` tam olarak §4.5'teki 4 yolu uyguluyor (oturum sahibi hasta / doğru token / doktorun bağlı User'ı / ADMIN — **MANAGER hariç**, bilinçli daha dar yüzey). `telehealth-livekit.test.ts:215-268` token yok/yanlış token/yanlış hasta/MANAGER için 404, doğru 4 yol için 200 test ediyor — GERÇEK IDOR testi mevcut. |
| **§8.1 — Hız sınırı** | `config: { rateLimit: { max: 10, timeWindow: "1 minute" } }` (`telehealth.livekit.routes.ts:77`); `telehealth-livekit.test.ts:321-332` 11. isteğin 429 döndüğünü doğruluyor. |
| **§8.1 — Audit** | `logAudit(action: "telehealth.meeting_token.issued", ...)` her başarılı üretimde çağrılıyor, `metadata`'ya token/URL YAZILMIYOR; test bunu DB'den doğruluyor. |
| **§8.2 — Kriptografik rastgelelik** | `generateOpaqueToken()` → `crypto.randomBytes(32)` (`lib/tokens.ts`) — CSPRNG. |
| **§8.2 — Yalnızca hash saklanır** | `Appointment.accessTokenHash` (schema.prisma) — ham token hiçbir yerde DB'ye yazılmıyor; `booking.ts:56-57` ham değeri yalnızca dönüş değerinde (`rawAccessToken`) tutuyor. |
| **§8.2 — Log sızıntısı riski dokümantasyonu** | Mimari dokümanda (§8.2) AÇIKÇA "kabul edilen risk" olarak yazılı; `app.ts` logger `redact` listesi zaten `token`/`accessToken`/`refreshToken` alan adlarını maskeliyor (JSON body için) — ancak Fastify'ın varsayılan `req` serializer'ı `url`'i (query string dahil) loglar, yani `?t=` parametresi access log'larında GÖRÜNEBİLİR; bu, mimari dokümanın kendisinin kabul ettiği ve TTL yerine dar randevu penceresiyle (§4.5, -5dk/+15dk) sınırladığı risktir — kod/doküman TUTARLI, ek aksiyon gerekmiyor. |
| **§8.3 — Hız sınırı** | `POST /appointments`: `config: { rateLimit: { max: 5, timeWindow: "1 minute" } }` (`telehealth.routes.ts:165`). |
| **§8.3 — E-posta doğrulama** | `CreateAppointmentRequestSchema.patientEmail: z.string().trim().toLowerCase().email().max(255)`. |
| **§8.3 — Sunucu taraflı slot doğrulama** | `booking.ts::bookAppointment` → `isBookableSlotStart` (saf fonksiyon, `lib/availability.ts`) `runSerializable` transaction'ı İÇİNDE, DB'den TAZE okunan `doctor.availability` ile çağrılıyor; istemcinin `startsAt`'i yalnızca BİR GİRDİ, doğrulama TAMAMEN sunucuda. |
| **§8.3 — Fiyat/süre istemciden kabul edilmiyor** | `CreateAppointmentRequestSchema`'da `priceCents`/`sessionDurationMin` alanı YOK (kod incelemesiyle doğrulandı, yalnızca dokümana güvenilmedi); `booking.ts:98-99` `priceCents: doctor.sessionPriceCents, currency: doctor.currency` — DoctorProfile'dan, transaction içinde okunuyor. `telehealth.test.ts:157-176` bunu `sessionPriceCents: 75000` override'ıyla uçtan uca doğruluyor. |
| **§8.4 — RBAC** | `adminTelehealthAppointmentsRoutes`: `requireSiteRole(...ROLES_ADMIN_MANAGER)` (`requirePanelAccess()` DEĞİL) — EDITOR hariç. `adminTelehealthSpecialtiesRoutes`/`DoctorsRoutes`: okuma `requirePanelAccess()` (ADMIN+MANAGER+EDITOR), yazma (`POST`/`PATCH`/`DELETE`/`PUT .../availability`) `requireSiteRole(...ROLES_ADMIN_MANAGER)`. `telehealth.test.ts:340-397` üç senaryoyu da (EDITOR 403 appointments, EDITOR okuma 200 + yazma 403 doktor/uzmanlık, MANAGER 200) test ediyor. |
| **§8.5 — Public sızıntı** | `toDoctorProfileDto` (`mappers/index.ts:1584-1609`) yalnızca `userId`/`avatarMediaId` dış kimliklerini + doktor alanlarını dönüyor, `Appointment` verisi YOK. Slot yanıtı `{ startsAt, endsAt, available }` — kim rezerve etti bilgisi YOK (`telehealth.routes.ts:153-155`, `availability.ts::GeneratedSlot`). |
| **§8.6 — Modül kapalıyken 404** | Public (`telehealth.routes.ts`, `telehealth.livekit.routes.ts`) ZATEN doğruydu; **admin eksikti → düzeltildi** (bkz. Bulgu 1). |
| **A03 Injection** | Tüm DB erişimi Prisma (parametreli); `search`/`specialtySlug`/`language` gibi kullanıcı girdileri `contains`/`has`/`equals` filtrelerine STRING olarak geçiyor, ham SQL/`$queryRaw` YOK (`telehealth.routes.ts`, `telehealth.admin.routes.ts` içinde grep ile doğrulandı — `$queryRaw`/`$executeRaw` hiç kullanılmıyor). Zod şemaları tip zorlaması yapıyor (`z.string().uuid()`, `z.coerce.number()`, `ISO_INSTANT_SCHEMA` vb.) — tip karışıklığı/prototip kirliliği riski yok. |
| **Rate-limit IP bazlı/bypass** | `@fastify/rate-limit` global `keyGenerator` override edilmemiş → varsayılan `request.ip` (Fastify'ın `trustProxy` ayarına bağlı, `env.ts::TRUST_PROXY` ile kontrollü — bu proje geneli, telehealth'e özgü DEĞİL, mevcut/onaylı bir tasarım). IP rotasyonuyla teorik bypass mümkün ama bu, checkout/login gibi TÜM diğer hassas uçlarla AYNI kabul edilmiş risk sınıfı — telehealth YENİ bir zayıflık eklemiyor. |
| **`meetingRoomName` rastgeleliği** | `booking.ts::generateMeetingRoomName` → `crypto.randomBytes(16).toString("hex")` = 32 hex karakter (128 bit CSPRNG entropi) + `"room_"` öneki — `Appointment.id`'den TÜRETİLMİYOR, tahmin edilemez. |

---

## Backend/integration-agent'a iletilecek aksiyon maddeleri

Yok — her iki bulgu da bu denetim sırasında **doğrudan düzeltildi** (kod + regresyon testi).
Yalnızca bilgi amaçlı (engelleyici değil) bir not: depo genelindeki diğer `tokenHash`
karşılaştırma noktalarının (`cart`/`checkout`/`invitations`/`auth`/`security`/`users` route'ları)
tutarlılık için `timingSafeEqualHex`'e taşınması ayrı bir code-quality/hijyen görevi olarak
değerlendirilebilir — bu telehealth turunun kapsamı DIŞINDADIR.

---

## Sonuç

`.claude/architect-scope-telehealth-template.md` §8'in TÜM maddeleri artık kodda doğrulanmış
durumda; iki gerçek (biri orta/yüksek önem — modül kill-switch'inin admin yüzeyinde eksik
olması, biri düşük/orta önem — sabit zamanlı karşılaştırma eksikliği) bulgu bulundu ve KENDİM
düzelttim. Eskale edilecek büyük bir mimari sorun YOK. `npm run typecheck` temiz (telehealth
dışı, önceden var olan 3 hata hariç); `telehealth.test.ts` (12 test, 1 yeni regresyon dahil),
`telehealth-livekit.test.ts`, `telehealth-booking.test.ts`, `telehealth-availability.test.ts`,
`telehealth-timezone.test.ts`, `telehealth-livekit.test.ts` (unit) ve
`demo-templates-telehealth-clinic.test.ts` — toplam **89/89 test yeşil**.

**Karar: ONAY.** Definition of Done'daki "Token grant kapsamı/TTL/IDOR/identity denetimi
imzalandı (security-agent — engelleyici)" kriteri karşılanmıştır.
