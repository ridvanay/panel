# Architect Scope — Hekim Portalı Subdomain İzolasyonu (`doktor.*`)

> **Durum:** Karar verildi, uygulamaya hazır.
> **Kapsam:** Hekim portalının (`/doctor/**`) ana vitrin/e-ticaret sitesinden host bazlı izolasyonu.
> **İlgili dokümanlar:** `.claude/architect-scope-telehealth-template.md` §K6, `.claude/architect-scope-i18n.md` §4.3,
> `frontend/src/proxy.ts` (dosya başı yorumu), `frontend/AGENTS.md`, `docker-compose.yml`, `INFRA.md`.
> **Bu doküman bağlayıcıdır.** Ajanlar arası çelişkide bu doküman + `docs/architecture/openapi.yaml` hakemdir.
> **Branş:** `feature/doctor-subdomain-isolation` — Conventional Commits (`feat(telehealth): ...`).

---

## 0. Yönetici özeti — görev tek-ajanlık DEĞİL

Görev "architect → frontend-agent → qa-agent" olarak geldi. **Bu sıralama eksik.** Analiz sonucu,
özelliğin çalışabilmesi için **backend ve devops tarafında ZORUNLU değişiklikler** olduğu tespit
edildi; bunlar yapılmadan frontend tarafı yazılsa bile hekim subdomain'inde **oturum açılamaz**.

| Bulgu | Etki | Sahip |
|---|---|---|
| Backend CORS `origin: env.FRONTEND_URL` **tek bir string** (`plugins/security.ts:21`) | `doktor.*` origin'inden gelen HER istek (login dahil) tarayıcıda bloklanır | **backend-agent** |
| Refresh cookie `sameSite: "strict"` (`backend/src/lib/cookies.ts:11`) | `doktor.localhost` ↔ `localhost` **cross-site**'tır; cookie taşınmaz → sayfa yenilemesinde oturum ölür (§6'da deneyle kanıtlandı) | **devops-agent** (host şeması) |
| Yerel dev host şeması (`localhost:3000` / `localhost:4000`) | Yukarıdakinin kök nedeni; `doktor.localhost` kullanılabilir DEĞİL | **devops-agent** |
| Kullanıcının verdiği yol `apps/web/middleware.ts` | Bu repoda **yok**; Next 16'da `middleware.ts` kaldırıldı, dosya `frontend/src/proxy.ts` | — |

**Bağlayıcı yürütme sırası:**

```
architect (bu doküman)
   └─> devops-agent      (dev/prod host şeması + env + allowedDevOrigins)   ─┐ paralel
   └─> backend-agent     (CORS allow-list + DOCTOR_FRONTEND_URL env)        ─┘
        └─> frontend-agent (proxy.ts + route grubu + minimal bar)
             └─> qa-agent  (Playwright)
                  └─> security-agent (host-header/open-redirect denetimi) + documentation-agent
```

`openapi.yaml` **DEĞİŞMEZ** — bu görev yeni endpoint/şema getirmiyor, mevcut uçları (`/doctor/me`,
`/doctor/portal-feed`, `/auth/*`) aynen tüketiyor. Sözleşme güncellemesi gerekmez.

---

## 1. Kullanıcı talebindeki yanlış varsayımların düzeltilmesi

| Talep | Repodaki gerçek | Karar |
|---|---|---|
| `apps/web/middleware.ts` | Monorepo değil; `frontend/src/proxy.ts` (Next 16.2.12, `middleware` → `proxy` yeniden adlandırması) | `proxy.ts` genişletilir; **ikinci bir proxy dosyası AÇILMAZ** (Next tek dosyaya izin verir) |
| "`/login`'i `/doctor/login`'e bağla" | `/login`, `proxy.ts` matcher'ı tarafından **hariç tutuluyor** — proxy o rotayı hiç görmüyor | Matcher daraltılır (§3.2), `/login` doktor host'unda rewrite edilir |
| "Header/Footer'ı kaldır" | `(site)/layout.tsx` header/footer'ı **koşulsuz** render ediyor | Koşullu render DEĞİL, **ayrı route grubu** (§5) — gerekçe: `headers()` ISR'ı öldürür |
| "`doktor.localhost:3000`" | Tarayıcı çözüyor, **ama** `localhost:4000` API'siyle cross-site → oturum çalışmaz (§6 deney) | Dev host şeması `*.siteadi.localhost`'a taşınır |

---

## 2. Next.js 16 `proxy.ts` API'si — doğrulanmış gerçekler

Kaynak: `frontend/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
ve `.../04-functions/next-request.md` (okundu, varsayım yok).

1. Dosya **tek** bir fonksiyon export eder (`proxy` veya default). Birden fazla proxy desteklenmez.
2. `matcher` değerleri **build-time'da statik analiz edilebilir sabitler** olmak zorundadır.
   Değişken/env kullanılamaz → **host bazlı ayrım matcher'da YAPILAMAZ, kod içinde yapılır.**
   (`has: [{type:"header", key:"host", value:"..."}]` teorik olarak var ama değeri sabit
   kodlamayı zorunlu kılar → env ile yapılandırılabilirlik kaybolur, **REDDEDİLDİ**.)
3. **App Router'da `request.nextUrl` yalnızca `basePath`, `buildId`, `pathname`, `searchParams`
   sunar** — host/hostname **dokümante edilmiş bir alan DEĞİLDİR**.
   → **Bağlayıcı:** host `request.headers.get("host")` ile okunur.
4. `NextResponse.rewrite(url)` RSC rewrite header'larını otomatik taşır; `NextResponse.next({request:{headers}})`
   istek header'ını yukarı akıtır (mevcut `x-active-locale` deseni doğru).
5. Proxy **Node.js runtime**'ında çalışır (v16 varsayılanı); `runtime` config'i hata fırlatır.
6. Proxy "her rota için" çalışır; negative-lookahead matcher zorunludur.
7. Cross-origin **redirect** proxy'den dönebilir (`NextResponse.redirect(absoluteUrl, 307)`).

---

## 3. KARAR: `proxy.ts` mantığının tam sırası

### 3.1 Bağlayıcı yürütme sırası

Mevcut dosyadaki "**TEK proxy dosyası, İKİ sorumluluk**" notu artık "**TEK proxy dosyası, ÜÇ
sorumluluk**" olur. Sıra **bağlayıcıdır**:

```
proxy(request):

  [0] host  = (request.headers.get("host") ?? "").split(":")[0].toLowerCase()
      isDoctorHost = DOCTOR_HOST != null && host === DOCTOR_HOST
      (DOCTOR_HOST === SITE_HOST ise subdomain modu KAPALI sayılır — §3.4 döngü koruması)

  [1] SaaS AUTH YÜZEYİ ERKEN ÇIKIŞI  (ana host)
      pathname ∈ /login /register /forgot-password /reset-password  VE  !isDoctorHost
        -> NextResponse.next()           // BUGÜNKÜ davranışın birebir korunması
      * Bu kontrol `fetch` çağrılarından ÖNCEDİR: bugün bu yollar matcher'dan hariç olduğu
        için bakım modu 503'ü de locale rewrite'ı da GÖRMÜYORLAR — bu korunmalıdır.

  [2] locales = await fetchEnabledLocales()        // her iki host için de gerekli
      defaultLocale = locales.find(isDefault)

  === ANA HOST (isDoctorHost === false) ===

  [3] BAKIM MODU (503)                              // MEVCUT KOD, DEĞİŞMEZ
        -> maintenanceEnabled ise 503 + Retry-After, burada biter.

  [4] DOKTOR ROTASI DEVRİ (yalnızca DOCTOR_ORIGIN yapılandırılmışsa)
        pathname ~ ^/(?:[a-z]{2}/)?doctor(?:/|$)
          -> 307 redirect  DOCTOR_ORIGIN + <locale prefix'i SOYULMUŞ pathname> + search
        * 307 (geçici), 308/301 DEĞİL — gerekçe §3.4.

  [5] LOCALE REDIRECT/REWRITE                       // MEVCUT KOD, DEĞİŞMEZ
        /tr/... -> 301 /...   |   /en/... -> next()+x-active-locale   |   /... -> rewrite /tr/...

  === DOKTOR HOST (isDoctorHost === true) ===

  [6] BAKIM MODU **UYGULANMAZ** — `/appearance` fetch'i HİÇ YAPILMAZ (§3.3).

  [7] AUTH YÜZEYİ
        /login                          -> rewrite  /{defaultLocale}/doctor/login
        /forgot-password, /reset-password -> NextResponse.next()   (jenerik ekran; zaten
                                             `(auth)` grubunda, SiteHeader/Footer YOK)
        /register                       -> 307 redirect SITE_ORIGIN + pathname + search

  [8] PORTAL ROTALARI (tek dilli — §3.5)
        "/"                             -> rewrite  /{defaultLocale}/doctor
        ^/doctor(?:/|$)                 -> rewrite  /{defaultLocale}<pathname>
        ^/[a-z]{2}/doctor(?:/|$)        -> 307 redirect  <aynı host> + prefix'siz hâli
                                           (doktor host'unda locale prefix'i YOKTUR)

  [9] DİĞER HER ŞEY (hasta/e-ticaret/kurumsal sayfalar)
        -> 307 redirect  SITE_ORIGIN + pathname + search

  [10] DOKTOR HOST'UNDAN DÖNEN HER YANITA (rewrite/next/redirect fark etmez):
        response.headers.set("X-Robots-Tag", "noindex, nofollow")
        response.headers.set("x-doctor-portal", "1")     // qa/observability sinyali
```

### 3.2 KARAR: matcher değişikliği

**Mevcut:**
```
/((?!admin|api|login|register|forgot-password|reset-password|invitations|pricing|dashboard|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\..*).*)
```
**Yeni:**
```
/((?!admin|api|invitations|pricing|dashboard|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\..*).*)
```

Yani **yalnızca `login|register|forgot-password|reset-password` hariç listeden ÇIKARILIR.**

- **Neden çıkarılmak zorunda:** kullanıcının 1. maddesi (`/login` → hekim ekranı) proxy'nin bu
  rotayı GÖRMESİNİ gerektiriyor. Matcher sabit olmak zorunda olduğu için (§2.2) host'a göre
  değişen bir matcher yazılamaz; ayrım kod içindedir.
- **Neden davranış bozulmuyor:** §3.1 [1] adımı, ana host'ta bu dört yolu **ilk satırda**
  `next()` ile geçirir — bakım modu fetch'i, locale fetch'i, rewrite: hiçbiri çalışmaz.
  Bugünkü sonuçla **birebir aynı**, sadece bir `if` maliyeti eklenir.
- **`admin`, `api`, `dashboard`, `invitations`, `pricing` hariç listede KALIR.** `proxy.ts`'in
  mevcut bağlayıcı kuralı korunur: *"`/admin` KESİNLİKLE etkilenmez — yönetici kendini asla
  kilitleyemez."* Bu kural bu görevde **gevşetilmez**.
- **Kabul edilen sınır (bilinçli):** doktor host'unda `/admin` ve `/dashboard` erişilebilir kalır
  (proxy onları görmez). Bu bir güvenlik açığı DEĞİLDİR (yetkilendirme API tarafındadır, host
  bazlı değildir); yalnızca kozmetik bir sızıntıdır. **Doğru katman uygulama değil, reverse
  proxy/CDN'dir** — devops-agent'a takip kalemi (§7.4): doktor host'u için nginx/ALB seviyesinde
  yalnızca `/`, `/login`, `/doctor/*`, `/_next/*`, `/api/*` yollarının uygulamaya geçirilmesi.

### 3.3 KARAR: bakım modu doktor host'unda UYGULANMAZ

`proxy.ts`'in kendi dokümantasyonu bakım modunu şöyle tanımlıyor: *"SUNUM anahtarıdır, bir GÜVENLİK
kontrolü DEĞİLDİR... Yalnızca ziyaretçi (`(site)`) sayfalarını etkiler."*

Hekim portalı bir **ziyaretçi/vitrin yüzeyi değil, klinik operasyon aracıdır**. Mağaza bakımdayken
hekimin randevu konsoluna, hastasının belgelerine ve devam eden görüşmesine erişememesi **operasyonel
bir zarardır** ve bakım modunun tanımlı amacının dışındadır. Ayrıca `/admin` de bakım modundan
etkilenmiyor (matcher'dan hariç) — hekim portalını admin paneliyle aynı sınıfta değerlendirmek
tutarlıdır.

**Yan fayda:** doktor host'unda `GET /appearance` isteği tamamen atlanır (her istekte bir round-trip
daha az).

**Değerlendirilen alternatif — REDDEDİLDİ:** "doktor host'unda da 503 dön, ama bypass cookie'si
ver." Bakım modu güvenlik kontrolü olmadığı için bypass token'ı gerçek bir koruma sağlamaz, buna
karşılık yeni bir cookie/sır yönetimi yüzeyi açar. Maliyet > fayda.

### 3.4 KARAR: ana domain `/doctor/**` → doktor host'una **307** yönlendirme

**Karar:** `DOCTOR_ORIGIN` yapılandırılmışsa ana domain'deki `/doctor/**` (ve `/{lang}/doctor/**`)
istekleri doktor host'una **307 (Temporary Redirect)** ile devredilir. Yapılandırılmamışsa
**hiçbir yönlendirme yapılmaz ve bugünkü davranış AYNEN korunur** (geriye dönük uyumluluk).

| Neden 307, 308/301 değil | |
|---|---|
| Kalıcılık | 301/308 tarayıcıda **süresiz** önbelleklenir. Doktor host'u bir **dağıtım yapılandırmasıdır** (self-hosted kurulumlarda wildcard DNS/sertifika olmayabilir); kapatıldığında kalıcı yönlendirme kullanıcıların tarayıcısında hapsolur ve geri alınamaz. |
| Metot/gövde | 307 metodu ve gövdeyi korur — RSC/POST navigasyonlarında güvenlidir. |

**Geriye dönük uyumluluk (bağlayıcı):** `NEXT_PUBLIC_DOCTOR_URL` tanımsızsa özelliğin **tamamı**
(proxy dalı, yönlendirme, host kontrolü) devre dışıdır. Bu, tek-domain'de çalışan mevcut
kurulumların hiçbir şekilde etkilenmemesini garanti eder.

**Yapılandırma hatası koruması:** `DOCTOR_HOST === SITE_HOST` ise subdomain modu **kapalı** kabul
edilir (aksi hâlde `/doctor` sonsuz yönlendirme döngüsüne girer).

**Döngü analizi (doğrulandı):** Ana host `/doctor/**` → doktor host. Doktor host `/` ve `/doctor/**`
**rewrite** edilir (redirect DEĞİL) → geri dönüş yok. Doktor host'undaki diğer yollar → ana host'a
gider, orada `/doctor` olmadıkları için tekrar dönmezler. **Döngü yok.**

### 3.5 KARAR: doktor host'u **tek dillidir** (locale prefix'i YOK)

- Doktor host'undaki her istek `/{defaultLocale}/...` hedefine **rewrite** edilir; ziyaretçinin
  gördüğü URL **her zaman prefix'sizdir**.
- `/{lang}/doctor/...` biçiminde gelen bir istek → aynı host'ta prefix'siz hâline **307**.

**Gerekçe:** portal metinlerinin tamamı bugün koda gömülü Türkçe'dir (`Randevularım`, `Kazançlarım`,
`Profilim`, tüm panel metinleri). `/en/doctor` açmak, **çevrilmemiş** içerik için ikinci bir URL
uzayı üretir — `.claude/architect-scope-i18n.md` §6'nın "çevrilmemiş dil alternate ALMAZ" kuralının
ruhuna aykırıdır, bakım maliyeti getirir, karşılığında sıfır fayda sağlar. Portal zaten `noindex`
olduğu için SEO açısından da anlamsızdır.

Bu **portalın ileride çevrilemeyeceği anlamına gelmez**: gerekirse hekim arayüz dili, admin
panelindeki gibi (`.claude/architect-scope-i18n.md` §7.4 "panel arayüz dili") URL'de değil
kullanıcı tercihinde taşınır. Bu görevin kapsamı DIŞINDADIR.

### 3.6 KARAR: yönlendirme hedefleri **ASLA `Host` header'ından türetilmez**

Bağlayıcı güvenlik kuralı: `SITE_ORIGIN` ve `DOCTOR_ORIGIN` **yalnızca** `NEXT_PUBLIC_SITE_URL` /
`NEXT_PUBLIC_DOCTOR_URL` env değerlerinden okunur. `` `doktor.${host}` `` gibi gelen `Host`
header'ından hedef **üretilmez**.

Gerekçe: `Host` header'ı istemci kontrolündedir. Ondan türetilen bir mutlak yönlendirme, host-header
injection ile **açık yönlendirme (open redirect)** ve önbellek zehirlenmesi yüzeyi açar.
security-agent bu maddeyi denetler.

---

## 4. KARAR: `/login` → **gerçek bir `/doctor/login` rotası** (rewrite ile bağlanır)

**Karar:** `app/[lang]/(doctor)/doctor/login/page.tsx` **yeni bir rota olarak açılır**. Doktor
host'unda `/login` bu rotaya **rewrite** edilir (URL `/login` olarak kalır; `/doctor/login`
doğrudan da çalışır).

**Neden mevcut `/login`'i "doktor temalı" render etmek YETMEZ:**
1. Minimal üst bar bir **layout** işidir. `app/(auth)/login` farklı bir route grubundadır; aynı
   rotayı iki farklı layout altında render etmek Next App Router'da **mümkün değildir**.
2. Doktor girişinin `(doctor)` grubunun `.site-scope` token'larını (`--site-primary` vb.) ve
   kurum logosunu miras alması gerekir — `(auth)` grubu bunların dışındadır.
3. Ana host'ta da hekime verilebilecek **kanonik bir giriş URL'si** doğar.

**Kod tekrarı YASAK — bağlayıcı yeniden kullanım planı:**
- `app/(auth)/login/page.tsx` içindeki `LoginForm` bileşeni (satır 23-178: 2FA challenge akışı,
  `goToDestination`, `friendlyErrorMessage`) **olduğu gibi** `components/auth/login-form.tsx`'e
  taşınır ve **her iki sayfa da onu import eder**. Kopyalanmaz.
- `lib/post-login-destination.ts::resolvePostLoginPath` **değişmez ve saf kalır** (bir *path*
  döner, origin DEĞİL). Host kararı yeni `lib/doctor-host.ts` yardımcısındadır (§5.4).
- Doktor giriş sayfası yalnızca `AuthPageShell` başlık/alt başlık/footer proplarını farklı verir
  ("Hekim Girişi" / "Kayıt olun" bağlantısı **YOK** — hekimler kendi kendine kayıt olmaz).
- Doktor giriş ekranında, giriş yapan hesabın `user.doctorProfileId === null` olması hâlinde
  sessizce portala düşürülmez: açık bir hata mesajı gösterilir ve ana siteye bağlantı sunulur.

`DoctorPortalShell`'in mevcut `router.replace('/login?next=...')` çağrısı **DEĞİŞMEZ** — doktor
host'unda proxy onu zaten hekim ekranına rewrite eder.

---

## 5. KARAR: Header/Footer izolasyonu — **koşullu render DEĞİL, ayrı route grubu**

### 5.1 Reddedilen iki alternatif

| Alternatif | Neden reddedildi |
|---|---|
| `(site)/layout.tsx` içinde `headers()` ile host okuyup header'ı koşullu render etmek | **`headers()` çağrısı layout'u dinamik yapar ve ALTINDAKİ TÜM public sayfaların statik/ISR render'ını iptal eder.** Bu site ürün/blog/portföy sayfalarında `revalidate: 60` ISR'a dayanıyor (bkz. proje hafıza notu). Görsel bir izolasyon için tüm vitrinin önbelleğini feda etmek kabul edilemez bir bedeldir. |
| proxy'nin cookie/header set etmesi + layout'un onu okuması | Aynı sorun: değeri okumak yine `headers()`/`cookies()` demektir → aynı dinamikleşme. Ayrıca cookie, host'tan bağımsız olarak tarayıcıda kalıcı olur ve yanlış host'ta yanlış chrome render edilebilir. |

### 5.2 Karar: `/doctor/**` `(site)` grubundan `(doctor)` grubuna TAŞINIR

Route grupları URL'i **değiştirmez** — `/doctor` URL'i aynı kalır, yalnızca layout'u değişir.

```
app/[lang]/(site)/doctor/**            →  SİLİNİR (taşınır)
app/[lang]/(doctor)/layout.tsx         →  YENİ: .site-scope + LocaleAlternatesProvider + minimal bar
app/[lang]/(doctor)/doctor/layout.tsx  →  TAŞINDI (telehealth modülü 404 kontrolü, içeriği DEĞİŞMEZ)
app/[lang]/(doctor)/doctor/login/page.tsx        →  YENİ (§4)
app/[lang]/(doctor)/doctor/page.tsx              →  TAŞINDI
app/[lang]/(doctor)/doctor/earnings/page.tsx     →  TAŞINDI
app/[lang]/(doctor)/doctor/profile/page.tsx      →  TAŞINDI
```

**Sonuç:** izolasyon **yapısaldır**, koşulludur değil. `SiteHeader`/`SiteFooter` doktor rotalarının
React ağacına **hiç girmez** — ileride bir geliştirici yanlışlıkla geri getiremez. Bu, `proxy.ts` ve
`doctor-portal-shell.tsx` yorumlarındaki **"çift-header" hatasının kalıcı çözümüdür**.

**Bilinçli yan etki (kabul edildi):** subdomain yapılandırılmamış kurulumlarda **ana domain'deki**
`/doctor` de artık `SiteHeader` yerine minimal barı görür. Bu bir gerileme değildir — minimal bar
aynı yetenekleri (marka, hekim kimliği, bildirimler, çıkış) daha odaklı sunar ve portalın chrome'u
host'tan bağımsız olarak **tek** ve tutarlı hâle gelir.

### 5.3 `(doctor)/layout.tsx` sözleşmesi (bağlayıcı)

**SAĞLAMAK ZORUNDA:**
- `locales` + bilinmeyen `[lang]` → `notFound()` (`(site)/layout.tsx:36-40` ile **aynı** kural).
- `.site-scope` sarmalayıcısı + `--site-*` token'ları. **Bu blok kopyalanmaz:** `(site)/layout.tsx`
  satır 51-76'daki `siteScopeStyle` üretimi + sarmalayıcı `<div>`, yeni bir paylaşılan server
  bileşenine (`components/site/site-scope.tsx`) **çıkarılır** ve her iki layout onu kullanır.
  Token sözleşmesinin tek tanımı olmalıdır (drift yasağı).
- `LocaleAlternatesProvider` (`useLocalizePath()` `DoctorPortalShell` ve top bar tarafından
  kullanılıyor; Provider olmadan çalışmaz).
- Minimal üst bar (§5.4).

**SAĞLAMAMALI (bilinçli):** `SiteHeader`, `SiteFooter`, `CartProvider`, `WishlistProvider`,
`CartDrawer`, `CookieConsentBanner`, `BackToTopButton`, `LanguageSwitcher`.

**`customCss` / `customJs` (§10.12.6):** doktor host'unda **enjekte EDİLMEZ**. Gerekçe: site
sahibinin vitrin için yazdığı CSS/JS, klinik veri gösteren bir operasyon aracını bozabilir; bu bir
pazarlama yüzeyi özelliğidir. `(site)` grubundaki mevcut davranış aynen kalır.

**`DoctorPortalRouteGuard`:** `(site)/layout.tsx`'te **kalır**, `(doctor)` layout'una eklenmez
(orada mantığı ters yönde çalışır ve döngü üretir).

### 5.4 Minimal üst bar — bileşen planı

**Yeni:** `components/site/telehealth/doctor-top-bar.tsx` (`"use client"`).

İçerik (kullanıcının 2. maddesi): **Kurum Logosu · Hekim Adı/Unvanı · Bildirimler · Çıkış Yap**.

| Parça | Veri kaynağı | Yeniden kullanım kuralı |
|---|---|---|
| Kurum logosu / site adı | `(doctor)/layout.tsx`'in `fetchSiteSettingsServer()` çıktısı, **prop olarak** | `SiteHeader`'ın logo yükseklik mantığı (`lib/site-settings/logo.ts`) tekrar yazılmaz, import edilir |
| Hekim adı + unvanı | `DoctorPortalProfile.doctorProfile.{title, fullName}` | `doctor-portal-shell.tsx:155-157` ile **aynı** alanlar; ikinci bir kaynak icat edilmez |
| Bildirimler | **Mevcut** `GET /doctor/portal-feed` → `DoctorPortalFeed.notifications` | **Yeni endpoint YOK, notification-agent'a iş YOK** |
| Çıkış Yap | `useAuth().logout()` | `site-header.tsx:388` ile **aynı** çağrı; yeni bir logout akışı yazılmaz |

**Bağlayıcı invariant'lar:**

1. **Tek profil fetch'i.** Bugün `DoctorPortalShell` `getDoctorPortalProfile()`'ı kendi içinde
   çekiyor; top bar layout'ta, shell'in ÜSTÜNDE olduğu için bu context'e erişemez.
   → `DoctorPortalProfileContext` + fetch/guard/hata durumları (`NOT_A_DOCTOR`,
   `TWO_FACTOR_REQUIRED`, spinner) **layout seviyesine taşınır** (ör.
   `components/site/telehealth/doctor-portal-provider.tsx`). `DoctorPortalShell` yalnızca içerik
   konteyneri + sekme şeridi olarak kalır ve `useDoctorPortalProfile()` ile **tüketir**.
   `GET /doctor/me` sayfa yüklemesi başına **bir kez** çağrılır.
2. **Context modülü ayrılır.** `useDoctorPortalProfile` bugün `doctor-portal-shell.tsx`'ten export
   ediliyor ve `doctor-portal-feed-card.tsx` oradan import ediyor. Context kendi modülüne
   (`doctor-portal-context.tsx`) alınır; import döngüsü oluşmaz.
3. **Giriş rotası guard'lanmaz.** `/doctor/login` `(doctor)` grubundadır; provider bu rotada
   auth-guard ve `GET /doctor/me` fetch'ini **yapmaz** (`usePathname()` kontrolü). Aksi hâlde
   giriş sayfası kendi kendini `/login`'e yönlendirir → döngü.
4. **İkinci `GET /doctor/portal-feed` YASAK.** Zil, layout seviyesindeki paylaşılan bir feed
   provider'ından beslenir; mevcut `DoctorPortalFeedCard` **aynı** provider'ı tüketecek şekilde
   refactor edilir. **Tüm `data-testid` değerleri korunur** (qa-agent'ın
   `doctor-console-dashboard-layout.spec.ts` testi bunlara bağlı).
   *İzin verilen geri çekilme:* refactor riskli görülürse zil, sayımsız bir bağlantı olarak
   `/doctor#doctor-portal-feed-card`'a gider — **ama ikinci bir istek yine atılmaz.**
5. **Görsel dil ui-designer'ındır.** Bu doküman yalnızca *hangi bilgi* ve *hangi veri kaynağı*
   olduğunu bağlar; renk/spacing/tipografi kararları `.claude/design-notes-telehealth.md`
   token'larına uyar. Yeni bir renk/gölge değeri **uydurulmaz** (`--site-*` kullanılır).

`doctor-portal-shell.tsx`'teki "Katman 1 artık YALNIZCA SiteHeader'da yaşar" yorumu **güncellenmek
zorundadır** — o karar bu görevle yürürlükten kalkmıştır; Katman 1 artık `DoctorTopBar`'dadır ve
`SiteHeader` doktor ağacında hiç yoktur.

### 5.5 `lib/doctor-host.ts` (yeni, istemci+sunucu ortak)

Saf, birim-testlenebilir yardımcı:
```
DOCTOR_ORIGIN: string | null        // NEXT_PUBLIC_DOCTOR_URL'den; SITE_URL'e eşitse null
isSubdomainModeEnabled(): boolean
isDoctorHostname(host: string): boolean
toDoctorOrigin(path: string): string
```
**Kullanıcıları:**
- `proxy.ts` (host tespiti + yönlendirme hedefi üretimi)
- `DoctorPortalRouteGuard` — §5.6
- `LoginForm::goToDestination` — §5.6

### 5.6 KARAR: `DoctorPortalRouteGuard` KALIR, görevi daralır

Guard **silinmez, devre dışı bırakılmaz.** İki katman birbirini tamamlar:

| Katman | Neye bakar | Neyi bilmez |
|---|---|---|
| `proxy.ts` (host) | Hangi **host**tan gelindiğine | Oturum/erişim token'ı (bellek-içi) — guard yorumunda zaten yazılı |
| `DoctorPortalRouteGuard` (auth) | Oturumun **doktor hesabı** olup olmadığına | Host |

Subdomain modu kapalıyken guard bugünkü görevini aynen sürdürür (tek domain'de izolasyon **yalnızca**
ona bağlıdır). Açıkken, ana domain'de gezinen bir hekim hesabını `/doctor`'a iter; proxy de onu
doktor host'una devreder → net sonuç: hekim ana vitrinde kalamaz.

**ZORUNLU değişiklik (bağlayıcı):** subdomain modu AÇIKKEN guard `router.replace()` yerine
**tam sayfa gezinme** yapar (`window.location.assign(toDoctorOrigin("/doctor"))`).
Gerekçe: `router.replace` bir RSC navigasyonu başlatır; proxy'nin döndüğü **cross-origin 307**'yi
Next istemci router'ının izlemesi garanti değildir. Aynı kural `LoginForm::goToDestination` için de
geçerlidir: `resolvePostLoginPath()` bir doktor portalı path'i döndürdüyse ve **ana host**taysak,
hedef `toDoctorOrigin(path)` ile tam sayfa açılır.

**Not (qa-agent için kritik):** origin değiştiği için bellek-içi access token kaybolur; yeni
origin'de oturum **yalnızca refresh cookie ile** kurulur. §6 bu yüzden bu işin en kritik parçasıdır.

#### 5.6.1 KARAR (2026-09-15, architect — "doktor konsültasyon odasına ulaşamıyor" blocker'ı)

**Bulgu (qa-agent, `telehealth-doctor-console-join-window.spec.ts` madde 1b):** doktor
konsolundaki "Odaya Katıl" linki `SITE_ORIGIN` ile mutlak hâle getirildikten SONRA bile doktor
konsültasyon odasına **ulaşamıyordu** — tarayıcı ana host'ta `/consultation/{id}`'e varıyor,
refresh çerezi (§6) sayesinde oturum orada da doktor oturumu olarak kuruluyor,
`DoctorPortalRouteGuard` rotayı "portal dışı" sayıp `window.location.assign(toDoctorOrigin("/doctor"))`
ile doktoru **derhal geri gönderiyordu**. Yani §5.6'nın kuralı, doktorun kendi klinik iş yüzeyini
de kapatıyordu.

**KARAR — guard'a DAR kapsamlı, PAYLAŞILMAYAN bir istisna eklenir:**
`doctor-portal-route-guard.tsx`'e, `proxy.ts::DOCTOR_PORTAL_ROUTE_PATTERN`'dan **bağımsız**,
YALNIZCA bu istemci bileşeninde yaşayan ikinci bir desen eklendi:

```
isDoctorSharedRouteException(pathname) → /^\/(?:[a-z]{2}\/)?consultation\/[^/]+/
guard: if (isDoctorPortalRoute(p) || isDoctorSharedRouteException(p)) return;
```

`proxy.ts` **DEĞİŞMEDİ** (yalnızca desenin neden paylaşılmadığını anlatan bir yorum eklendi).

**Gerekçe — iki katman, İKİ FARKLI soru (§5.6 tablosunun doğal sonucu):** `proxy.ts`'in deseni
"bu istek hangi **host**ta servis edilir?" sorusunu **oturumdan bağımsız** yanıtlar;
`/consultation/**` ana host'ta servis edilir, çünkü aynı sayfaya **hasta da** magic-link (`?t=`)
ile erişir. Guard'ın deseni ise "doktor **oturumu** bu sayfada **kalabilir mi**?" sorusunu
**host'tan bağımsız** yanıtlar. İki soru bugüne dek tesadüfen aynı cevabı veriyordu;
`/consultation/{id}` ikisinin **ayrıştığı ilk rota**dır: hasta+doktor tarafından **paylaşılan TEK**
sayfa ve bir vitrin sayfası değil, doktorun **kendi randevusunun çalışma yüzeyi**.

**REDDEDİLEN alternatifler:**
1. *Ortak deseni genişletmek* (`DOCTOR_PORTAL_ROUTE_PATTERN`'a `/consultation` eklemek) —
   **REDDEDİLDİ:** proxy §3.1 [4] ana host'a gelen **HER** `/consultation/...` isteğini (hasta
   dâhil) doktor subdomain'ine 307'lerdi; hasta orada authenticated **değildir** (login döngüsü/404).
   İşlevsel **ve** güvenlik açısından yanlış.
2. *`/consultation` sayfasını doktor host'unda render etmek / `(doctor)` grubuna taşımak* —
   **REDDEDİLDİ:** §5.6'nın "`(site)` sayfaları YALNIZCA ana host'ta render edilir" ilkesini bozar,
   aynı sayfanın iki kitle için ikizlenmesini gerektirir.
3. *Sayfa seviyesinde guard'ı atlatan bir mekanizma* (opt-out context/flag) — **REDDEDİLDİ:**
   guard `(site)/layout.tsx`'te, sayfanın **ÜSTÜNDE** mount edilir; bir alt sayfanın üstündeki
   effect'i iptal etmesi yeni bir cross-cutting sinyal katmanı (context) icat etmeyi gerektirir.
   İzin listesi **tek yerde, denetlenebilir** kalmalıdır — istisna guard'ın kendisinde yazılıdır.

**BAĞLAYICI kapsam kuralı:** bu istisna listesi **yalnızca `/consultation/{id}`** içerir. Yeni bir
rota eklemek bir **mimari karardır** — buraya tarihli bir not düşülmeden genişletilmez. Kolaylık
gerekçesiyle (`/products`, `/cart`, `/hesabim` vb.) büyütülmesi §5.6'nın "hekim ana vitrinde
kalamaz" kuralını fiilen boşaltır.

**Yetkilendirme sınırı (security-agent için):** bu bir **yetkilendirme** gevşetmesi DEĞİLDİR —
guard bir gezinme/UX izolasyon katmanıdır. Doktorun ilgili randevuya erişip erişemeyeceğine API
karar verir (`POST /appointments/{id}/meeting-token`, doktor yalnızca **kendi** randevusu için
token alır). Kabul edilen kozmetik sınır: doktor bu sayfada `(site)` layout'unu (SiteHeader/Footer)
görür — §3.2'deki `/admin` sızıntısıyla aynı sınıfta, bilinçli.

**Tamamlayıcı (aynı tur):** `join-meeting-button.tsx` `mergeRemainingTime` (doktor konsolu) modunda
href'i `SITE_ORIGIN` ile **mutlak** üretir — böylece doktor host'unda gereksiz bir proxy §3.1 [9]
307 hop'u oluşmaz ve navigasyon doğrudan ana origin'e gider. İki değişiklik birbirini tamamlar:
mutlak href doktoru **ana host'a götürür**, bu istisna orada **kalmasına izin verir**.

#### 5.6.2 KARAR (2026-09-15, architect — "2FA'sız doktor kalıcı olarak kilitleniyor" blocker'ı)

**Bulgu (kod okumasıyla doğrulandı):** 2FA'sı **etkin olmayan** bir doktor `/doctor`a girdiğinde
`GET /doctor/me` `403 TWO_FACTOR_REQUIRED` döner; `doctor-portal-shell.tsx` (satır 69-86) bir uyarı
ekranı + `/hesabim/profil`e giden "Güvenlik Ayarlarına Git" butonu gösterir. Ancak
`DoctorPortalRouteGuard`ın `isDoctorSession` koşulu (`auth.user.doctorProfileId != null`) **2FA
durumundan bağımsızdır** — 2FA'sı olmayan doktor da "doktor oturumu" sayılır ve `/hesabim/profil`
istisna listesinde **olmadığı için** anında `/doctor`a geri fırlatılır. **Deadlock:** doktor 2FA'yı
**hiçbir zaman** kuramaz, portala **hiçbir zaman** giremez.

**REDDEDİLDİ — `isDoctorSharedRouteException`a `/hesabim/profil` eklemek.** §5.6.1'in bağlayıcı
kapsam kuralı gereği bu reddin tarihli kaydı burada tutulur. Üç gerekçe:
1. **Kapsam orantısız.** `/hesabim/profil` 2FA'dan **çok daha fazlasıdır** (şifre değiştirme, aktif
   oturum yönetimi, avatar/ad, hesap formu). Doktoru bir 2FA kurulumu uğruna bu sayfanın
   **tamamına** açmak, "hekim ana vitrinde kalamaz" kuralını geniş ölçüde deler; §5.6.1'in
   açıkça yasakladığı *kolaylık gerekçesiyle liste büyütme* örüntüsüdür.
2. **Subdomain modunda zaten çalışmaz.** `/hesabim/profil` bir `(site)` sayfasıdır ve YALNIZCA ana
   host'ta render edilir (§5.6); doktor ise doktor subdomain'indedir. İstisna eklense bile akış
   cross-origin bir tam sayfa gezinmeye dönüşür, bellek-içi access token kaybolur ve oturum ana
   host'ta yalnızca refresh cookie ile yeniden kurulur (§6) — bir **blocker** düzeltmesi için
   kabul edilemez kırılganlık. §5.6.1'deki `/consultation/{id}` istisnası bu bedeli **klinik iş
   yüzeyi** olduğu için ödemişti; bir ayar sayfası aynı gerekçeye sahip **değildir**.
3. **Guard bir güvenlik-hassas dar yüzeydir.** Her yeni istisna denetlenmesi gereken yüzeyi büyütür;
   burada istisnaya **hiç gerek yoktur** (bkz. aşağıdaki karar).

**KARAR — 2FA kurulumu `/doctor`un İÇİNE gömülür; guard'a DOKUNULMAZ.**
`doctor-portal-shell.tsx`'in `TWO_FACTOR_REQUIRED` dalı, "başka sayfaya git" linki yerine
**satır içi** bir 2FA kurulum paneli render eder (QR + `otpauthUrl` + 6 haneli TOTP girişi + yedek
kodlar). Mevcut `securityApi.setupTwoFactor()` / `enableTwoFactor()` **aynen** kullanılır —
**yeni backend ucu YOK, backend'de hiçbir değişiklik YOK** (uçlar `authenticate` dışında şart
aramaz, §9.7.7 KARAR K madde 2 ile birebir tutarlı; `app.ts:226` + `security.routes.ts` başlığı
yeniden doğrulandı). Sonuç: **doktor `/doctor`dan hiç ayrılmaz**, `isDoctorSharedRouteException`
**`/consultation/{id}` ile sınırlı kalır**, `proxy.ts` değişmez.

**Çıkış koşulu (implementasyon için BAĞLAYICI — `refreshSession()` TEK BAŞINA YETMEZ):**
`DoctorPortalShell`in dalı `useAuth().user.twoFactorEnabled`e değil,
`useDoctorPortalContext().error?.code`a bakar; bu hata `DoctorPortalProvider`ın `GET /doctor/me`
fetch'inden gelir ve `refreshSession()` o fetch'i **yeniden tetiklemez**. Doğru sıra:
`enableTwoFactor()` → yedek kodları **kullanıcıya göster** → `refreshSession()` →
`useDoctorPortalContext().retry()` (provider'ın `retryToken`'ını artırır, `/doctor/me` yeniden
çekilir) → dal doğal olarak kapanır. **Yedek kodlar gösterilmeden otomatik geçiş YAPILMAZ** —
kodlar bir daha gösterilemez (`/enable` her etkinleştirmede seti sıfırlar); geçiş, kullanıcının
açık bir "Portala Gir" eylemiyle olur.

**Kod tekrarı kararı (dar tutulur):** 2FA kurulum mantığı bugün `app/admin/settings/security/page.tsx`
ve `app/[lang]/(site)/hesabim/profil/page.tsx`'te **zaten ikizdir** ("BİREBİR aynı mantık" notu,
`profil/page.tsx:143`). Üçüncü bir kopya **kabul edilmez**; bu turda yalnızca **enable yolu**
(`setup → QR → kod → enable → yedek kodlar`) `frontend/src/components/site/security/two-factor-setup-panel.tsx`
adlı `.site-scope` uyumlu paylaşılan bir bileşene çıkarılır ve `doctor-portal-shell.tsx` onu tüketir.
`disable` / `regenerate` / oturum yönetimi bu bileşene **girmez**. `hesabim/profil`in bu bileşene
taşınması **bu turun kapsamı DIŞINDADIR** (dialog tabanlı akışı ve komşu disable/regenerate
dialoglarıyla bağı var; çalışan bir sayfayı blocker düzeltmesi sırasında riske atmayız) — ayrı bir
`chore/two-factor-panel-dedupe` görevine bırakılır. `admin/settings/security` **hiçbir zaman**
bir `components/site/*` bileşenini tüketmez (ayrı token sistemi, `design-notes-telehealth.md` §12.6).

---

## 6. KARAR: Host şeması ve oturum çerezi — **deneyle doğrulandı**

### 6.1 Yapılan deney (spekülasyon değil, ölçüm)

Gerçek Chromium (Playwright) ile, `SameSite=Strict; HttpOnly` bir çerez ve iki HTTP sunucusu
(3100 = sayfa, 4100 = API) kullanılarak ölçüldü:

| # | Sayfa origin'i | API host'u | Çerez gitti mi? |
|---|---|---|---|
| 1 | `localhost:3100` | `localhost:4100` (set) | — (yazıldı) |
| 2 | `localhost:3100` | `localhost:4100` | **EVET** |
| 3 | **`doktor.localhost:3100`** | `localhost:4100` | **HAYIR** |
| 4 | `siteadi.localhost:3100` | `api.siteadi.localhost:4100` (set) | — (yazıldı) |
| 5 | `siteadi.localhost:3100` | `api.siteadi.localhost:4100` | **EVET** |
| 6 | **`doktor.siteadi.localhost:3100`** | `api.siteadi.localhost:4100` | **EVET** |

**Sonuç 3 kritiktir:** `localhost` bir eTLD gibi davranır; `doktor.localhost` ile `localhost`
**farklı site**lerdir. Kullanıcının istediği `doktor.localhost:3000` + `localhost:4000` kombinasyonu
ile **hekim oturumu sayfa yenilemesinden sağ çıkamaz** (`/auth/refresh` çerezsiz gider → 401 →
`unauthenticated` → giriş ekranına düşer).

**Sonuç 6:** ortak bir üst etiket (`siteadi.localhost`) altındaki alt alan adları **aynı site**dir;
`SameSite=Strict` çerez sorunsuz taşınır. Bu, prodüksiyondaki `siteadi.com` / `doktor.siteadi.com` /
`api.siteadi.com` üçlüsünün birebir analogudur.

Ayrıca ölçüldü: `*.localhost` ve `*.*.localhost` adlarını **tarayıcı** otomatik 127.0.0.1'e çözer
(hosts dosyası gerekmez), **fakat Node.js'in OS çözümleyicisi ÇÖZEMEZ** (`ENOTFOUND` —
Windows'ta doğrulandı). Bu, §6.4'teki sunucu-taraflı env kuralının nedenidir.

### 6.2 KARAR: cookie `Domain` niteliği **EKLENMEZ**, `sameSite: "strict"` **DEĞİŞMEZ**

- `Domain=.siteadi.com` **REDDEDİLDİ.** Sorunu çözmez (aynı-site hesabı `Domain` niteliğine değil,
  kayıt edilebilir alan adına bakar — deney 6 bunu `Domain` olmadan kanıtlıyor) ve çerezin
  görünürlüğünü **tüm** alt alan adlarına genişleterek güvenlik yüzeyini gereksizce büyütür.
  Refresh çerezi **host-only** kalır.
- `sameSite: "none"` **REDDEDİLDİ.** Zorunlu `Secure` + gerçek CSRF gerilemesi + tarayıcıların
  üçüncü-taraf çerez kısıtları. security-agent onayı gerektirir ve gerekmiyor.
- `REFRESH_COOKIE_PATH = "/api/v1/auth"` **DEĞİŞMEZ**.

**Tek gereken:** frontend host'ları ile API host'unun **aynı kayıt edilebilir alan adı** altında
olması. Prodüksiyonda bu zaten sağlanır; yerel ortamda host şeması buna göre düzeltilir.

### 6.3 KARAR: host şemaları

**Prodüksiyon (referans):**
```
Ana site   https://siteadi.com
Hekim      https://doktor.siteadi.com
API        https://api.siteadi.com        (aynı kayıt edilebilir alan adı — ZORUNLU)
```
> **Bağlayıcı kısıt:** API farklı bir kayıt edilebilir alan adında (ör. `api-siteadi.net`)
> servis edilemez. Edilirse `SameSite=Strict` refresh çerezi **ana domain'de de** çalışmaz.

**Yerel geliştirme (KARAR — kullanıcının `doktor.localhost` isteğinden sapma):**
```
Ana site   http://siteadi.localhost:3000
Hekim      http://doktor.siteadi.localhost:3000
API        http://siteadi.localhost:4000
```
Sapmanın gerekçesi §6.1 deney satırı 3'tür — `doktor.localhost` teknik olarak **çalışamaz**.
`*.localhost` zinciri korunduğu için hosts dosyası/yönetici hakkı **gerekmez** (deney 6).

**Alternatif (devops-agent isterse, dokümante edilir):** `127.0.0.1 siteadi.test` +
`127.0.0.1 doktor.siteadi.test` hosts kayıtları. Avantajı: adları **Node.js de** çözer, §6.4'teki
`INTERNAL_*` istisnaları gerekmez. Dezavantajı: yönetici hakkı ister. **Varsayılan `*.localhost`,
bu bir opsiyondur.**

### 6.4 KARAR: env matrisi (devops-agent uygular)

| Değişken | Nerede | Dev (bare-metal `npm run dev`) | Dev (Docker) | E2E (`playwright.config.ts`) |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | frontend build-arg | `http://siteadi.localhost:3000` | aynı | `http://siteadi.localhost:3100` |
| **`NEXT_PUBLIC_DOCTOR_URL`** *(YENİ)* | frontend build-arg | `http://doktor.siteadi.localhost:3000` | aynı | `http://doktor.siteadi.localhost:3100` |
| `NEXT_PUBLIC_API_URL` | frontend build-arg | `http://siteadi.localhost:4000/api/v1` | aynı | `http://siteadi.localhost:4001/api/v1` |
| `INTERNAL_API_URL` | frontend runtime | **`http://localhost:4000/api/v1` (ZORUNLU)** | `http://backend:4000/api/v1` (mevcut) | **`http://localhost:4001/api/v1` (ZORUNLU)** |
| `NEXT_PUBLIC_INTERNAL_MEDIA_URL` | frontend build-arg | **`http://localhost:4000` (ZORUNLU)** | `http://backend:4000` (mevcut) | `http://localhost:4001` |
| `FRONTEND_URL` | backend | `http://siteadi.localhost:3000` | aynı | `http://siteadi.localhost:3100` |
| **`DOCTOR_FRONTEND_URL`** *(YENİ, opsiyonel)* | backend | `http://doktor.siteadi.localhost:3000` | aynı | `http://doktor.siteadi.localhost:3100` |
| `PUBLIC_URL` | backend | `http://siteadi.localhost:4000` | aynı | `http://siteadi.localhost:4001` |

**`INTERNAL_API_URL` ve `NEXT_PUBLIC_INTERNAL_MEDIA_URL` bare-metal'de neden ZORUNLU oldu:**
Node.js `siteadi.localhost`'u çözemez (§6.1). Bugüne kadar bu iki değişken yalnızca Docker'da
gerekiyordu çünkü `localhost` her yerde çözülüyordu. `*.localhost` şemasına geçişle birlikte
sunucu-taraflı fetch'ler (`SERVER_API_BASE_URL`) ve `next/image` optimize edici, adları **çözülebilen**
`localhost`'a yönlendirilmek zorundadır. Mekanizma zaten var (`lib/env.ts`), yalnızca değer
verilmesi gerekiyor — **kod değişikliği YOK**.

**`next.config.ts` (frontend-agent, DAR yetki — yalnızca bu anahtar):**
```ts
allowedDevOrigins: ["siteadi.localhost", "*.siteadi.localhost"]
```
Doğrulandı (`node_modules/next/dist/docs/.../allowedDevOrigins.md`): Next, dev sunucusuna
başlatıldığı hostname dışındaki origin'lerden gelen istekleri **varsayılan olarak bloklar**.
`images.remotePatterns` **elle düzenlenmez** — zaten env'den türetiliyor (`next.config.ts:14-56`).

**`backend/src/plugins/security.ts` (backend-agent):**
```ts
origin: [env.FRONTEND_URL, env.DOCTOR_FRONTEND_URL].filter(Boolean)
```
`@fastify/cors` dizi origin'i destekler; `credentials: true` korunur. `DOCTOR_FRONTEND_URL`
`config/env.ts`'e `z.string().url().optional()` olarak eklenir. **Wildcard/regex origin YASAK** —
allow-list sabit ve env'den gelir (security-agent kuralı).

---

## 7. Görev dağılımı

### 7.1 devops-agent (ÖNCE — frontend bunsuz test edilemez)

1. `frontend/.env.local.example`, `backend/.env.example`, `backend/.env.e2e`, `docker-compose.yml`
   ve `INFRA.md`'yi §6.4 matrisine göre güncelle.
2. `docker-compose.yml` frontend servisine `NEXT_PUBLIC_DOCTOR_URL` **build arg**'ını ekle
   (`NEXT_PUBLIC_*` build-time inline edilir — runtime `environment:` YETMEZ; mevcut
   `NEXT_PUBLIC_SITE_URL` deseniyle aynı).
3. Prod dağıtımında `doktor.<domain>` için DNS/sertifika (wildcard veya ayrı SAN) ve reverse-proxy
   host yönlendirmesi.
4. **Takip kalemi (§3.2):** doktor host'unda reverse-proxy seviyesinde yalnızca
   `/`, `/login`, `/forgot-password`, `/reset-password`, `/doctor/*`, `/_next/*`, `/api/*`
   yollarının uygulamaya geçirilmesi (`/admin`, `/dashboard` host seviyesinde kesilir).
5. **YAPMA:** uygulama kodu, proxy.ts, bileşenler.

### 7.2 backend-agent

1. `config/env.ts`: `DOCTOR_FRONTEND_URL` (opsiyonel URL) ekle; alanın yorumunda `FRONTEND_URL`
   ile ilişkisini ve neden allow-list olduğunu yaz.
2. `plugins/security.ts`: CORS `origin` → allow-list dizisi (§6.4). Wildcard YOK.
3. `lib/cookies.ts` **DEĞİŞMEZ** (§6.2) — `sameSite`/`Domain` dokunulmaz. Neden dokunulmadığını
   `refreshCookieOptions` yorumuna bir cümleyle ekle (bu dokümana atıfla).
4. Integration testi: `Origin: <doctor origin>` ile atılan bir `/auth/login` isteğinin
   `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials` aldığı; bilinmeyen bir
   origin'in **almadığı**.
5. **YAPMA:** yeni endpoint, şema, frontend kodu. `/doctor/*` uçları olduğu gibi kullanılır.

### 7.3 frontend-agent

> **Uygulamadan önce oku:** `frontend/AGENTS.md` ve
> `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
> Next 16 eğitim verisinden farklıdır. §2'deki doğrulanmış gerçekler bağlayıcıdır.

1. **`lib/doctor-host.ts`** (yeni, §5.5) + `lib/env.ts`'e `DOCTOR_SITE_URL` okuması.
2. **`src/proxy.ts`** — §3.1'deki **tam sırayı** uygula. Dosya başı yorumunu "TEK proxy dosyası,
   **ÜÇ** sorumluluk" olarak güncelle ve sıranın neden bağlayıcı olduğunu yaz. Matcher'ı §3.2'ye
   göre güncelle. Host **`request.headers.get("host")`** ile okunur (`nextUrl` DEĞİL, §2.3).
   Yönlendirme hedefleri **yalnızca env**'den (§3.6).
3. **`components/site/site-scope.tsx`** (yeni) — `(site)/layout.tsx:51-76+86` token bloğunu buraya
   çıkar; `(site)` ve `(doctor)` layout'ları ortak kullansın.
4. **Route taşıması** (§5.2): `app/[lang]/(site)/doctor/**` → `app/[lang]/(doctor)/doctor/**`
   (`git mv` ile — geçmiş korunsun). `(site)/layout.tsx`'ten header/footer KALDIRILMAZ, olduğu gibi
   kalır; yalnızca `site-scope` refactor'ü uygulanır.
5. **`app/[lang]/(doctor)/layout.tsx`** (yeni) — §5.3 sözleşmesi.
6. **`components/site/telehealth/doctor-top-bar.tsx`** (yeni) — §5.4.
7. **`doctor-portal-context.tsx`** (yeni) + `doctor-portal-provider.tsx` (yeni) —
   `doctor-portal-shell.tsx`'ten profil fetch/guard/hata durumlarını yukarı taşı (§5.4 invariant 1-3).
   `doctor-portal-feed-card.tsx`'in import yolunu güncelle, `data-testid`'leri **koru**.
8. **`components/auth/login-form.tsx`** (yeni, §4) — `app/(auth)/login/page.tsx`'ten çıkarılır,
   iki sayfa da import eder. **Kopyalama yok.**
9. **`app/[lang]/(doctor)/doctor/login/page.tsx`** (yeni, §4).
10. `DoctorPortalRouteGuard` + `LoginForm::goToDestination`: subdomain modu açıkken tam sayfa
    gezinme (§5.6). `resolvePostLoginPath` **saf kalır, değiştirilmez**.
11. `next.config.ts`: **yalnızca** `allowedDevOrigins` (§6.4). Başka anahtara dokunma.
12. Birim testleri (vitest): `lib/doctor-host.ts` (origin üretimi, `DOCTOR_HOST === SITE_HOST`
    döngü koruması, mod kapalıyken `null`), proxy karar tablosu
    (`next/experimental/testing/server`'ın `unstable_doesProxyMatch` / `isRewrite` /
    `getRedirectUrl` yardımcıları — §2 doc'unda mevcut).
13. `doctor-portal-shell.tsx`'teki "Katman 1 YALNIZCA SiteHeader'da yaşar" yorumunu güncelle (§5.4).
14. **YAPMA:** backend CORS/cookie, docker-compose/env dosyaları, renk/spacing kararı,
    `robots.ts`/`sitemap.ts` (§7.5 seo-agent).

### 7.4 qa-agent (Playwright)

Yeni spec: `tests/e2e/doctor-subdomain-isolation.spec.ts`. `playwright.config.ts`'in `baseURL`'i ve
`webServer.command` env'leri §6.4 matrisine göre güncellenir (`allowedDevOrigins` + `INTERNAL_API_URL`).

**Kapsanması ZORUNLU senaryolar:**

| # | Senaryo | Beklenen |
|---|---|---|
| 1 | `http://doktor.siteadi.localhost:3100/` | 200, `/doctor` içeriği, URL **`/` olarak kalır** (rewrite) |
| 2 | Aynı sayfada `SiteHeader`/`SiteFooter` | **YOK**; minimal bar **VAR** (logo, hekim adı+unvan, bildirim, çıkış) |
| 3 | Doktor host `/urunler`, `/hakkimizda`, `/blog` | 307 → `http://siteadi.localhost:3100/...` (query korunur) |
| 4 | Doktor host `/login` | Hekim girişi ekranı, URL `/login` |
| 5 | **Doktor host'ta giriş yap → sayfayı YENİLE (`reload`)** | **Oturum AÇIK kalır** (§6'nın asıl testi; `/auth/refresh` çerezi taşımalı) |
| 6 | Ana host `/doctor` (subdomain modu açık) | 307 → doktor host; hedefte oturum **korunur** (tam sayfa gezinme + refresh cookie) |
| 7 | Ana host `/` , `/urunler`, `/en/...`, `/tr/...` → `/...` 301 | **Regresyon yok** (mevcut locale davranışı) |
| 8 | Ana host `/login`, `/register`, `/forgot-password`, `/reset-password` | **Regresyon yok** — locale prefix'i almazlar, bakım modunda 503 görmezler (matcher §3.2 değişti!) |
| 9 | Bakım modu AÇIK: ana host → 503; doktor host `/doctor` → **200** | §3.3 |
| 10 | Doktor host yanıt header'ı | `X-Robots-Tag: noindex, nofollow` |
| 11 | Doktor host `/tr/doctor` | 307 → `/doctor` (tek dilli host, §3.5) |
| 12 | Ağ izleme: portal sayfası yüklemesi | `GET /doctor/me` **1 kez**, `GET /doctor/portal-feed` **1 kez** (§5.4 invariant 1 ve 4) |
| 13 | `NEXT_PUBLIC_DOCTOR_URL` tanımsızken tüm suite | Ana domain'de `/doctor` **eskisi gibi** çalışır (geriye dönük uyumluluk) |
| 14 | Mevcut `doctor-console-dashboard-layout.spec.ts`, `doctor-panel-session-lifecycle.spec.ts` | **Geçmeye devam eder** (`data-testid`'ler korundu) |

**Hatırlatma (proje hafıza notu):** ürün/blog/portföy 60 sn ISR gecikmesi bir bug değildir —
ilgili assert'ler `toPass` + `reload` ile poll edilir.

### 7.5 seo-agent

1. `X-Robots-Tag` header'ının (§3.1 [10]) yeterliliğini onayla; `(doctor)` sayfalarının kendi
   `generateMetadata`'sındaki mevcut `noindex`'i koru.
2. `sitemap.ts` / `robots.ts` `SITE_URL` tabanlıdır ve **değişmez**; doktor host'unda servis
   edilmelerinin (matcher'dan hariç oldukları için proxy onları görmez) kabul edilebilir olduğunu
   veya reverse-proxy'de kesilmesi gerektiğini karara bağla (§7.1 madde 4 ile birlikte).
3. Ana domain `/doctor` → 307 devri, kalıcı olmadığı için indeks devrine yol açmaz; portal zaten
   `noindex`. Doğrula.

### 7.6 security-agent

1. §3.6 (yönlendirme hedefinin `Host` header'ından türetilmemesi) — open redirect / host header
   injection denetimi.
2. §6.2 (cookie `Domain` eklenmemesi, `SameSite=Strict` korunması) — onay.
3. §6.4 CORS allow-list'in wildcard içermediği; `credentials: true` ile birlikte
   `Access-Control-Allow-Origin: *` **asla** üretilmediği.
4. §3.2 kabul edilen sınır: doktor host'unda `/admin`/`/dashboard` erişilebilirliğinin yetki
   modeline etkisi (beklenen: sıfır — yetki API tarafında).

### 7.7 documentation-agent

`INFRA.md` (host şeması + env matrisi §6.4), `README.md` (yerel kurulumda `siteadi.localhost`
adresleri), `CHANGELOG.md`. `docs/architecture/ARCHITECTURE.md` §10.12.5'e bakım modunun doktor
host'unu kapsamadığı notu (§3.3).

---

## 8. Definition of Done

- [ ] §6.4 env matrisi tüm ortamlarda uygulandı (devops-agent)
- [ ] CORS allow-list + integration testi geçiyor (backend-agent)
- [ ] `proxy.ts` §3.1 sırasını birebir uyguluyor, matcher §3.2 (frontend-agent)
- [ ] `/doctor/**` `(doctor)` grubuna taşındı; `SiteHeader`/`SiteFooter` doktor ağacında yok
- [ ] Minimal bar, §5.4'teki dört parçayı **mevcut** veri kaynaklarından besliyor; `GET /doctor/me`
      ve `GET /doctor/portal-feed` sayfa başına birer kez
- [ ] `LoginForm` paylaşılan bileşene çıkarıldı, kopyalanmadı
- [ ] Birim testleri (`lib/doctor-host.ts`, proxy karar tablosu) geçiyor
- [ ] Lint/format/typecheck geçiyor (code-quality-agent)
- [ ] §7.4'teki 14 e2e senaryosu geçiyor; mevcut doktor/locale/bakım-modu spec'lerinde regresyon yok
- [ ] security-agent §7.6 denetimini onayladı
- [ ] Dokümantasyon güncellendi (§7.7)
- [ ] **Kod değişikliği sonrası `docker compose up --build -d`** (proje hafıza kuralı)

## 9. Kapsam DIŞI (bilinçli)

- Hekim portalının çok dilliliği (§3.5).
- Yeni bildirim altyapısı — mevcut `GET /doctor/portal-feed` kullanılır; notification-agent'a iş yok.
- Hasta portalı (`/hesabim`, `/randevularim`) için ayrı subdomain — ana domain'de kalır.
- Doktor host'una özel tema/marka (ui-designer ayrı bir iş olarak değerlendirebilir).
- `/admin` için subdomain izolasyonu.
