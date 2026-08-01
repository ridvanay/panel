# Architect — Kapsam Kararı: Toast Kapsamı + "Hesabım" (Hesap Ayarları)

**Karar mercii:** architect · **Tarih:** 2026-07-31 · **Durum:** BAĞLAYICI
**Branş:** `feature/account-settings-and-toast-coverage`
**Bu tur kod YAZILMADI.** Değişen dosyalar: `docs/architecture/openapi.yaml`,
`docs/architecture/shared-types.ts`, `docs/architecture/ARCHITECTURE.md` (§10.6 eklendi).

---

## 1. db-agent'a devir kararı: **HAYIR — devir GEREKMİYOR**

| Kontrol | Bulgu | Sonuç |
|---|---|---|
| `User.name` | `backend/prisma/schema.prisma:83` — `name String` | Mevcut |
| `User.avatarUrl` | `schema.prisma:84` — `avatarUrl String?` | Mevcut |
| `User.passwordHash` | `schema.prisma:82` — `passwordHash String` | Mevcut, argon2 (`lib/password.ts`) |
| Şifre değişiminde oturum iptali | `RefreshToken.revoked` alanı zaten var, `2fa/disable` aynısını kullanıyor | Mevcut |
| Audit action için enum genişletmesi | `AuditLog.action` **serbest `String`** (`schema.prisma:436`), enum DEĞİL. Enum olan tek alan `AuditStatus` (`SUCCESS/FAILURE/FORBIDDEN`) ve `security.password_change` bunlardan `SUCCESS`/`FAILURE` kullanacak | **Migration gerekmez** |
| Toast özelliği | Tamamen istemci tarafı | Şema ile ilgisi yok |

**Sonuç:** Bu sprintte hiçbir migration üretilmeyecek. Eğer backend-agent bir migration
ihtiyacı olduğunu düşünürse, kod yazmadan ÖNCE architect'e eskale etmelidir.

---

## 2. API kontratı değişiklikleri (yapıldı)

### 2.1 YENİ: `POST /users/me/change-password`
`docs/architecture/openapi.yaml` (paths `/users/me/change-password`, schema
`ChangePasswordRequest`, response `TooManyRequests`).
`docs/architecture/shared-types.ts` → `ChangePasswordRequest`.

- Body: `{ currentPassword: string, newPassword: string }` (min 8)
- Başarı: **204** (gövde yok — `2fa/disable` ile aynı desen)
- Hata: **401** (şifre hatalı) · **422** (doğrulama) · **429** (rate limit)

### 2.2 DEĞİŞTİ: `PATCH /users/me` → `avatarUrl` artık `string | null`
Gerekçe (çakışma hakemliği): `ImageUploadField`, temizlenince `onChange("")` üretiyor;
mevcut backend şeması `z.string().url().optional()` boş string'i **422 ile reddeder** →
kullanıcı avatarını KALDIRAMAZ. Mevcut `frontend/src/app/dashboard/account/page.tsx:27`
bunu `avatarUrl || undefined` ile gizliyor (alan hiç gönderilmiyor, dolayısıyla avatar
asla silinemiyor). Kontrat karar: `null` = kaldır, `""` = geçersiz (422).

### 2.3 Yan düzeltme: `ApiErrorEnvelope.error.code` enum'una `PAYLOAD_TOO_LARGE` eklendi
Backend (`backend/src/lib/errors.ts:8`) bu kodu zaten üretiyordu, kontratta yoktu — drift kapatıldı.

---

## 3. backend-agent görev listesi

**Dosyalar:** `backend/src/modules/users/users.schemas.ts`, `users.routes.ts` (+ test).
**Yeni dosya/şema/migration YOK.**

### 3.1 `users.schemas.ts`
```
UpdateUserRequestSchema:
  name:      z.string().min(1).max(80).optional()
  avatarUrl: z.string().url().nullable().optional()   // null => avatarı kaldır

ChangePasswordRequestSchema (YENİ):
  currentPassword: z.string().min(1)
  newPassword:     z.string().min(8, "Şifre en az 8 karakter olmalı.")
                    // auth.schemas.ts:5 ile AYNI mesaj — tek terminoloji
```

### 3.2 `POST /users/me/change-password` davranış spesifikasyonu (bağlayıcı)
Referans implementasyon: `backend/src/modules/security/security.routes.ts` `/disable` (satır 116-167).

1. **Yetki:** yalnızca `authenticate` (mevcut `preHandler` hook zaten var). Site-rol
   şartı **YOK** — herkes yalnızca kendi şifresini değiştirir. `request.user!.id`
   dışında bir userId kabul edilmez.
2. **Rate limit:** route-level `config: { rateLimit: { max: 5, timeWindow: "1 minute" } }`.
   `security.routes.ts:32`'deki `SENSITIVE_ACTION_RATE_LIMIT` sabitini oradan kopyalamak
   yerine paylaşılan bir yere (`backend/src/lib/rate-limit.ts` gibi) taşıyıp iki yerden
   import etmek tercih edilir (code-quality-agent notu: iki kopya sabit istemiyoruz).
3. **Doğrulama sırası:**
   a. `user = prisma.user.findUnique({ where: { id: request.user!.id } })`
   b. `!user || !(await verifyPassword(user.passwordHash, body.currentPassword))` →
      audit `{ action: "security.password_change", status: "FAILURE", ipAddress }` yaz,
      sonra `throw new UnauthorizedError("Şifre hatalı.")`.
      Mesaj `2fa/disable` ile birebir aynı olmalı (bilgi sızdırmama + terminoloji birliği).
   c. `body.newPassword === body.currentPassword` → `throw new ValidationError(
      "Yeni şifre mevcut şifreden farklı olmalı.", { newPassword: [...] })` (422).
4. **Etki (tek `$transaction` içinde):**
   - `user.update({ data: { passwordHash: await hashPassword(body.newPassword) } })`
     (hash'i transaction DIŞINDA, argon2 async olduğu için önceden hesapla)
   - `refreshToken.updateMany({ where: { userId, revoked: false, tokenHash: { not: currentHash } }, data: { revoked: true } })`
     `currentHash` = `hashToken(request.cookies[REFRESH_COOKIE_NAME])`.
     **Politika (architect kararı):** mevcut oturum KORUNUR, diğer tüm cihazlar düşer.
     Kullanıcının kendini oturumdan atmaması + güvenlik best-practice dengesi;
     `2fa/disable` ile birebir tutarlı. Cookie yoksa (`currentHash === undefined`)
     `2fa/disable`'daki gibi TÜM token'lar iptal edilir.
   - `passwordResetToken` kayıtları için bu turda değişiklik yok (kapsam dışı).
5. **Audit (başarı):** `logAudit(app, { actorId, actorEmail, action: "security.password_change",
   targetType: "User", targetId: user.id, ipAddress })`. `metadata` **ASLA** şifre/hash içermez.
6. **Response:** `reply.code(204).send()`.

### 3.3 `PATCH /users/me` — `avatarUrl: null` desteği
`request.body` doğrudan `prisma.user.update({ data })`'ye geçiyor (`users.routes.ts:25-28`);
`avatarUrl: null` Prisma'da doğal olarak NULL yazar, ek kod gerekmez — sadece Zod şeması
`.nullable()` yapılmalı. `name` için `.max(80)` eklenince mevcut davranış değişmez.

### 3.4 Test (backend-agent sorumluluğu)
- Doğru şifre → 204 + `passwordHash` değişti + diğer refresh token'lar `revoked=true` + mevcut oturum ayakta
- Yanlış şifre → 401 + `FAILURE` audit kaydı yazıldı
- `newPassword === currentPassword` → 422
- `newPassword` 7 karakter → 422
- Kimliksiz istek → 401
- `PATCH /users/me` `{ avatarUrl: null }` → 200 + DB'de NULL; `{ avatarUrl: "" }` → 422

---

## 4. frontend-agent görev listesi

### 4.A Toast kapsam boşlukları (tam liste — tarama sonucu)

Kural (ARCHITECTURE.md §10.6): **kullanıcı tarafından tetiklenen her mutasyon** tam bir
toast üretir. Arka plan `load()`/polling hataları toast ÜRETMEZ (inline `Alert` kalır).
Mevcut inline `Alert`/`saveError` gösterimleri **kaldırılmaz**, toast onların yanına eklenir.

| # | Dosya | Handler / satır | Eksik olan | Önerilen metin |
|---|---|---|---|---|
| 1 | `frontend/src/app/admin/blog/new/page.tsx` | `handleSubmit` (~44-61) | success **ve** error toast (dosyada 0 toast) | ✅ `"Yazı oluşturuldu."` / ❌ `friendlyErrorMessage(err)` |
| 2 | `frontend/src/app/admin/pages/new/page.tsx` | `handleSubmit` (~96-114) | success **ve** error toast (dosyada 0 toast) | ✅ `"Sayfa oluşturuldu."` / ❌ `friendlyErrorMessage(err)` |
| 3 | `frontend/src/components/admin/media/image-upload-field.tsx` | `handleFileChange` (~27-38) | success **ve** error toast (dosyada 0 toast) | ✅ `"Görsel yüklendi."` / ❌ `friendlyErrorMessage(err)` |
| 4 | `frontend/src/components/admin/media/media-picker.tsx` | `handleFileChange` (~60-73) | success **ve** error toast (dosyada 0 toast) | ✅ `"Görsel yüklendi."` / ❌ `friendlyErrorMessage(err)` |
| 5 | `frontend/src/components/admin/page-builder/blocks/gallery-block.tsx` | `handleFileChange` (~27-40) | success **ve** error toast (dosyada 0 toast) | ✅ `"Görsel yüklendi."` / ❌ `friendlyErrorMessage(err)` |
| 6 | `frontend/src/app/admin/blog/[postId]/page.tsx` | `handleSave` catch (213), `handleDelete` catch (226) | **error** toast (success var) | ❌ `friendlyErrorMessage(err)` |
| 7 | `frontend/src/app/admin/pages/[pageId]/page.tsx` | `handleSave` catch (206), `handleDelete` catch (220) | **error** toast (success var) | ❌ `friendlyErrorMessage(err)` |
| 8 | `frontend/src/app/admin/blog/page.tsx` | `handleDelete` catch (81) | **error** toast (success var) | ❌ `friendlyErrorMessage(err)` |
| 9 | `frontend/src/app/admin/pages/page.tsx` | `handleDelete` catch (70) | **error** toast (success var) | ❌ `friendlyErrorMessage(err)` |
| 10 | `frontend/src/app/admin/blog/categories/page.tsx` | `handleCreate` catch (53), `handleDelete` catch (69) | **error** toast (success var) | ❌ `friendlyErrorMessage(err)` |
| 11 | `frontend/src/app/dashboard/account/page.tsx` | `handleSubmit` (21-35) | success **ve** error toast (dosyada 0 toast) | ✅ `"Bilgileriniz güncellendi."` / ❌ `friendlyErrorMessage(err)` — *opsiyonel, admin dışı shell; kapsama alınması önerilir* |

**Boşluk OLMAYAN (dokunma) — ön araştırmadaki şüphelerin sonucu:**
- `frontend/src/app/admin/navigation/page.tsx` — "2 toast yetersiz" şüphesi **YANLIŞ ÇIKTI**.
  Ekle/sil/sırala işlemleri **yalnızca yerel state** üzerinde çalışır (`addNavItem`,
  `moveItem`, `removeFooterColumnLink`…); tek gerçek mutasyon `handleSave` ve onun hem
  success (280) hem error (284) toast'ı var. Bu işlemlere toast eklenmesi **yasaktır** —
  gürültü yaratır ve "toast = sunucu sonucu" sözleşmesini bozar.
- `frontend/src/app/admin/settings/page.tsx` — tek mutasyon `handleSave`, success (284) +
  error (288) mevcut. Logo alt-işlemi ayrı bir mutasyon değil; yükleme toast'ı
  `ImageUploadField` içinde (#3) merkezî olarak çözülür — sayfaya kopyalanmaz.
- `admin/media/page.tsx` (9), `admin/settings/security/page.tsx` (10), `admin/users/page.tsx` (8),
  `notifications/templates/[key]` (4), `components/admin/revision-history.tsx` (2),
  `components/admin/users/new-user-dialog.tsx` (2), `components/admin/media-preview-dialog.tsx` (1) — yeterli.

**Not (#3-#5):** üç yükleme noktası aynı `mediaApi.uploadMedia` sarmalayıcısını
kopyalıyor. Toast eklerken üçünü ortak bir `useMediaUpload()` hook'una çekmek
code-quality-agent'ın tercihi olur; zorunlu değil ama önerilir.

### 4.B "Hesabım" — karar: **AYRI SAYFA `/admin/account`** (modal DEĞİL)

**Gerekçe (architect kararı, bağlayıcı):**
1. İçerik üç bağımsız bölümden oluşuyor (profil, avatar, şifre) — bir dialog için fazla.
2. Avatar seçimi `ImageUploadField` → `MediaPicker` zinciri **kendisi bir `Dialog` açıyor**;
   modal-içinde-modal (focus trap çakışması, üst üste `z-index`) doğrudan bir hata kaynağı.
3. `/admin/settings/security` zaten "kişisel hesap" bilgi mimarisinde bir SAYFA;
   "Hesabım" onun kardeşi olmalı, farklı bir etkileşim sınıfı değil.
4. Route olması `⌘K` komut paletine ve derin bağlantıya (deep link) doğal uyum sağlar.

**Kapsam:**
- **Yeni route:** `frontend/src/app/admin/account/page.tsx` (`"use client"`).
- **Bölüm 1 — Profil:** `name` (`Input`, zorunlu, max 80), salt-okunur `email` +
  rol rozeti (`Badge`). `PATCH /users/me` → başarıda `refreshSession()` çağır
  (`useAuth`, `auth-context.tsx:116`) ki topbar'daki ad/avatar anında güncellensin.
  Toast: ✅ `"Profiliniz güncellendi."`
- **Bölüm 2 — Avatar:** `ImageUploadField` **yeniden kullanılır** (yeni bileşen yazma).
  **Kritik:** `onChange` boş string üretir; API'ye giderken `avatarUrl: value || null`
  şeklinde **`null`'a çevrilmelidir** (bkz. §2.2). `avatarUrl: ""` gönderilirse 422 alınır.
  Profil ile aynı `Kaydet` altında birleştirilebilir (tek `PATCH`).
- **Bölüm 3 — Şifre değiştir:** `currentPassword` + `newPassword` + `newPasswordConfirm`.
  - `newPasswordConfirm` **yalnızca istemci tarafı**; gövdede GÖNDERİLMEZ (kontrat §2.1).
  - İstemci doğrulaması: min 8, iki yeni şifre eşleşmeli, yeni ≠ mevcut.
  - `autoComplete`: `current-password` / `new-password` / `new-password`.
  - `POST /users/me/change-password` → 204. Başarıda: formu temizle,
    ✅ `"Şifreniz değiştirildi. Diğer cihazlardaki oturumlarınız kapatıldı."`
    (kullanıcı oturum iptalinden HABERDAR edilmeli — bu bir UX gerekliliği, opsiyonel değil).
    Hata: ❌ `friendlyErrorMessage(err)` — 401 için "Şifre hatalı." zaten backend'den gelir.
  - UX referansı: `admin/settings/security/page.tsx`'teki 2FA-disable şifre onay formu
    (aynı `Field`+`Input type="password"` deseni), ama **`Dialog` içinde değil**, sayfa
    içinde bir `Card` olarak.
- **Yeni API sarmalayıcısı:** `frontend/src/lib/api/users.ts` →
  `export function changePassword(input: ChangePasswordRequest) {
     return apiFetch<void>("/users/me/change-password", { method: "POST", body: input });
   }`
- **Tip senkronizasyonu:** `frontend/src/lib/api/types.ts` içine `ChangePasswordRequest`
  eklenmeli ve `UpdateUserRequest.avatarUrl` → `string | null` yapılmalı
  (kaynak: `docs/architecture/shared-types.ts`).
- **Topbar:** `frontend/src/components/admin/topbar.tsx:83-84` — statik
  `<Avatar>` + `<span>{user.name}</span>` ikilisi tıklanabilir olmalı.
  Önerilen: mevcut `DropdownMenu` (aynı dosyada `AdminLocaleSwitcher` deseni) ile
  → "Hesabım" (`/admin/account`), "Güvenlik" (`/admin/settings/security`), "Çıkış Yap".
  Böylece ayrı duran `Çıkış Yap` butonu da menüye taşınıp topbar sadeleşir.
  `<button>` sarmalayıcı `aria-label="Hesap menüsü"` almalı (a11y).
- **Sidebar:** `components/admin/sidebar.tsx` NAV listesine "Hesabım" **eklenmez** —
  kişisel hesap girişi topbar'a aittir, sol menü site yönetimi içindir (bilgi mimarisi kararı).
- **Komut paleti:** `components/admin/command-palette.tsx` içine "Hesabım" komutu eklenir.
- **`/dashboard/account` ile ilişki:** `frontend/src/app/dashboard/account/page.tsx`
  zaten var (SaaS dashboard shell'i, düz `Card`, avatar için manuel URL input'u,
  şifre değiştirme YOK). Bu turda **silinmez/taşınmaz**. Şifre formu paylaşılan bir
  `frontend/src/components/account/change-password-form.tsx` bileşeni olarak yazılırsa
  sonraki turda `/dashboard/account` da onu kullanabilir — **önerilir, zorunlu değil.**
  İki sayfanın birleştirilmesi ayrı bir görev olarak architect'e bırakılmıştır.

---

## 5. ui-designer için notlar (bir sonraki turda karar verilecek)

Aşağıdakiler **frontend-agent'ın değil, ui-designer'ın** kararıdır; frontend-agent
bu kararlar gelmeden görsel dil seçmemelidir:

1. **`/admin/account` hangi görsel dili kullanacak?** Projede iki rakip dil var:
   (a) standart `Card` + `PageHeading` (`settings/security`, `navigation`),
   (b) "bento" koyu yüzey dili (`admin/settings/page.tsx` — `BentoCard`, `DarkField`,
   `bg-bento-bg`, accent gradient). **Architect önerisi:** (a) standart dil — çünkü
   Hesabım kavramsal olarak `settings/security`'nin kardeşi ve `ImageUploadField`
   standart tokenlarla geliyor (bkz. `design-notes-media-picker.md` madde 7'deki
   bilinen "dikiş" sorunu bento'da tekrar etmesin). Nihai karar ui-designer'ın.
2. **Avatar bölümünün görsel formu:** büyük yuvarlak önizleme + "Değiştir/Kaldır"
   ikilisi mi, yoksa `ImageUploadField`'ın mevcut dikdörtgen önizlemesi mi? Avatar
   dairesel gösterildiği için (`components/ui/avatar.tsx`) burada bir token/varyant
   ihtiyacı doğabilir.
3. **Şifre bölümünün "tehlike/hassas" tonu:** 2FA disable dialog'unda kullanılan uyarı
   tonu burada da olacak mı? Şifre değişimi diğer oturumları kapattığı için bir
   `Alert variant="warning"` bilgilendirmesi tasarlanmalı mı, yoksa yalnızca `hint`
   metni mi yeterli?
4. **Toast metin tonu:** mevcut metinler "…kaydedildi./…silindi." (edilgen, nokta ile
   biter). ui-designer bu mikro-kopya kuralını yazılı bir token/kural olarak sabitlemeli
   ki her ajan aynı tonu üretsin.
5. **Topbar dropdown:** "Çıkış Yap" butonunun menüye taşınması topbar'ın görsel
   dengesini değiştirir — onay ui-designer'dan gelmeli.

---

## 6. Sıra ve Definition of Done

1. **backend-agent** → §3 (endpoint + şema + testler). *(bloklamaz: §4.A ile paralel)*
2. **ui-designer** → §5 kararları. *(§4.B'yi bloklar)*
3. **frontend-agent** → §4.A (toast, bağımsız) → §4.B (Hesabım, backend+ui sonrası)
4. **security-agent** → yeni endpoint denetimi: brute-force (rate limit), şifre
   sızdırmama (audit `metadata`), oturum iptali politikası, timing-attack yüzeyi.
5. **compliance-agent** → PII değerlendirmesi: `avatarUrl` + `name` kullanıcı tarafından
   düzenlenebilir hale geliyor; şifre değişikliği audit log'da tutuluyor (KVKK açısından
   meşru menfaat / güvenlik kaydı gerekçesi belgelenmeli).
6. **qa-agent** → e2e: "şifre değiştir → diğer oturum düşer, mevcut oturum ayakta".
7. **documentation-agent** → CHANGELOG + API doc.

**DoD ek maddesi (bu görev için):** `frontend/src/lib/api/types.ts` ile
`docs/architecture/shared-types.ts` arasında `UpdateUserRequest`/`ChangePasswordRequest`
farkı KALMAMALI. Fark varsa kontrat kazanır, frontend düzeltir.
