# architect — Dar Kapsamlı Karar Dokümanı: Dev Demo Ödemesi + Doktor Konsolu Sayaçları

**Durum:** BAĞLAYICI. İki bağımsız istek, tek doküman. Kapsam dar — `.claude/architect-scope-telehealth-template.md` [TCT] ve `.claude/architect-scope-doctor-portfolio-identity-console.md` [DPI] yürürlüktedir; bu doküman onları **değiştirmez**, yalnızca iki noktada genişletir.

**Branşlar (ayrı ayrı, birleştirilmez):**
- `feature/dev-demo-payment` (İstek 1)
- `feature/doctor-upcoming-counters` (İstek 2)

---

## İSTEK 1 — Geliştirme/Demo Ödeme Simülatörü

### 1.1 KARAR: KABUL (dar istisna, koşullu)

"Dürüst-yapılandırılmamışlık" sözleşmesi (`lib/errors.ts` `PaymentsNotConfiguredError`/`LiveKitNotConfiguredError`/`RecordingNotConfiguredError`, `lib/mail.ts`) **AYNEN YÜRÜRLÜKTE KALIR**. Demo ödemesi bu sözleşmeyi **ihlal etmez**, çünkü kategorisi farklıdır:

| Yasak olan (§4.4 madde 1) | Bu karar |
|---|---|
| Yapılandırılmamış bir servisin VAR gibi davranması | Stripe yokken `checkout-session` **hâlâ 503** döner; `PaymentsNotConfiguredPanel` **kaldırılmaz** |
| Sistemin kendiliğinden sahte veriyle devam etmesi | Yalnızca geliştiricinin **açık, tek tıklık** eylemiyle tetiklenir |
| Prod'da mock/escrow ekranı | Prod build'de uç **hiç kayıt edilmez** (404), buton **bundle'lanmaz** |

**Neden Stripe test-mode yetmiyor (gerekçe, kayda geçer):** Stripe test anahtarları ücretsizdir ve tercih edilen yoldur — ancak (a) webhook teslimi local'de `stripe listen`/tünel + ayrı imza sırrı gerektirir; webhook gelmezse booking `PENDING` takılır ve bu **en sık karşılaşılan** kilitlenmedir, (b) Playwright e2e'nin Stripe'ın barındırılan ödeme sayfasını sürmesi 3. parti bir siteye ve ağa bağımlıdır — deterministik değildir. Demo ucu bu ikisini çözer; **Stripe test-mode'un yerini almaz**.

**Zaten var olan emsal:** `POST /admin/telehealth/bookings/{id}/mark-paid` (§9.7.1 madde 7) prod'da dahi Stripe'sız `PAID` yazar. Demo ucu, onun **dev'e kilitli, hasta-kapsamlı** kardeşidir — yeni bir felsefe değil, mevcut bir yeteneğin daha dar bir kapısı.

**Kabulün bedeli (ihlali = revert gerekçesi):** demo ile ödenmiş satır DB'de **kendini asla gerçek Stripe ödemesi gibi göstermez** (bkz. 1.4).

### 1.2 Uç ve dosya sahipliği

```
POST /appointments/bookings/{bookingId}/demo-pay
```

- **Dosya:** `backend/src/modules/telehealth/telehealth.demo-payment.routes.ts` — **YENİ, ayrı dosya**. `telehealth.routes.ts`'e (her zaman kayıtlı, koşullu register edilemez) ve `telehealth.checkout.routes.ts`'e (integration-agent'ın sahası) **DOKUNULMAZ**.
- **Sahip: backend-agent.** Bu uç Stripe SDK'sına, webhook'a veya herhangi bir 3. parti API'ye **HİÇ DOKUNMAZ** → integration-agent'ın sahası **DEĞİLDİR**. integration-agent yalnızca gözden geçirir (`stripePaymentIntentId`/`stripeCheckoutSessionId` yazılmadığını doğrular).
- **Kayıt:** `backend/src/app.ts`, mevcut `telehealthCheckoutRoutes`/`telehealthLiveKitRoutes` deseniyle aynı satır bloğunda, **koşullu**:
  ```
  if (isDemoPaymentsEnabled) api.register(telehealthDemoPaymentRoutes);
  ```

### 1.3 Güvenlik modeli (TAM ve BAĞLAYICI — eksiksiz uygulanacak)

**Gating — "VEYA" değil, üç katman AND:**

1. **Env (VE, iki bayrak birden):** `env.NODE_ENV !== "production"` **VE** `env.ENABLE_DEMO_PAYMENTS === true`. Tek başına `NODE_ENV !== "production"` **YETERSİZDİR** (staging/CI ortamları çoğu zaman `development`/`test` ile koşar).
   - `backend/src/config/env.ts`: `SMTP_SECURE` ile **birebir aynı desen** — `z.enum(["true","false"]).default("false").transform(v => v === "true")`. `z.coerce.boolean()` **KULLANILMAZ** (boş olmayan her string'i `true` yapar).
   - `export const isDemoPaymentsEnabled = env.NODE_ENV !== "production" && env.ENABLE_DEMO_PAYMENTS;` (`isProd` ile aynı yerde).
   - **Fail-closed boot koruması (zorunlu):** `NODE_ENV === "production"` iken `ENABLE_DEMO_PAYMENTS=true` verilmişse uygulama **açık ve okunur bir hata ile BAŞLAMAZ** (env doğrulamasında throw). Sessizce yok saymak, yanlış `.env` kopyasının fark edilmeden prod'a gitmesi demektir; bu proje sessiz düşüşü değil gürültülü hatayı seçer.
2. **Register-time gizleme:** Bayrak kapalıyken route **hiç register edilmez** → uç `404` döner, `403` değil. `middleware/module-guard.ts`'in "kapalı olanın varlığı sızdırılmaz" felsefesiyle birebir aynı.
3. **Runtime ikinci kontrol (defense-in-depth):** Handler'ın İLK satırı yine `if (!isDemoPaymentsEnabled) throw new NotFoundError();`. Gelecekte biri `app.ts`'deki koşulu refactor ederken düşürürse uç yine kapalı kalır.

`STRIPE_SECRET_KEY` **gating'e DAHİL EDİLMEZ**: Stripe test anahtarları tanımlı ama webhook tüneli olmayan kurulum, bu ucun **birincil** kullanım senaryosudur.

**Auth/yetkilendirme — YENİ MEKANİZMA İCAT EDİLMEZ**, `checkout-session` ile birebir aynı zincir:

```
preHandler: requireModuleEnabled("telehealth")
preHandler: authenticateOptional
config.rateLimit: BOOKING_CHECKOUT_SESSION_RATE_LIMIT   (lib/rate-limit.ts, mevcut sabit yeniden kullanılır)
params: BookingIdParamSchema, querystring: AccessTokenQuerySchema
→ assertBookingPatientOnlyAccess(booking, { user: request.user, providedToken: request.query.t })
```

Yani: **yalnızca booking sahibi hasta** — oturumlu (`patientUserId` eşleşmesi) **veya** doğru `?t=` magic-link token'ı (TTL dahil). Yetkisiz erişim `404` (IDOR disiplini). Doktor **HAYIR**, `MANAGER` **HAYIR**, `ADMIN` **HAYIR** (ADMIN'in zaten `mark-paid` ucu var).

**Ön koşullar — `checkout-session` ile aynı sıra ve aynı hata kodları** (demo yolu gerçek yolun kabullerini birebir sınamalıdır):
- `booking.paymentStatus !== "PENDING"` → `BookingNotPayableError` (409)
- `booking.expiresAt < now` → `BookingExpiredError` (409)

### 1.4 Endpoint davranışı (kod tekrarı YASAK)

Handler **kendi durum geçişini YAZMAZ**; `backend/src/modules/telehealth/lib/booking.ts::confirmBookingPayment`'ı **DOĞRUDAN** çağırır — gerçek Stripe webhook'unun (`modules/webhooks/stripe.routes.ts`) ve ADMIN `mark-paid`'in çağırdığı **aynı** fonksiyon. Böylece `paymentStatus=PAID` + `paidAt` + tüm `PENDING_PAYMENT` randevuların `SCHEDULED`'a geçişi tek `runSerializable` transaction'da, **tek yerde** yaşamaya devam eder.

```
confirmBookingPayment(app, {
  bookingId,
  paidBy: "demo",                                  // ← "stripe"/"manual" DEĞİL. Zorunlu.
  paidNote: "Geliştirme ortamı demo ödemesi — gerçek tahsilat YAPILMAMIŞTIR.",
  knownRawAccessToken: request.query.t,            // varsa; yoksa undefined
})
```

Bağlayıcı kurallar:
- `paidBy: "demo"` **zorunludur** — demo ile ödenmiş bir satır DB'de, faturada, denetimde **sonsuza dek ayırt edilebilir** kalır. Bu, 1.1'deki istisnanın bedelidir.
- `stripePaymentIntentId` / `stripeCheckoutSessionId` **ASLA yazılmaz** (sahte Stripe kimliği üretmek = sözleşme ihlali).
- `knownRawAccessToken`: `?t=` ile gelindiyse **aynen geçirilir** (token rotate edilmez, hastanın mevcut magic-link'i çalışmaya devam eder — Stripe metadata yolunun aynısı). Oturumlu akışta verilmez, token rotate olur; **rotate edilen ham token yanıta KONULMAZ, LOGLANMAZ** — yalnızca onay e-postasına gider.
- **Bildirim:** ADMIN `mark-paid` ile aynı — `triggerAppointmentConfirmationEmail(app, { booking, appointments, rawAccessToken })`, best-effort (e-posta hatası ucu 500 yapmaz). Amaç uçtan uca akışın tamamını test edilebilir kılmaktır.
- **Denetim:** `logAudit` çağrılmaz (aktör anonim misafir olabilir; audit kaydı kimliklendirilmiş aktör bekler). Yerine `app.log.warn({ bookingId }, "DEMO PAYMENT — gerçek tahsilat yok")` **zorunludur**.
- **Yanıt:** `ApiSuccessSchema(AppointmentBookingSchema)` + `toAppointmentBookingDto(withRelations, canAccessBookingHealthData(...))` — ADMIN `mark-paid` ile birebir aynı yanıt şekli. Yeni DTO **icat edilmez**.

### 1.5 Frontend

**Dosya:** `frontend/src/components/site/telehealth/booking-payment-step.tsx` (frontend-agent).

- **Bayrak:** `frontend/src/lib/env.ts`'e `export const DEMO_PAYMENTS_ENABLED = process.env.NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS === "true";` — **statik `process.env.FOO` üye erişimi zorunlu** (Next yalnızca statik erişimi inline eder; bkz. `lib/image-hosts.ts` notu). Bu sayede prod build'de değer `false`'a sabitlenir ve buton bloğu **dead-code elimination ile bundle'dan tamamen düşer**. Karar: **bundle'lanmaması tercih edilir**, yalnızca "render edilmemesi" yeterli sayılmaz.
- **Görünürlük koşulu:** `DEMO_PAYMENTS_ENABLED` **TEK BAŞINA**; `paymentsConfigured`'a **bağlanmaz**. Gerekçe: Stripe yapılandırılmış ama webhook ulaşmayan kurulum birincil senaryodur.
  - `paymentsConfigured === false` → buton `PaymentsNotConfiguredPanel` içinde, panelin metnini değiştirmeden **altına** eklenir (panel metni ve 503 davranışı **korunur**).
  - `paymentsConfigured === true` → normal "Ödemeye Geç" butonunun **altında**, ikincil (`variant="outline"`) olarak.
- **Etiket/uyarı (aynen):** buton `Demo Ödemeyi Tamamla (Test)`, altında küçük uyarı satırı: `Yalnızca geliştirme ortamı — gerçek tahsilat yapılmaz.`
- **ui-designer gerekmez:** mevcut `Button variant="outline"` + `Alert variant="warning"` tokenleri yeterlidir, yeni görsel patern yoktur.
- **404 dayanıklılığı:** FE bayrağı açık, BE bayrağı kapalı olabilir → uçtan gelen `404` `friendlyErrorMessage` ile gösterilir, çökme/boş ekran olmaz.
- **Başarıdan sonra:** sihirbaz mevcut başarı akışına girer (`?payment=success` dönüşüyle aynı sonuç durumu) — yeni bir yönlendirme mekanizması icat edilmez.
- **API istemcisi:** `frontend/src/lib/api/telehealth.ts` içine `createBookingCheckoutSession` ile aynı imza tarzında `demoPayBooking(bookingId, accessToken?)`.

### 1.6 openapi.yaml

**EVET, kontrata eklenir** — kontrat tek doğruluk kaynağıdır; frontend bu ucu tüketiyorsa sözleşme dışı kalamaz. **Sahip: backend-agent** (integration-agent'ın `checkout-session`/`/webhooks/stripe` bloklarına **dokunulmaz**).

- Konum: `docs/architecture/openapi.yaml`, TeleHealth bölümünde `/appointments/bookings/{bookingId}/checkout-session` girdisinin **hemen ardından**.
- Zorunlu içerik: `x-dev-only: true`; açıklamada **"Yalnızca `NODE_ENV !== production` VE `ENABLE_DEMO_PAYMENTS=true` iken kayıtlıdır; üretimde bu uç YOKTUR (404)"**; `security: []` + `?t=` / Bearer alternatifi; `paidBy: "demo"` etiketinin kalıcılığı; yanıt `AppointmentBooking`; hatalar `404` (kapalı/yetkisiz), `409` (`BOOKING_NOT_PAYABLE`, `BOOKING_EXPIRED`).
- Dosya başındaki "BAĞLAYICI SINIRLAR" yorum bloğuna bir satır eklenir: `demo-pay` **backend-agent**'ındır, integration-agent'ın Stripe sahası değildir.

---

## İSTEK 2 — Doktor Konsolu "Gelecek Randevular" Sayacı

### 2.1 Teyit: bu bir filtre bug'ı DEĞİL

`GET /doctor/bookings?scope=upcoming` (satır ~201-202) **doğrudur**; `PENDING_PAYMENT`'ın hariç tutulması **kasıtlı ve doğru** davranıştır (ödenmemiş tutma "gelecek onaylı randevu" değildir). **Değiştirilmez.**

İstek 1 uygulandıktan sonra demo ödemesi `confirmBookingPayment` üzerinden randevuları `SCHEDULED` yapar → booking **kendiliğinden** `upcoming` kapsamına girer. Dolayısıyla İstek 2'nin **tek gerçek eksiği sayaçtır**.

### 2.2 backend-agent — `GET /doctor/overview`'a iki alan

`DoctorConsoleOverviewSchema`'ya (`backend/src/schemas/entities.ts`) eklenir:
- `upcomingBookingTotal: z.number().int()`
- `allBookingTotal: z.number().int()`

**Semantik (bağlayıcı):** sekmeler **booking** listeler → sayaçlar da **booking** sayısıdır (`appointmentBooking.count`), randevu sayısı değil. Aksi hâlde rozet ile görünen satır sayısı tutmaz.
- `upcomingBookingTotal` = `count({ doctorId, ...upcomingScopeFilter })`
- `allBookingTotal` = `count({ doctorId, appointments: { some: {} } })` — `/bookings`'in varsayılan `scope=all` davranışıyla **birebir aynı** ("hayalet" `EXPIRED` booking'ler hariç, satır ~207-218 gerekçesi).
- Mevcut `today.total`'ın **randevu** sayısı olduğu bilinen bir tutarsızlıktır; bu turda **DEĞİŞTİRİLMEZ**, yalnızca openapi açıklamasında not edilir.
- İki `count` mevcut `Promise.all` bloğuna eklenir (yeni round-trip turu açılmaz).

### 2.3 Filtre mantığının paylaşılması (kod tekrarı YASAK)

`scope` where-clause üretimi `telehealth.portal.routes.ts`'ten çıkarılır:

**Yeni dosya:** `backend/src/modules/telehealth/lib/doctor-booking-scope.ts`
```
buildDoctorBookingScopeFilter(scope, { timeZone, now }): Prisma.AppointmentBookingWhereInput | undefined
BOOKINGS_WITH_APPOINTMENTS_FILTER  // { appointments: { some: {} } }
```
`GET /bookings` **ve** `GET /overview` bu tek kaynağı kullanır. `/bookings`'in gözlemlenebilir davranışı **sıfır** değişir (saf refactor) — `today` dalı doktorun `timeZone`'unu parametre olarak alır, `/overview` zaten elindeki `timeZone`'u geçer.

### 2.4 openapi.yaml

**EVET** — `components.schemas.DoctorConsoleOverview`'a iki yeni alan (`required` listesine de) + açıklamalarında "booking sayısıdır, `today.total` ise randevu sayısıdır" ayrımı. **backend-agent** yapar.

### 2.5 frontend-agent

1. `doctor-bookings-panel.tsx::scopeCount` (satır ~42-55): `upcoming` → `overview.upcomingBookingTotal`, `all` → `overview.allBookingTotal`. "gerçek toplam yok" yorumu, yeni gerçeğe göre **güncellenir** (yanıltıcı yorum bırakılmaz).
2. `frontend/src/lib/api/types.ts::DoctorConsoleOverview`'a iki alan.
3. **Yalnızca DOĞRULAMA (yeniden yazım DEĞİL):** "Ödeme Bekliyor" rozeti ve "Odaya Katıl" butonunun `Appointment.status === "PENDING_PAYMENT"` temelli olduğunu `doctor-console-patient-card.tsx` ve `doctor-bookings-panel.tsx`'teki randevu satırı render'ında teyit et. Mantığın **zaten doğru olması beklenir**; gerçek bir sapma bulunursa **düzeltmeden önce architect'e bildir** (sessiz davranış değişikliği yasak).

---

## Ajan dağılımı ve sıra

Bu görev **release-coordinator'a devredilmez** — kapsam dar, bağımlılık zinciri tek yönlü ve aşağıda zaten net.

| Sıra | Ajan | İş |
|---|---|---|
| 1 | **backend-agent** | `ENABLE_DEMO_PAYMENTS` env + boot koruması; `telehealth.demo-payment.routes.ts`; `app.ts` koşullu register; `lib/doctor-booking-scope.ts` refactor; `/doctor/overview` iki sayaç; `entities.ts` şema; **openapi.yaml (her iki istek)**; unit testler |
| 2 | **frontend-agent** | `lib/env.ts` bayrağı; `booking-payment-step.tsx` demo butonu; `lib/api/telehealth.ts` + `types.ts`; `scopeCount` düzeltmesi; rozet/buton **doğrulaması** |
| 3 | **security-agent** | **Zorunlu denetim** — üç katmanlı gating'in fiilen prod'da 404 verdiği, `assertBookingPatientOnlyAccess` dışında bir yol olmadığı, ham token'ın yanıta/loga sızmadığı |
| 4 | **qa-agent** | Demo ödemesiyle uçtan uca randevu e2e'si (bayrak açıkken); prod-benzeri konfigürasyonda ucun 404 verdiği testi; doktor konsolu sayaç rozetleri. **Not:** 60sn ISR bayatlığı için `toPass`+reload polling kuralı geçerlidir |
| 5 | **documentation-agent** | `.env.example` + README: `ENABLE_DEMO_PAYMENTS` / `NEXT_PUBLIC_ENABLE_DEMO_PAYMENTS` **asla prod'da açılmaz** uyarısı; CHANGELOG |

**Devre dışı:** integration-agent (Stripe kodu değişmiyor — yalnızca gözden geçirir), ui-designer (yeni token yok), compliance-agent (yeni PII yok; demo satırları `paidBy="demo"` ile etiketli), performance-agent, db-agent (**migration YOK** — yeni kolon/model eklenmiyor).

**Commit:** Conventional Commits. Örn. `feat(telehealth): dev-only demo odeme ucu (gating: NODE_ENV + ENABLE_DEMO_PAYMENTS)`, `feat(telehealth): doktor konsolu upcoming/all booking sayaclari`.

**Docker hatırlatması:** backend/frontend değişikliği sonrası `docker compose up --build -d` zorunlu.

---

## EK KARAR — 2026-09-15: DB tabanlı admin toggle (`demoPaymentsEnabled`)

**Durum:** BAĞLAYICI. Bu bölüm §1.3'ü **DEĞİŞTİRMEZ**, yalnızca ÜZERİNE bir katman ekler.

- **§1.3'teki env tabanlı boot-time fail-closed koruma AYNEN YÜRÜRLÜKTE.** `backend/src/config/env.ts`'te HİÇBİR SATIR değişmez: `NODE_ENV=production` + `ENABLE_DEMO_PAYMENTS=true` kombinasyonu uygulamayı **boot olmaktan reddettirmeye devam eder** (`process.exit(1)`), `isDemoPaymentsEnabled` export'u ve register-time/`404` gizleme katmanları korunur.
- **Üzerine eklenen:** `SiteSettings.demoPaymentsEnabled Boolean @default(true)` (db-agent, **migration GEREKİR** — §"Devre dışı" satırındaki "db-agent: migration YOK" ifadesi YALNIZCA ilk tur için geçerliydi, bu turda geçersizdir). Nihai bayrak `isDemoPaymentsEnabled (env) && SiteSettings.demoPaymentsEnabled (DB)` şeklinde **AND**'lenir.
- **Yön kuralı (ihlal edilemez):** DB bayrağı **yalnızca KISITLAYICIDIR, asla GENİŞLETİCİ DEĞİLDİR** — env korumasını bypass edemez, üretimde demo ödemeyi açamaz. `VEYA` (OR) ile birleştirilmesi YASAKTIR.
- **Uç/rol:** YENİ uç veya YENİ rol İCAT EDİLMEZ — mevcut `PATCH /admin/settings` (`ROLES_ADMIN` + `requirePanelAccess`) genişletilir, denetim mevcut `settings.update` action'ıyla yapılır. Bayrak kapalıyken `POST .../demo-pay` **`403 DEMO_PAYMENTS_DISABLED`** döner; env kaynaklı `404` katmanları aynen kalır.
- **Frontend:** build-time `DEMO_PAYMENTS_ENABLED` dead-code-elimination katmanı KORUNUR; runtime kontrolü onun **yerine değil, yanına** (`&&`) eklenir.
- Gerekçe ve tam denetim: `.claude/security-review-demo-payment-toggle.md` (security-agent, architect onaylı). Sözleşme: `docs/architecture/openapi.yaml` — `SiteSettings.demoPaymentsEnabled` / `demoPaymentsSupported`, `UpdateSiteSettingsRequest.demoPaymentsEnabled`, `DEMO_PAYMENTS_DISABLED` (403).
