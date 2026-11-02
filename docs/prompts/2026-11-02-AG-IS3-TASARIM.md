# Paket AG, İş 3: Harici görüntülü toplantı — TASARIM RAPORU (2026-11-02)

> Durum: **yalnızca tasarım.** Kod yazılmadı, kod dosyası değişmedi. Kullanıcı onayından sonra uygulanır.
> Kaynak talimat: `docs/prompts/2026-11-02-AG-uzmanlik-bildirim-harici-toplanti.md` (İş 3 + kırmızı çizgi).

## 0. Özet

- Randevudan **tamamen bağımsız** yeni bir alan: `ExternalMeeting` + `ExternalMeetingGuest` tabloları, `meet_` önekli odalar, ayrı token üreticisi (`lib/meeting-livekit.ts`), ayrı uç ailesi (`/meetings/*`, `/meet/guest/*`), ayrı `meeting-room.tsx` bileşeni.
- Yetki kullanıcı başına **tek bir alan** ile temsil edilir: `User.meetingHostGrantedAt` (+ verenin id'si). API'ye türetilmiş `canHostMeetings` alanı olarak yansır (`canUseAdvancedBuilder` deseni). ADMIN için her zaman `true`.
- Misafir bağlantısı blog önizleme deseninin uyarlaması: `mg_<32 bayt base64url>`, DB'de yalnızca SHA-256 özeti, yeniden üretme/iptal. Belirteç URL **parçasında** (`#`) taşınır, sunucuya yalnızca POST gövdesinde gider.
- Bekleme odası LiveKit'e girmeden önce HTTP yoklamasıyla çalışır: ev sahibi odada değilse (ve "misafirleri doğrudan al" kapalıysa) misafire token verilmez.
- Toplantı sonu/iptal, yeni bir süpürücüyle (`meeting-sweeper.ts`) sunucu tarafında uygulanır. Yalnızca `meet_` odalarına dokunur.
- **Değişmeyenler:** `telehealth.livekit.routes.ts` (meeting-token ucu), `lib/livekit.ts` içindeki mevcut fonksiyonlar, `early-join.ts`, egress/kayıt dosyaları, `consultation-room.tsx`, `room/stage.tsx`, `room/control-bar.tsx`, LiveKit sunucu ayarları, compose, Nginx, `.env`. Yeni npm paketi yok (`livekit-server-sdk`, `@livekit/components-react` ve `livekit-client` zaten mevcut).

---

## 1. Mevcut kodun incelenmesi (tasarımın dayanağı)

### 1.1 LiveKit / görüşme (bunlar DEĞİŞMEZ)

| Konu | Yer | Gözlem | İş 3'e etkisi |
|---|---|---|---|
| meeting-token ucu | `backend/src/modules/telehealth/telehealth.livekit.routes.ts:93-207` | 10/dk oran sınırı (`:97`), önce `isLiveKitConfigured` → 503 (`:107-109`), erişim yoksa 404 (`:137`), oda = booking/appointment `meetingRoomName` (`:159`), `ensureRoomConfigured` best-effort (`:164-168`), audit `telehealth.meeting_token.issued` (`:192-203`) | Yeni uç bu sırayı **kopyalar** ama bu dosyaya dokunmaz. Ayrı rota dosyası. |
| Erişim kuralı | aynı dosya `:60-85` | Rol erişim vermez (Paket E, `:54-58`); sabit zamanlı özet karşılaştırma | Aynı ilke: ADMIN rolü başkasının toplantısına **ev sahibi olarak girme** hakkı vermez. |
| Token grant'ları | `backend/src/modules/telehealth/lib/livekit.ts:117-153` | `roomJoin`+`room`, `canPublish/canSubscribe/canPublishData: true`; `roomCreate/roomAdmin/roomList` **yok**; TTL `LIVEKIT_TOKEN_TTL_MIN` (varsayılan 180, tavan 240 — `config/env.ts:101`) | Yeni fonksiyon bu dosyaya **eklenmez**; `lib/meeting-livekit.ts` ayrı dosya. |
| Kimlik deseni | `lib/livekit.ts:85-100` | `${kind}:${id}`, PII yok | `meet-host:<userId>`, `meet-guest:<guestId>` |
| Kısıtlı grant örnekleri | `lib/livekit.ts:180-205` (QA dinleyici), `:220-244` (tercüman: `canPublishSources: [CAMERA, MICROPHONE]`, `canUpdateOwnMetadata: false`) | Ekran paylaşımını grant ile kapatma deseni zaten var | Misafir grant'ı tercüman desenini izler. |
| Oda yaşam süresi | `lib/livekit.ts:75-83` `ensureRoomConfigured` | `createRoom` idempotent; `maxParticipants` vermiyor | Yeni dosyada kendi `createRoom` çağrısı (`maxParticipants` ile). |
| Katılımcı atma / listeleme | `lib/livekit.ts:251-270` | `removeRoomParticipant`, `listRoomParticipantIdentities` dışa açık | Yeni süpürücü ve iptal akışı bunları **yalnızca içe aktarır**. |
| Erken katılım | `lib/early-join.ts:17-33` | Yalnızca audit metadata'sı, katılımı reddetmez | Toplantıda ayrı ve **sert** pencere (15 dk önce – bitiş). `early-join.ts` kullanılmaz. |
| Oda adı | `lib/booking.ts:17-20` | `room_` + 32 hex | Yeni: `meet_` + 32 hex. Önekler çakışmaz. |
| Kayıt (egress) | `telehealth.recording.routes.ts:286-310` | `startRoomCompositeRecording` yalnızca randevu kaydı ve hasta rızasıyla çağrılır | `meet_` odasında kayıt başlatacak bir yol yok; ek olarak grant'ta `roomRecord` verilmez. |
| Egress webhook | `telehealth.egress-webhook.routes.ts:50-84` | Yalnızca `egress_*` olayları, `egressId` ile `ConsultationRecording` eşleşmesi; diğer olaylar debug log | `meet_` odaları burada hiç eşleşmez. Değişiklik yok. |
| Süpürücüler | `lib/qa-listener-sweeper.ts:6-25`, `lib/interpreter-sweeper.ts:47` | Yalnızca randevu/booking odalarını gezer. Not (`:8-9`): **LiveKit bağlı katılımcının token'ını yenilediği için TTL oturumu sınırlamaz** | Toplantı sonunu TTL değil, ayrı süpürücü uygular. |

### 1.2 Oda arayüzü (AF bileşenleri) — yeniden kullanım haritası

`frontend/src/components/site/telehealth/room/` incelendi.

**Olduğu gibi yeniden kullanılabilir (consultation'a bağımlı değil):**

| Bileşen | Dosya | Not |
|---|---|---|
| Video kutusu + ad etiketi + mikrofon/kalite | `participant-tile.tsx` (`RoomParticipantTile`) | Etiket `label-context` üzerinden gelir |
| Etiket çözümleme | `participant-label.ts:46-53, 111` | `meet-host:`/`meet-guest:` rolü `"unknown"` olur ve etiket **token `name`'inden** gelir (`:111`). Identity hiçbir koşulda gösterilmez (`:55-61`). Değişiklik gerekmez. |
| Etiket bağlamı | `label-context.tsx` | `viewer` alanı görsel etkisi olmadan verilir |
| Bağlantı katmanları ("X bağlantıyı kaybetti") | `connection-layers.tsx:35-117` | Genel; labeler kullanır |
| Uygulama içi yeniden bağlanma | `use-app-reconnect.ts:65`, `disconnect-kind.ts` | `fetchToken` geri çağrısı toplantı ucuna bağlanır |
| Cihaz testi | `prejoin-device-check.tsx:131`, `device-prefs.ts`, `use-devices.ts`, `test-tone.ts`, `device-bootstrap.tsx` | Aynen |
| Ayarlar paneli | `settings-panel.tsx` | Aynen |
| UI durumu / PiP / kamera çevirme | `room-ui-context.tsx`, `use-camera-flip.ts`, `pip-geometry.ts`, `use-self-view-gestures.ts` | Aynen |
| Süre / bitiş uyarısı | `session-timer.tsx:35, 65` (`SessionTimer`, `EndingSoonNotice({endsAt})`) | `endsAt` toplantıdan verilir |
| Hata sınıflandırma | `connection-errors.ts` | Aynen |
| Kontrol çubuğu | `control-bar.tsx:150` (`RoomControlBar`) | **Yalnızca ev sahibinde.** Ekran paylaşımı düğmesi koşulsuz (`:153, 272-281`); misafirde kullanılamaz (aşağıya bakın). |

**Consultation'a bağımlı (yeniden kullanılmaz):**

- `stage.tsx:194-268` `ConsultationStage`: `appointmentId`/`isDoctor` alır, **1:1** tasarlanmış (tek `counterpartTrack`, `:211`), `InterpreterPresence` gömülü (`:252-258`). En çok 8 kişilik toplantı için uygun değil → yeni `meeting-stage.tsx` (ızgara + ekran paylaşımı ana kutu), `stage-layout.ts` yardımcıları ve `RoomParticipantTile` ile.
- `participant-kind.ts` (`isCounterpart`) ve `resolveExpectedCounterpartName` (`participant-label.ts:118-121`): "karşı taraf" kavramı 1:1. Kullanılmaz.
- `recording-*`, `qa-listener-notice`, `interpreter/*`, `RecordingConsentDialog`: kayıt, dinleyici ve tercüman yok.

**Misafir kontrol çubuğu:** `RoomControlBar`'a prop eklemek, consultation'ın kullandığı dosyayı değiştirmek demektir. Bunun yerine Paket AA'daki emsal izlenir: `interpreter-room.tsx` (`:24-34`) kendi hafif çubuğunu `SettingsPanel` + `useCameraFlip` ile kurmuştu. Toplantıda da `meeting-guest-control-bar.tsx` (mikrofon, kamera, cihaz ayarları, ayrıl) yazılır. Böylece `control-bar.tsx` **değişmez**. Grant zaten ekran paylaşımını sunucuda reddeder; düğmenin gizlenmesi yalnızca kullanılabilirlik içindir.

**Dil metinleri:** Ortak oda metinleri `useConsultationStrings` (9 dil) içinden gelir. Toplantıya özel metinler (misafir ad formu, bekleme, "bağlantı geçersiz", ev sahibi etiketi) yeni `site-dictionaries/*/meeting.ts` sözlüğüne (9 dil + RTL) eklenir.

### 1.3 Yetki / RBAC

- Roller: `SiteRole` = ADMIN, MANAGER, EDITOR, CUSTOMER, USER, INTERPRETER (`backend/prisma/schema.prisma:68-77`). Doktorluk rol değil, `DoctorProfile.userId` ilişkisi (`telehealth.portal.routes.ts:60-83`, `entities.ts:55-58`).
- **Kullanıcı başına izin bayrağı yok.** Tek emsal, türetilmiş `canUseAdvancedBuilder` (`entities.ts:51-54`, `schema.prisma` User yorum bloğu) ve eski `advancedBuilderEnabled` kolonunun "ölü kolon" gerekçesiyle kaldırılması.
- Rol sabitleri: `lib/site-roles.ts:9-11`. Rol koruması: `middleware/site-rbac.ts:13-37` (yasaklı denemeyi `FORBIDDEN` audit'i ile yazar, ADMIN/MANAGER için 2FA zorunluluğunu uygular).
- `authenticate` yalnızca `id/email/role/twoFactorEnabled` taşır (`middleware/authenticate.ts:27, 43`). Yeni yetkiyi buraya eklemek yerine **uçta taze DB okuması** yapılır (`requireDoctorPortalAccess` deseni, `portal.routes.ts:67-83`). Böylece geri alınan yetki anında etkili olur.
- Admin kullanıcı uçları: `modules/users/admin-users.routes.ts`, tamamen ADMIN (`:128-136`). Rol değişikliği deseni `PATCH /:userId/role` (`:237-290`): serializable işlem, `DELETED` → 404, audit `user.role_change` `{from,to}`.
- Audit: `lib/audit.ts:21` `logAudit(app, {actorId, actorEmail, action, targetType, targetId, metadata, ipAddress, status})`. Kural (`:19`): metadata'ya token, URL veya şifre yazılmaz.

### 1.4 İmzalı belirteç ve oran sınırı desenleri

- `modules/blog/lib/preview-token.ts:31-41`: `s_` + 32 bayt base64url, `hashToken` (SHA-256 hex, `lib/tokens.ts:8-10`), `timingSafeEqualHex`, olmayan özet için `DUMMY_HASH`. `:43-60`: HKDF(JWT anahtarı, "blog-preview-v1") ile durumsuz HMAC oturum belirteci (yeni `.env` yok).
- `blog.preview.routes.ts:126-160`: herkese açık uçta `Cache-Control: no-store` + `X-Robots-Tag: noindex`; eksik, bozuk, süresi dolmuş veya iptal edilmiş belirteç **aynı 404**'ü alır (`:159`). Bağlantı yeniden üretilince eski özetin üzerine yazılır (`:49-54`).
- Global oran sınırı IP anahtarlı; SSR/iç istemci **tek ortak kova** (`plugins/security.ts:51-58`, `lib/rate-limit.ts:21-31`). Sonuç: misafir uçları **tarayıcıdan** çağrılmalıdır. SSR'den çağrılırsa tüm misafirler iç kovayı paylaşır ve IP sınırı fiilen devre dışı kalır.

### 1.5 Paneller

- Admin paneli `/admin/*`: yalnızca ADMIN, MANAGER ve EDITOR girebilir (`middleware/panel-access.ts`). Kenar çubuğu `components/admin/sidebar.tsx:63-100` rol ve modül filtresi uygular.
- Doktor portalı `/{lang}/doctor/*` (`app/[lang]/(doctor)/doctor/…`): panel değildir ve 2FA zorunludur. Menü `components/site/telehealth/doctor-portal-shell.tsx:124-144`.
- Doktor host izolasyonu: `doctor-portal-route-guard.tsx:58-67` `isDoctorSharedRouteException` (`/consultation/{id}` ve `/blog/preview/{id}` istisnaları). `proxy.ts:148-153` bu deseni bilerek ayırır.

---

## 2. Karar: yetkili kullanıcı "Toplantılar"ı nerede görür?

**Öneri: İkisinde de görür. Tek ortak bileşen, iki giriş noktası.**

- Panel rolündeki yetkili kullanıcılar (ADMIN, MANAGER, EDITOR; ör. hasta koordinatörü) → `/admin/meetings`. Kenar çubuğu öğesi `canHostMeetings` ile görünür.
- Doktor profilli yetkili kullanıcılar → `/{lang}/doctor/meetings` (doktor portalı menüsüne "Meetings" bağlantısı).
- İki sayfa da aynı `MeetingsManager` bileşenini kullanır. API aynıdır (`/meetings/*`), panel bağımsızdır.

**Uygunluk kuralı (öneri):** Yetki yalnızca `role ∈ {ADMIN, MANAGER, EDITOR}` **veya** `DoctorProfile` bağlı kullanıcıya verilebilir. CUSTOMER, USER (doktor değilse) ve INTERPRETER için 422 `MEETING_HOST_NOT_ELIGIBLE` döner. Gerekçe: Bu kullanıcıların toplantıyı yönetebileceği bir paneli yok ve hasta hesaplarına toplantı açma yetkisi vermek kötüye kullanım yüzeyi yaratır.

**2FA (öneri):** Ev sahibi uçları `twoFactorEnabled === true` ister (`TwoFactorRequiredError`, doktor portalıyla aynı). Kurum dışına bağlantı dağıtan bir yetki için makul. → Açık soru S2.

---

## 3. Veri modeli (migration yalnızca ekleme)

Migration: `backend/prisma/migrations/2026111x090000_external_meetings/migration.sql`. Yalnızca şunları içerir: `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX` ve `ALTER TABLE "users" ADD COLUMN` (nullable, varsayılansız). DROP, RENAME veya tip değişikliği yok. Mevcut satırlara backfill yok.

```prisma
// --- User'a EKLENEN alanlar (nullable) ---
model User {
  // ...mevcut alanlar değişmez...
  /// Paket AG İş 3 — "Harici toplantı oluşturabilir" yetkisi. NULL = yetki yok. ADMIN için bu alana
  /// bakılmaz (her zaman yetkili). Boolean yerine zaman damgası: kim/ne zaman verdi izi.
  meetingHostGrantedAt   DateTime?
  /// Yetkiyi veren admin (FK yok; blog `previewTokenCreatedById` deseni — admin silinse de iz kalır).
  meetingHostGrantedById String?
  externalMeetingsHosted ExternalMeeting[] @relation("ExternalMeetingHost")
}

enum ExternalMeetingStatus {
  SCHEDULED
  CANCELLED
  // "Bitti" saklanmaz; endsAt'ten türetilir. Odanın sunucu tarafında kapatıldığını closedAt gösterir.
}

model ExternalMeeting {
  id                 String                @id @default(uuid())
  seq                Int                   @unique @default(autoincrement())
  hostUserId         String
  /// Düz metin, 3–120 karakter. Misafir giriş ekranında gösterilir.
  title              String
  /// İsteğe bağlı düz metin, ≤1000 karakter. YALNIZCA ev sahibine görünür; misafire ve e-postaya gitmez.
  note               String?
  startsAt           DateTime
  endsAt             DateTime
  /// 15–120 dk, 5 dk adım. endsAt = startsAt + durationMin (sunucu hesaplar).
  durationMin        Int
  /// Ev sahibi dahil toplam kişi. 2–8, varsayılan 4.
  maxParticipants    Int                   @default(4)
  /// "meet_" + 32 hex (16 rastgele bayt). id'den türetilmez.
  roomName           String                @unique
  /// Misafir bağlantısı: yalnızca SHA-256 özeti. NULL = iptal edilmiş, misafir bağlantısı yok.
  guestTokenHash     String?               @unique
  guestTokenCreatedAt DateTime?
  /// "Misafirleri doğrudan al": true ise ev sahibini beklemeden token verilir.
  autoAdmitGuests    Boolean               @default(false)
  /// Ev sahibi token'ının ilk alındığı an (yalnızca bilgi ve iç sağlama amaçlı).
  hostJoinedAt       DateTime?
  status             ExternalMeetingStatus @default(SCHEDULED)
  cancelledAt        DateTime?
  cancelledById      String?
  /// Süpürücü odayı boşalttığında doldurur (iptal veya bitiş + grace).
  closedAt           DateTime?
  createdAt          DateTime              @default(now())
  updatedAt          DateTime              @updatedAt

  host   User                   @relation("ExternalMeetingHost", fields: [hostUserId], references: [id], onDelete: Restrict)
  guests ExternalMeetingGuest[]

  @@index([hostUserId, startsAt])
  @@index([status, endsAt])
  @@index([closedAt, endsAt])
  @@map("external_meetings")
}

/// Misafir kaydı: YALNIZCA girilen ad ve zaman. E-posta, telefon ve IP saklanmaz.
model ExternalMeetingGuest {
  id          String    @id @default(uuid())
  meetingId   String
  /// Doğrulanmış ve normalleştirilmiş görünen ad (2–40 karakter, bkz. §6.5).
  displayName String
  /// İlk giriş denemesi (bekleme odasına giriş).
  createdAt   DateTime  @default(now())
  /// İlk LiveKit token'ının verildiği an.
  admittedAt  DateTime?
  /// Ev sahibi çıkardıysa doludur; bu misafir oturumu bir daha token alamaz.
  removedAt   DateTime?

  meeting ExternalMeeting @relation(fields: [meetingId], references: [id], onDelete: Cascade)

  @@index([meetingId, createdAt])
  @@map("external_meeting_guests")
}
```

Notlar:
- `onDelete: Restrict` (host): Kullanıcılar zaten soft-delete edilir. Hard delete yolu yok; varsa toplantı izi korunmalı.
- `ExternalMeetingGuest` saklama süresi: Öneri olarak toplantı bitişinden 90 gün sonra mevcut temizlik deseniyle silinir. compliance-agent onayına bağlı (S6).
- db-agent sahibidir. Yukarıdaki taslak bağlayıcı alan listesidir; migration SQL'ini db-agent yazar.

---

## 4. Uç noktalar

Tümü `requireModuleEnabled("telehealth")` arkasındadır (meeting-token ile aynı modül). Hata zarfı projenin standardıdır (`{ error: { code, message, details } }`). Kontrat, `docs/architecture/openapi.yaml` dosyasına yeni `Meetings` etiketiyle eklenir. Bu, kod aşamasının ilk adımıdır (architect).

### 4.1 Admin — yetki yönetimi (`/admin/users`, yalnızca ADMIN)

| Yöntem ve yol | İstek | Yanıt | Not |
|---|---|---|---|
| `PATCH /admin/users/:userId/meeting-host` | `{ enabled: boolean }` | `200 AdminUser` (`canHostMeetings` ile) | `admin-users.routes.ts` hook'larını miras alır (ADMIN + panel + 2FA). Serializable işlem. `DELETED` → 404. Uygun değil → 422 `MEETING_HOST_NOT_ELIGIBLE`. Hedef ADMIN ise no-op ve 200 (zaten her zaman yetkili). Oran sınırı `ADMIN_USERS_RATE_LIMIT`. |

Audit: `user.meeting_host_granted` / `user.meeting_host_revoked`, `targetType: "User"`, metadata `{ from: bool, to: bool }`.

**Geri almada (öneri):** Kullanıcının gelecekteki `SCHEDULED` toplantıları aynı işlemde `CANCELLED` olur (`cancelledById` = admin). Süpürücü açık odaları boşaltır. → S3.

`UserSchema` / `AdminUserSchema` (`entities.ts:36-69`) içine türetilmiş ve salt okunur `canHostMeetings: boolean` eklenir: `role === "ADMIN" || meetingHostGrantedAt != null`. `GET /users/me` de döndürür; frontend menü görünürlüğünü buradan belirler.

**İsteğe bağlı admin gözetimi:** `GET /admin/meetings` (ADMIN; tüm toplantılar, misafir adları hariç) ve `POST /admin/meetings/:id/cancel`. Admin başkasının toplantısına **katılamaz** (Paket E ilkesi). → S4.

### 4.2 Ev sahibi uçları (`/meetings`, oturum gerekir)

Ortak ön koşul `requireMeetingHost(app, userId)`: Taze DB okuması yapılır, kullanıcı `ACTIVE` olmalı, `role === "ADMIN" || meetingHostGrantedAt != null` sağlanmalı ve 2FA açık olmalıdır (S2). Değilse 403 `MEETING_HOST_FORBIDDEN`. Tekil toplantı uçlarında `meeting.hostUserId !== user.id` → **404** (varlık sızdırılmaz; ADMIN dahil).

| Yöntem ve yol | İstek | Yanıt | Kurallar / oran sınırı |
|---|---|---|---|
| `GET /meetings?scope=upcoming\|past&cursor=` | — | `200 { items: Meeting[], nextCursor }` | Yalnızca kendi toplantıları. `Meeting` hiçbir zaman belirteç veya özet içermez. |
| `POST /meetings` | `{ title, startsAt (ISO, Z), durationMin, maxParticipants?, note?, autoAdmitGuests? }` | `201 { meeting: Meeting, guestLink: string }` | `startsAt` ≥ şimdi − 5 dk ve ≤ şimdi + 180 gün. `durationMin` 15–120, 5'in katı. `maxParticipants` 2–8. Kullanıcı başına en çok 20 gelecek toplantı (`MEETING_LIMIT_REACHED` 409). 10/dk. `guestLink` **yalnızca bu yanıtta** düz döner. |
| `GET /meetings/:id` | — | `200 Meeting` (+ `guestLinkActive: bool`) | |
| `PATCH /meetings/:id` | kısmi: `title, startsAt, durationMin, maxParticipants, note, autoAdmitGuests` | `200 Meeting` | `CANCELLED` veya bitmiş → 409 `MEETING_NOT_EDITABLE`. `startsAt/durationMin` yalnızca toplantı başlamadan değişebilir. `autoAdmitGuests` toplantı sırasında da değişebilir. |
| `POST /meetings/:id/guest-link` | — | `200 { guestLink }` | Yeni belirteç, eski özetin üzerine yazılır (eski anında geçersiz). 10/dk. |
| `DELETE /meetings/:id/guest-link` | — | `204` | `guestTokenHash = null`. Bekleyen misafirlerin yoklaması 404 almaya başlar. Odadakiler kalır; isterse ev sahibi tek tek çıkarır. |
| `POST /meetings/:id/cancel` | — | `200 Meeting` | `status = CANCELLED`, `guestTokenHash = null`. Odadaki herkes best-effort atılır. Süpürücü de güvence verir. |
| `POST /meetings/:id/host-token` | — | `200 { token, serverUrl, roomName, expiresAt }` | Önce `isLiveKitConfigured` → 503. Pencere: `startsAt − 15 dk ≤ şimdi < endsAt`, aksi 409 `MEETING_NOT_OPEN` (`details.opensAt`). `CANCELLED` → 409. `ensureMeetingRoom` best-effort, `hostJoinedAt` ilk seferde. **10/dk** (meeting-token ile aynı). |
| `GET /meetings/:id/guests` | — | `200 [{ id, displayName, createdAt, admittedAt, removedAt, waiting: bool }]` | Ev sahibinin bekleme listesi ve katılımcılar. 5 sn yoklama, 60/dk. |
| `POST /meetings/:id/guests/:guestId/remove` | — | `204` | `removedAt` yazılır ve LiveKit'ten atılır (`removeRoomParticipant`, best-effort). |
| `POST /meetings/:id/invite` (isteğe bağlı) | `{ email, locale }` | `202` | `sendBrandedMail` (`lib/branded-mail.ts:130`), best-effort. E-posta **saklanmaz**, audit'e yazılmaz (yalnızca sayaç). Bağlantı sunucuda **yeni belirteç üretilerek** oluşturulur, çünkü düz belirteç saklanmaz → S5. 5/dk, toplantı başına en çok 10. |

`Meeting` DTO: `{ id, title, note, startsAt, endsAt, durationMin, maxParticipants, autoAdmitGuests, status: "SCHEDULED"|"CANCELLED", phase: "upcoming"|"open"|"ended"|"cancelled", hostJoinedAt, guestLinkActive, createdAt }`.

### 4.3 Herkese açık misafir uçları (`/meet/guest`, oturum gerekmez)

Hook'lar (blog önizleme deseni): `Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`. Belirteç **yalnızca gövdede** gelir (query veya path içinde değil).

| Yöntem ve yol | İstek | Yanıt | Not |
|---|---|---|---|
| `POST /meet/guest/preflight` | `{ t }` | `200 { title, hostName, startsAt, endsAt, phase: "upcoming"\|"open" }` / `404 MEETING_LINK_INVALID` | Ad formunu ve "henüz açılmadı, X'te açılır" ekranını besler. 30/dk IP. |
| `POST /meet/guest/join` | `{ t, name?, guestSession? }` | bkz. aşağı | 30/dk IP (5 sn yoklama = 12/dk; yeniden bağlanma payı). |

`/meet/guest/join` akışı (sıra bağlayıcı):
1. `t` biçimi `^mg_[A-Za-z0-9_-]{43}$` değilse → 404. Özet → `findUnique({ guestTokenHash })`. Yoksa, `CANCELLED` ise veya `şimdi ≥ endsAt` ise → **aynı 404** `MEETING_LINK_INVALID`.
2. `isLiveKitConfigured` değilse → 503. Bu kontrol özet doğrulamasından **sonra** yapılır, çünkü geçersiz belirteç sahibine kurulum bilgisi sızdırılmamalı. meeting-token'dan bilinçli fark.
3. `şimdi < startsAt − 15 dk` → `409 MEETING_NOT_OPEN { opensAt }`. Geçerli bağlantı sahibine açılış saatini söylemek sızıntı sayılmaz.
4. Misafir oturumu:
   - `guestSession` yoksa `name` zorunludur (doğrulama §6.5). `ExternalMeetingGuest` oluşturulur ve imzalı oturum belirteci `gs_v1.<guestId>.<meetingId>.<expUnix>.<hmac>` döner. HKDF(JWT anahtarı, "meeting-guest-v1") ile üretilir; blog `p_` deseniyle aynıdır ve yeni `.env` gerekmez. Geçerlilik `endsAt + 10 dk`.
   - `guestSession` varsa imza, `meetingId` eşleşmesi ve süre doğrulanır. `removedAt` doluysa → 404 (aynı yanıt).
5. Bekleme kapısı: `autoAdmitGuests === false` ve ev sahibi odada değilse → `200 { status: "waiting", guestSession, pollAfterSec: 5 }`. "Odada" kontrolü: `listRoomParticipantIdentities(roomName)` içinde `meet-host:` önekli kimlik var mı. `LIVEKIT_INTERNAL_URL` boşsa (prod'da compose varsayılanı dolu, `docker-compose.yml:117`) `hostJoinedAt != null` yedeğine düşülür.
6. Kapasite: Odadaki kimlik sayısı (bu misafirin kendi kimliği hariç) ≥ `maxParticipants` → `409 MEETING_FULL`. Sert sınırı ayrıca LiveKit `maxParticipants` sağlar (§5).
7. Token: `200 { status: "ready", guestSession, token, serverUrl, roomName, expiresAt }`. `admittedAt` ilk seferde yazılır.

Audit (misafir): `meeting.guest.joined` ilk `ready` anında yazılır. `actorId: null`, `targetType: "ExternalMeeting"`, metadata `{ guestId }`. **Ad ve IP audit'e yazılmaz** ("misafir için yalnızca ad ve saat" kuralı; ad yalnızca `ExternalMeetingGuest`'te tutulur). → S6.

### 4.4 Hata kodları (yeni `ApiError` alt sınıfları, `lib/errors.ts`)

| HTTP | code | Ne zaman |
|---|---|---|
| 403 | `MEETING_HOST_FORBIDDEN` | Yetki yok veya geri alınmış |
| 403 | `TWO_FACTOR_REQUIRED` (mevcut) | 2FA kapalı ev sahibi (S2) |
| 404 | `MEETING_NOT_FOUND` | Başkasının veya olmayan toplantı (ev sahibi uçları) |
| 404 | `MEETING_LINK_INVALID` | Misafir: geçersiz, bozuk, süresi dolmuş, iptal, bitmiş, çıkarılmış — **tek ve aynı gövde** |
| 409 | `MEETING_NOT_OPEN` | Pencere açılmadı (`details.opensAt`) |
| 409 | `MEETING_FULL` | Kapasite dolu |
| 409 | `MEETING_NOT_EDITABLE` | İptal, bitmiş veya başlamış toplantıda yasak alan |
| 409 | `MEETING_LIMIT_REACHED` | 20 gelecek toplantı sınırı |
| 422 | `MEETING_HOST_NOT_ELIGIBLE` | Yetki uygun olmayan kullanıcıya veriliyor |
| 422 | `VALIDATION_ERROR` (mevcut) | Şema ve ad doğrulaması |
| 429 | `RATE_LIMITED` (mevcut) | |
| 503 | `LIVEKIT_NOT_CONFIGURED` (mevcut) | |

---

## 5. Token grant'ları ve süreler

Yeni dosya: `backend/src/modules/telehealth/lib/meeting-livekit.ts`. `lib/livekit.ts`'ten yalnızca **içe aktarır** (`getLiveKitConfig`, `isLiveKitConfigured`, `listRoomParticipantIdentities`, `removeRoomParticipant`). Mevcut `createMeetingToken`, `createQaListenerToken`, `createInterpreterToken` ve `ensureRoomConfigured` çağrılmaz ve değişmez.

```ts
export const MEETING_ROOM_PREFIX = "meet_";
export const MEETING_HOST_IDENTITY_PREFIX = "meet-host:";
export const MEETING_GUEST_IDENTITY_PREFIX = "meet-guest:";
export const MEETING_JOIN_LEAD_MS = 15 * 60_000;     // başlangıçtan 15 dk önce açılır
export const MEETING_END_GRACE_MS = 10 * 60_000;     // bitişten sonra odadakiler için kapanış payı (S7)
export function generateMeetingRoomName(): string   // "meet_" + randomBytes(16).hex
export async function ensureMeetingRoom(roomName, maxParticipants)  // createRoom({ name, emptyTimeout, departureTimeout, maxParticipants })
export async function createMeetingHostToken({ roomName, userId, displayName, endsAt })
export async function createMeetingGuestToken({ roomName, guestId, displayName, endsAt })
```

| Grant / alan | Ev sahibi | Misafir | Gerekçe |
|---|---|---|---|
| `identity` | `meet-host:<userId>` | `meet-guest:<guestId>` | PII yok. Aynı misafir oturumu yeniden bağlanınca aynı kimliği alır, çift kutu oluşmaz. |
| `name` | Kullanıcı adı. Doktorsa `unvan + doctorDisplayName` (`lib/doctor-display-name`) | Doğrulanmış misafir adı | Etiket `participant-label.ts:111` ile token `name`'inden gelir |
| `metadata` | `{"role":"meeting_host"}` | `{"role":"meeting_guest"}` | İstemci "Ev sahibi" rozetini buna göre gösterir |
| `roomJoin` / `room` | true / `meet_…` | true / `meet_…` | Yalnızca bu oda |
| `canSubscribe` | true | true | |
| `canPublish` | true | true | |
| `canPublishSources` | `CAMERA, MICROPHONE, SCREEN_SHARE, SCREEN_SHARE_AUDIO` | `CAMERA, MICROPHONE` | **Misafirde ekran paylaşımı yok.** Sunucu tarafında zorlanır (tercüman deseni, `livekit.ts:237`). |
| `canPublishData` | false | false | Toplantıda sohbet veya kayıt sinyali yok. Veri kanalı kötüye kullanım yüzeyi kapatılır. |
| `canUpdateOwnMetadata` | false | false | Misafir adını "Host" veya "Dr. …" yapamaz; rol metadata'sı değiştirilemez |
| `roomAdmin`, `roomCreate`, `roomList`, `roomRecord`, `ingressAdmin`, `hidden`, `recorder` | **verilmez** | **verilmez** | Ev sahibinin "çıkar" yetkisi LiveKit grant'ı yerine backend ucu üzerinden (`removeRoomParticipant`) sağlanır. Böylece istemciye admin yetkili JWT gitmez. |
| TTL | `clamp(endsAt + grace − şimdi, 60 sn, LIVEKIT_TOKEN_TTL_MIN)` | aynı | Token TTL'i yalnızca (yeniden) katılımı sınırlar. LiveKit bağlı katılımcının token'ını yenilediği için (`qa-listener-sweeper.ts:8-9`) asıl kapanışı süpürücü sağlar. |

Oda ayarı: `ensureMeetingRoom`, mevcut `LIVEKIT_ROOM_EMPTY_TIMEOUT_SEC` ve `LIVEKIT_ROOM_DEPARTURE_TIMEOUT_SEC` değerleri ile `maxParticipants = meeting.maxParticipants` verir (yeni env yok). `RoomServiceClient` bu dosyada ayrıca oluşturulur; `livekit.ts`'teki özel önbelleğe dokunulmaz. Oda ilk kez ev sahibi veya misafir token isteğinde oluşturulur. `maxParticipants` yalnızca oda ilk oluşturulurken uygulanır (CreateRoom idempotent). Bu yüzden toplantı sırasında `maxParticipants` PATCH'i engellenir.

**Kayıt yok, üç katmanda:** (1) Grant'ta `roomRecord` yok. (2) `startRoomCompositeRecording` yalnızca `telehealth.recording.routes.ts:310`'da, `Appointment` + rıza kaydı ile çağrılır; `meet_` odası için bir yol yok. (3) `meeting-room.tsx` kayıt bileşeni içe aktarmaz. Ek güvence: `meeting-livekit.ts` testi, `meet_` odası için egress fonksiyonunun hiçbir yerden çağrılmadığını statik olarak denetler (grep testi).

**Süpürücü** — `backend/src/modules/telehealth/lib/meeting-sweeper.ts`, dakikada bir (`registerQaListenerSweeper` deseni, `app.ts:544` yanına kayıt):
- Hedef: `closedAt IS NULL` ve (`status = CANCELLED` veya `endsAt + MEETING_END_GRACE_MS < şimdi`).
- `roomName.startsWith("meet_")` değilse **atla ve hata logla** (savunma: `room_` odalarına asla dokunmaz).
- `listRoomParticipantIdentities` ile alınan kimliklerden yalnızca `meet-host:` ve `meet-guest:` önekliler `removeRoomParticipant` ile atılır. Ardından `closedAt = şimdi` yazılır ve audit `meeting.closed` `{ reason: "cancelled" | "ended" }` düşülür. Atma başarısızsa `closedAt` yazılmaz ve sonraki turda yeniden denenir (QA süpürücüsüyle aynı dürüstlük kuralı).
- Ev sahibi tarafından çıkarılmış misafirin (`removedAt` dolu) odada kalması durumunda da atılır.

---

## 6. Güvenlik

### 6.1 İmzalı misafir bağlantısı

- Üretim: `mg_` + `crypto.randomBytes(32).toString("base64url")` (256 bit). DB'ye yalnızca `hashToken()` (SHA-256 hex) yazılır, `@unique` indeksli. Düz belirteç yalnızca oluşturma ve yeniden üretme yanıtında bir kez döner. Log, audit ve hata gövdesine yazılmaz (`lib/audit.ts:19`).
- Bağlantı biçimi: `https://<site>/{lang}/meet/join#mg_…`. Belirteç **URL parçasında** taşınır. Tarayıcı bunu sunucuya göndermez; Nginx erişim loglarına, `Referer`'a ve SSR'ye düşmez. Sayfa parçayı okuyup gövdeyle POST eder, ardından `history.replaceState` ile adres çubuğundan siler. Blog önizleme `?t=` kullanıyordu; toplantı bağlantısı kurum dışına dağıtıldığı için daha sıkı bir biçim seçildi.
- İptal: `DELETE /meetings/:id/guest-link` veya toplantı iptali `guestTokenHash = null` yapar. Yeniden üretme eski özetin üzerine yazar.
- Karşılaştırma: Özet doğrudan `findUnique` ile aranır (256 bit entropi kaba kuvveti anlamsız kılar). Bulunan kayıtta ayrıca `timingSafeEqualHex` ile doğrulanır (blog `verifyShareToken` deseni). Bulunamayınca `DUMMY_HASH` karşılaştırması yapılarak yanıt süresi dengelenir.
- Misafir oturum belirteci `gs_v1…`: HMAC-SHA256, HKDF bağlamı `"meeting-guest-v1"`. Blog anahtarından ayrı bağlam kullanıldığı için çapraz kullanılamaz. İçeriği `meetingId` + `guestId` + son geçerlilik. Sabit zamanlı imza karşılaştırması yapılır.

### 6.2 Kaba kuvvet ve oran sınırı

| Uç | Sınır (IP) | Not |
|---|---|---|
| `POST /meet/guest/preflight` | 30/dk | |
| `POST /meet/guest/join` | 30/dk | Yoklama 5 sn; istemci 429'da `Retry-After` kadar bekler |
| `POST /meetings/:id/host-token` | 10/dk | meeting-token ile aynı |
| `POST /meetings`, `POST …/guest-link` | 10/dk | |
| `POST …/invite` | 5/dk + toplantı başına 10 | E-posta spam rölesi olmasın diye |
| `PATCH /admin/users/:id/meeting-host` | `ADMIN_USERS_RATE_LIMIT` | mevcut |

- Misafir uçları **yalnızca tarayıcıdan** çağrılır (client component). SSR iç kovası (`security.ts:54-58`) kullanılmaz. Belirteç zaten parçada olduğu için SSR'ye ulaşamaz.
- Misafir oturumu oluşturma: Toplantı başına en çok 50 `ExternalMeetingGuest` satırı. Aşılınca 409 `MEETING_FULL` döner; bağlantı sızdırılıp bot ile doldurulmaya çalışılırsa DB şişmez.
- Kapasite hem uygulama katmanında (§4.3 adım 6) hem LiveKit `maxParticipants` ile zorlanır.

### 6.3 Bilgi sızıntısı

- Geçersiz, bozuk, süresi dolmuş, iptal edilmiş, bitmiş ve "çıkarılmış misafir oturumu" durumlarının hepsi **aynı 404 gövdesini** döndürür: `MEETING_LINK_INVALID`, sabit mesaj, aynı başlıklar. Test bunu bayt bayt karşılaştırır.
- LiveKit yapılandırma durumu (503) yalnızca geçerli belirteç sahibine görünür (§4.3 adım 2).
- Ev sahibi uçlarında başkasının toplantısı 404 döner (403 değil). ADMIN dahil.
- Misafire giden veri: `title`, ev sahibi görünen adı, başlangıç/bitiş. `note`, ev sahibi e-postası, diğer misafirlerin adları (LiveKit'te görünenler dışında) ve `meetingId` döndürülmez.
- Misafir sayfası `noindex`, `Referrer-Policy: no-referrer` (sayfa meta etiketi ile; Nginx değişmez).
- Hata mesajlarında ve loglarda belirteç, özet veya oda adı yer almaz (oda adı yalnızca token yanıtında).

### 6.4 Bekleme odası

- Misafir, ev sahibi odaya gelene kadar **LiveKit'e hiç bağlanmaz**. Token verilmediği için istemci tarafı atlatma mümkün değildir.
- "Misafirleri doğrudan al" (`autoAdmitGuests`) açıksa ev sahibi beklenmez. Toplantı sırasında ev sahibi panelden veya odadan açıp kapatabilir.
- Ev sahibi ayrıldıktan sonra odadaki misafirler kalır. Yeni gelenler tekrar bekler (otomatik kabul kapalıysa). Ev sahibi tek tek "çıkar" diyebilir.
- Misafir başına tek tek "kabul et" akışı bu turda **yok** (talimatta istenmedi). → S8.

### 6.5 Misafir adı doğrulama (sunucu, Zod + yardımcı)

1. `String.prototype.normalize("NFC")`, baş ve son boşluk kırpma, iç boşlukları teke indirme.
2. Uzunluk 2–40 karakter (grapheme değil, kod noktası).
3. İzin verilen: `^[\p{L}\p{M}][\p{L}\p{M}\p{Nd} .'\-]{1,39}$` (u bayrağı). Rakam ikinci karakterden itibaren serbest; `<`, `>`, `&`, `"`, `/`, `:` ve kontrol karakterleri yasak.
4. Yasak kod noktaları: C0/C1 kontrol, `U+200B–U+200F`, `U+202A–U+202E`, `U+2066–U+2069` (bidi geçersiz kılma, görünmez karakter).
5. `meet-`, `doctor:`, `patient:`, `interpreter:`, `qa-listener-` ile başlayamaz (`participant-label.ts:44` önekleriyle karışmasın).
6. İstemci aynı kuralları gösterir, ama sunucu bağlayıcıdır.
7. XSS: Ad yalnızca React metin düğümü olarak render edilir (`dangerouslySetInnerHTML` yok). E-postaya konmaz. Admin listesinde de düz metin olarak gösterilir.

### 6.6 Zaman penceresi

- Ev sahibi ve misafir: `startsAt − 15 dk ≤ şimdi < endsAt` aralığında token alınabilir. Hesap sunucu saatiyle yapılır, istemciden zaman alınmaz.
- Bitişten sonra yeni katılım yoktur. Odadakiler `endsAt + 10 dk` grace ile süpürücü tarafından atılır. İstemcide `EndingSoonNotice` (`session-timer.tsx:65`) uyarı gösterir. → S7.

### 6.7 Diğer

- Yetki her istekte taze DB'den okunur. Geri alma anında etkilidir; açık oturumu süpürücü kapatır (S3 kabul edilirse).
- CSRF: Uçlar mevcut Bearer token modelini kullanır (çerez tabanlı oturum yazma yok). Misafir uçları oturumsuzdur.
- security-agent, uygulamadan sonra yeni uçları ve grant'ları denetler. compliance-agent, misafir adı saklama süresini değerlendirir.

---

## 7. Yetki kontrolü — özet akış

```
PATCH /admin/users/:id/meeting-host  (ADMIN, 2FA'lı, panel)
   └─ uygunluk: panel rolü VEYA DoctorProfile → User.meetingHostGrantedAt = now / null
      └─ audit user.meeting_host_granted|revoked {from,to}
      └─ (geri almada, S3) gelecek toplantılar CANCELLED

requireMeetingHost(userId)  — her /meetings/* isteğinde, taze okuma
   ├─ user.status === ACTIVE
   ├─ role === ADMIN || meetingHostGrantedAt != null      → değilse 403 MEETING_HOST_FORBIDDEN
   ├─ twoFactorEnabled (S2)                               → değilse 403 TWO_FACTOR_REQUIRED
   └─ tekil uçlarda meeting.hostUserId === user.id        → değilse 404 MEETING_NOT_FOUND
```

Frontend görünürlüğü (`canHostMeetings`) yalnızca kullanılabilirlik içindir. Sunucu her istekte bağımsız karar verir (`sidebar.tsx` yorumundaki ilkeyle aynı).

Audit eylemleri (tamamı; metadata'da belirteç, URL, ad, e-posta ve not yok):
`user.meeting_host_granted`, `user.meeting_host_revoked`, `meeting.created`, `meeting.updated` (değişen alan adları), `meeting.cancelled`, `meeting.guest_link.created`, `meeting.guest_link.revoked`, `meeting.host_token.issued`, `meeting.guest.joined` (`{guestId}`, IP'siz), `meeting.guest.removed`, `meeting.invite.sent` (`{count:1}`), `meeting.closed` (`{reason}`).

---

## 8. Ekran akışı

### 8.1 Admin → Kullanıcılar (`frontend/src/app/admin/users/page.tsx`)
- Uygun kullanıcı satırında veya detay çekmecesinde "Harici toplantı oluşturabilir" anahtarı bulunur. ADMIN satırında kilitli ve açık görünür ("Adminler her zaman yetkili"). Uygun olmayan kullanıcıda anahtar gizlidir.
- Değişiklik onay diyaloğu ile yapılır. Geri almada "Bu kullanıcının N gelecek toplantısı iptal edilecek" uyarısı gösterilir (S3).

### 8.2 Yetkili kullanıcı → "Toplantılar"
- **Giriş:** `/admin/meetings` (kenar çubuğu öğesi, `canHostMeetings`) veya `/{lang}/doctor/meetings` (`doctor-portal-shell.tsx` menüsü). İkisi de `MeetingsManager` kullanır.
- **Liste:** "Yaklaşan" ve "Geçmiş" sekmeleri. Satırda başlık, tarih/saat (kullanıcının saat dilimi + İstanbul), süre, katılımcı sınırı ve durum rozeti (Yaklaşan / Açık / Bitti / İptal) bulunur. Eylemler: Katıl (yalnızca pencere açıkken), Bağlantıyı kopyala/yenile, E-postayla gönder (isteğe bağlı), Düzenle, İptal.
- **Oluşturma formu (diyalog):** Başlık, tarih, saat, süre seçimi (15/30/45/60/90/120), katılımcı sınırı (2–8, varsayılan 4), not (yalnızca size görünür), "Misafirleri doğrudan al" anahtarı. Gönderimden sonra **bağlantı paylaşma kartı** açılır: bağlantı alanı + "Kopyala" düğmesi. "Bu bağlantı yalnızca şimdi tam olarak gösterilir; kaybederseniz yenileyin (eskisi geçersiz olur)" uyarısı yer alır. İsteğe bağlı "E-postayla gönder" alanı da buradadır.
- **İptal:** Onay diyaloğu "Toplantı iptal edilir, misafir bağlantısı çalışmaz, odadaki herkes çıkarılır" der.

### 8.3 Ev sahibi odası — `/{lang}/meet/{meetingId}` (oturum gerekli)
- Ön ekran: `PrejoinDeviceCheck` + toplantı başlığı + "Katıl". Pencere dışındaysa geri sayım gösterilir ("15 dk önce açılır").
- Oda: `MeetingStage` (ızgara, en çok 8 kutu; ekran paylaşımı varsa ana kutu), `RoomControlBar` (ekran paylaşımı dahil), `SessionTimer` ve `EndingSoonNotice`.
- Yan panel "Katılımcılar": bekleyen misafirler (ad + bekleme süresi), odadakiler, "Çıkar" düğmesi, **"Misafirleri doğrudan al"** anahtarı (PATCH `autoAdmitGuests`), "Bağlantıyı kopyala/yenile".
- Ayrıl: Panel listesine döner. Doktor subdomain'deyse doktor host'una tam sayfa dönüş yapılır (consultation `:302-318` deseni).
- Yönlendirme: Doktorların ana host'ta bu sayfaya erişebilmesi için `doctor-portal-route-guard.tsx::isDoctorSharedRouteException` içine `/meet/{id}` ve `/meet/join` istisnası eklenir (`/consultation` ve `/blog/preview` emsali). `proxy.ts` değişmez.

### 8.4 Misafir — `/{lang}/meet/join#mg_…` (oturum gerekmez, 9 dil, RTL)
1. Sayfa parçayı okur ve adres çubuğundan siler → `preflight`. 404 gelirse tek tip "Bu bağlantı geçersiz veya süresi dolmuş" ekranı gösterilir (sebep belirtilmez).
2. `phase: upcoming` ise "Toplantı {saat}'te başlıyor; 15 dk önce açılır" ekranı ve geri sayım gösterilir, açılınca otomatik geçilir.
3. **Ad girişi:** Tek alan, canlı doğrulama, KVKK kısa notu ("Yalnızca adınız ve katılım saatiniz kaydedilir; görüşme kaydedilmez"). Bunun altında cihaz testi (`PrejoinDeviceCheck`) yer alır.
4. "Katıl" → `join`. `waiting` gelirse **bekleme ekranı** açılır: "Ev sahibi birazdan sizi alacak", kendi kamera önizlemesi ve 5 sn yoklama. Sekme gizliyken yoklama 15 sn'ye düşer.
5. `ready` → `MeetingRoom` (misafir modu): `MeetingStage` + `MeetingGuestControlBar` (mikrofon, kamera, ayarlar, ayrıl; **ekran paylaşımı yok**).
6. `MEETING_FULL` → "Toplantı dolu". Odadayken çıkarılma veya toplantı bitişi → "Toplantı sona erdi" ekranı. Bu ekranda yeniden bağlanma döngüsü yoktur: `disconnectKind` PARTICIPANT_REMOVED veya ROOM_DELETED ise terminal kabul edilir.
7. Yeniden bağlanma: `useAppReconnect` aynı `guestSession` ile `join`'i çağırır (aynı kimlik, yeni token).

### 8.5 Yeni frontend dosyaları (öneri)
- `components/site/meeting/meeting-room.tsx` (LiveKitRoom kabuğu, ev sahibi/misafir modu)
- `components/site/meeting/meeting-stage.tsx`, `meeting-guest-control-bar.tsx`, `meeting-participants-panel.tsx`, `guest-join-flow.tsx`, `guest-name.ts` (saf doğrulama)
- `components/meetings/meetings-manager.tsx`, `meeting-form-dialog.tsx`, `meeting-link-card.tsx`
- `app/admin/meetings/page.tsx`, `app/[lang]/(doctor)/doctor/meetings/page.tsx`, `app/[lang]/(site)/meet/[id]/page.tsx`, `app/[lang]/(site)/meet/join/page.tsx`
- `lib/api/meetings.ts`, `lib/i18n/site-dictionaries/*/meeting.ts` (9 dil), admin sözlüğüne `nav.meetings` ve sayfa metinleri

**Dokunulacak mevcut dosyalar (küçük, ekleme niteliğinde):** `admin-users.routes.ts` (yeni uç), `schemas/entities.ts` ve `mappers` (`canHostMeetings`), `app.ts` (rota ve süpürücü kaydı), `lib/errors.ts`, `components/admin/sidebar.tsx` (öğe + `canHostMeetings` filtresi), `doctor-portal-shell.tsx` (menü bağlantısı), `doctor-portal-route-guard.tsx` (istisna regex'i), `app/admin/users/page.tsx` (anahtar), `docs/architecture/openapi.yaml`.

**Dokunulmayacaklar (kırmızı çizgi):** `telehealth.livekit.routes.ts`, `lib/livekit.ts`, `lib/early-join.ts`, `livekit-egress.ts`, `telehealth.recording*.ts`, `telehealth.egress-webhook.routes.ts`, `consultation-room.tsx`, `room/stage.tsx`, `room/control-bar.tsx`, `room/participant-label.ts`, `proxy.ts`, compose, Dockerfile'lar, Nginx, `.env`, LiveKit sunucu yapılandırması.

---

## 9. Test listesi

### 9.1 Backend integration (Vitest + test DB, sıralı)
1. Yetki: ADMIN veriyor ve geri alıyor → alan ve audit (`from/to`) doğru. MANAGER ve EDITOR çağırınca 403. Uygun olmayan kullanıcı (CUSTOMER, INTERPRETER, doktor olmayan USER) 422 alır. DELETED kullanıcı 404.
2. `GET /users/me` → `canHostMeetings`: ADMIN için true, yetkili için true, diğerleri için false.
3. Yetkisiz kullanıcı `/meetings/*` → 403. Geri alındıktan sonraki ilk istek 403 (taze okuma). 2FA kapalı → `TWO_FACTOR_REQUIRED` (S2 kabul edilirse).
4. Oluşturma doğrulaması: süre 15–120/5, katılımcı 2–8, varsayılan 4, geçmiş tarih, 180 gün tavanı, başlık ve not uzunluğu, 20 toplantı sınırı.
5. Yanıt hiçbir zaman `guestTokenHash` içermez. `guestLink` yalnızca oluşturma ve yeniden üretmede döner. DB'de düz belirteç yoktur.
6. Başkasının toplantısı (ADMIN dahil) GET, PATCH, host-token ve cancel isteklerinde → 404.
7. host-token: pencere öncesi 409 (`opensAt`), 15 dk öncesi 200, `endsAt` sonrası 409, iptal sonrası 409. LiveKit yapılandırılmamışsa 503. Audit yazılır, metadata'da token yoktur.
8. **Grant testi (JWT çözülerek):** Ev sahibi kaynakları {camera, mic, screen_share, screen_share_audio}. Misafir kaynakları {camera, mic}. İkisinde de `roomAdmin`, `roomRecord`, `roomCreate`, `roomList` ve `hidden` yok. `canPublishData=false`, `canUpdateOwnMetadata=false`. `room` `meet_` ile başlar. Kimlik önekleri doğru. TTL ≤ `LIVEKIT_TOKEN_TTL_MIN` ve ≤ `endsAt + grace`.
9. **Regresyon:** Mevcut `meeting-token` testleri değişmeden geçer. Ayrıca `createMeetingToken` grant anlık görüntüsü değişmemiştir.
10. Misafir: geçersiz biçim, bilinmeyen belirteç, iptal edilmiş bağlantı, yeniden üretilmiş eski belirteç, iptal edilmiş toplantı, bitmiş toplantı ve çıkarılmış oturum için **gövde ve durum kodu bayt bayt aynı** 404.
11. Misafir: pencere öncesi 409 `opensAt`. Ev sahibi yokken `waiting`. Ev sahibi gelince `ready` (LiveKit katılımcı listesi taklit edilir). `autoAdmitGuests=true` ise anında `ready`. Kapasite dolu → 409. Toplantı başına 50 oturum sınırı.
12. Ad doğrulaması: 1 karakter, 41 karakter, `<script>`, bidi karakteri, sıfır genişlikli boşluk ve `meet-host:x` reddedilir. "Zeynep Kaya", "José María", "محمد", "O'Brien" ve "Anne-Marie" kabul edilir. Sonuç NFC'dir.
13. `guestSession` imzası: kurcalanmış, başka toplantıya ait veya süresi dolmuş oturum → 404. Geçerli oturum aynı kimliği yeniden alır.
14. Oran sınırı: join uç sınırı aşılınca 429 `Retry-After`.
15. İptal: misafir bağlantısı 404 verir, `removeRoomParticipant` yalnızca `meet-` önekli kimliklerle çağrılır, audit yazılır.
16. Süpürücü: bitiş + grace geçen ve iptal edilen toplantılarda atar ve `closedAt` yazar. `room_` önekli bir oda adı verilirse **hiçbir şey yapmaz** ve hata loglar. Atma hatasında `closedAt` yazılmaz.
17. Audit metadata'sı belirteç, URL, misafir adı, e-posta ve IP içermez (misafir olaylarında `ipAddress` null).
18. Davet (isteğe bağlı): e-posta saklanmaz, gönderim hatası 202'yi bozmaz, toplantı başına 10 sınırı.
19. Statik güvence: `startRoomCompositeRecording(` çağrısı yalnızca `telehealth.recording.routes.ts` içinde bulunur (grep testi).

### 9.2 Frontend unit (Vitest + Testing Library)
1. `guest-name.ts`: sunucuyla aynı kabul ve red tablosu.
2. `MeetingGuestControlBar`: ekran paylaşımı düğmesi yok. Mikrofon, kamera, ayarlar ve ayrıl düğmeleri var.
3. `MeetingStage`: 1–8 katılımcıda ızgara sütunları doğru. Ekran paylaşımı ana kutuda. Etiket token `name`'inden gelir ve identity hiç görünmez.
4. `guest-join-flow`: parça okunup adres çubuğundan silinir. 404 → tek tip geçersiz ekran. `waiting` → bekleme ve yoklama. `ready` → oda. `MEETING_FULL` ve `MEETING_NOT_OPEN` ekranları. Terminal kopmada yeniden bağlanma yok.
5. `MeetingsManager`: form doğrulaması, bağlantı kartı ve kopyalama, iptal onayı, pencere dışında "Katıl" pasif.
6. Kenar çubuğu: `canHostMeetings` false iken "Toplantılar" gizli (mevcut `sidebar-role-visibility` testine satır eklenir). Doktor portalı menüsü de aynı şekilde.
7. `isDoctorSharedRouteException`: `/en/meet/abc` ve `/meet/join` true, `/en/meeting` false.
8. 9 dil sözlük anahtar eşitliği (mevcut sözlük tamlık testi deseni).

### 9.3 E2E (Playwright, headless, sıralı)
1. Admin bir EDITOR'e yetki verir. EDITOR `/admin/meetings`'te toplantı oluşturur ve bağlantıyı kopyalar.
2. Misafir (ayrı bağlam, oturumsuz) bağlantıyı açar, adını girer ve bekleme ekranını görür. Ev sahibi katılınca misafir otomatik odaya girer. İki tarafta da ad etiketleri doğrudur.
3. Misafir ekranında ekran paylaşımı düğmesi yoktur. Ev sahibinde vardır.
4. "Misafirleri doğrudan al" açıkken ev sahibi yokken misafir doğrudan girer.
5. Ev sahibi bağlantıyı yeniler. Eski bağlantı "geçersiz" ekranını gösterir.
6. Ev sahibi toplantıyı iptal eder. Odadaki misafir "Toplantı sona erdi" görür. Bağlantı geçersizdir.
7. Doktor hesabı: `/doctor/meetings` → oluştur → katıl (doktor host istisnası).
8. Admin yetkiyi geri alır. Kullanıcının menüsünden öğe kaybolur ve uç 403 verir.
9. Regresyon: Mevcut consultation e2e paketi (hasta/doktor görüşmesi) değişmeden yeşil kalır.

(LiveKit gerektiren e2e adımları mevcut yerel LiveKit kurulumuyla koşar. Kurulum yoksa 2–4 ve 6 numaralı adımlar mevcut consultation e2e'lerindeki atlama kuralını izler.)

---

## 10. Tahmini iş büyüklüğü

| Katman | Dosya (yeni / değişen) | Satır (yaklaşık, test hariç) | Test satırı |
|---|---|---|---|
| Prisma + migration (db-agent) | 1 / 1 | ~90 | — |
| OpenAPI kontratı (architect) | 0 / 1 | ~450 | — |
| Backend: rotalar (`meetings.routes.ts`, `meetings.guest.routes.ts`), `meeting-livekit.ts`, `meeting-token.ts` (mg_/gs_), `guest-name.ts`, `meeting-sweeper.ts`, şemalar, hatalar, admin-users ucu, DTO alanı, app kaydı | 8 / 5 | ~1.300 | ~1.100 |
| E-posta daveti (isteğe bağlı, notification-agent + integration-agent) | 1 / 0 | ~120 | ~80 |
| Frontend: meeting-room, stage, guest bar, katılımcı paneli, guest join akışı, manager, form, bağlantı kartı, 4 sayfa, API istemcisi | ~14 / 5 | ~1.900 | ~700 |
| Sözlükler (9 dil `meeting.ts` + admin/portal anahtarları) | 9 / 3 | ~650 | (tamlık testi) |
| E2E | 1–2 / 0 | — | ~350 |
| **Toplam** | **~35 yeni / ~15 değişen** | **~4.500** | **~2.250** |

Süre (tek geliştirici akışı, sıralı test koşuları dahil): backend + migration **2–2,5 gün**, frontend **2,5–3 gün**, e2e + güvenlik denetimi + düzeltmeler **1 gün**. **Toplam yaklaşık 6–6,5 gün.** E-posta daveti çıkarılırsa yaklaşık 0,5 gün azalır.

Ajan sırası (onaydan sonra release-coordinator'a): architect (openapi) → db-agent (migration) → integration-agent (`meeting-livekit.ts`, süpürücü) ∥ backend-agent (rotalar, yetki) → frontend-agent ∥ ui-designer (ızgara ve bekleme ekranı tokenleri) → security-agent → compliance-agent → qa-agent → documentation-agent.

---

## 11. Açık sorular (onay gerekli)

- **S1 — Panel yeri:** Hem `/admin/meetings` hem `/{lang}/doctor/meetings` öneriliyor. Yalnızca birinde olsun mu?
- **S2 — 2FA zorunluluğu:** Ev sahibi olmak için 2FA şart olsun mu? (Öneri: evet. Doktorlar ve ADMIN/MANAGER için zaten fiilen zorunlu; EDITOR için yeni bir zorunluluk getirir.)
- **S3 — Yetki geri alınınca** kullanıcının gelecekteki toplantıları otomatik iptal edilsin mi? (Öneri: evet.) Yoksa toplantılar kalsın ve yalnızca yeni toplantı ile katılım mı engellensin?
- **S4 — Admin gözetimi:** ADMIN tüm toplantıları listeleyip iptal edebilsin mi? (Öneri: evet. Katılım hakkı yok, Paket E ilkesi.)
- **S5 — E-posta daveti:** Bu tura dahil mi? Düz belirteç saklanmadığı için "e-postayla gönder" **yeni bir bağlantı üretir** ve eski kopyalanmış bağlantıyı geçersiz kılar. Alternatif: Yalnızca oluşturma anındaki kartta "e-postayla gönder" sunulur (bağlantı o an bellekte olduğu için yeniden üretme gerekmez). Öneri: alternatif yöntem.
- **S6 — Misafir kaydı ve saklama:** Misafir adı yalnızca `ExternalMeetingGuest`'te tutulur, audit'e ad ve IP yazılmaz. Saklama süresi 90 gün önerisi compliance-agent'a gidecek. Kabul mü?
- **S7 — Bitişte davranış:** Yeni katılım `endsAt`'te kapanır. Odadakiler **10 dk grace** sonunda sunucu tarafından çıkarılır. Grace süresi ve "uzat" düğmesi istenir mi? (Öneri: bu turda uzatma yok.)
- **S8 — Bekleme odası kapsamı:** Talimattaki model "ev sahibi gelene kadar bekle" şeklinde. Misafir başına "kabul et / reddet" (gerçek lobi) istenir mi? (Öneri: bu turda hayır; "çıkar" düğmesi var.)
- **S9 — Toplantı başlığı misafire görünsün mü?** Başlık hasta bilgisi içerebilir (ör. "Ayşe K. ön görüşme"). Öneri: Görünsün, formda "misafirlere görünür" uyarısı olsun. Not alanı hiçbir zaman görünmez.
- **S10 — Doktor host istisnası:** `doctor-portal-route-guard.tsx` içine `/meet/{id}` ve `/meet/join` istisnası eklenmesi (blog önizleme emsali) onaylanıyor mu?
- **S11 — Katılımcı sınırı:** Varsayılan 4, en çok 8 (ev sahibi dahil sayılır). "Misafir sayısı" olarak mı yorumlanmalı?
