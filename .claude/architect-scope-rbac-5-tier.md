# Architect — Kapsam Kararı: 5 Kademeli Kurumsal RBAC (`SiteRole` genişletmesi)

**Karar mercii:** architect · **Tarih:** 2026-08-23 · **Durum:** BAĞLAYICI
**Branş:** `feature/rbac-5-tier`
**Bu tur kod YAZILMADI.** Değişen dosyalar: bu doküman, `docs/architecture/openapi.yaml`,
`docs/architecture/ARCHITECTURE.md`, `CHANGELOG.md`.
**İlgili bağlayıcı dokümanlar:**
- `.claude/architect-scope-page-editor-roles.md` (§10.20 — standart/gelişmiş düzenleyici).
  **Bu doküman onu YÜRÜRLÜKTEN KALDIRMAZ; ÜZERİNE İNŞA EDER ve iki noktasını REVİZE EDER**
  (bkz. §3 ve §11 — "önceki karar dokümanına yapılan revizyonlar").
- `ARCHITECTURE.md` §5 (site-geneli RBAC), §8 (uç özeti), §10.18 (yumuşak silme), §10.20.

**Ajanlar arası çelişkide hakem sırası:** `openapi.yaml` → bu doküman →
`architect-scope-page-editor-roles.md`. Bu doküman ile eski doküman çelişirse **BU doküman kazanır**.

---

## 0. Yönetici özeti — bir bakışta karar

| Konu | Karar |
|---|---|
| Enum | `SiteRole { ADMIN, MANAGER, EDITOR, CUSTOMER, USER }` — `VIEWER` **KALDIRILIR** |
| Migration | Tip değiştirme (`CREATE TYPE`+`USING`+`DROP TYPE`+`RENAME`). `VIEWER → USER` |
| Varsayılan | `User.role @default(USER)` (eski: `VIEWER`) |
| `canUseAdvancedBuilder` | **`role === "ADMIN"`** — saf rol türevi. `User.advancedBuilderEnabled` kolonu **KALDIRILIR** |
| `/admin/*` kapısı | Yeni `requirePanelAccess()` = `ADMIN\|MANAGER\|EDITOR`. CUSTOMER/USER → **403** |
| MANAGER | ADMIN'in tüm yetkileri **EKSİ** 9 alan (§5.2) ve **EKSİ** blok yapısı |
| EDITOR | Yalnızca `blog` + `media` + `pages` (içerik-only). Diğer 17 modülde **403** |
| CUSTOMER / USER | Panelde hiçbir şey. Fark yalnızca ön yüz sunumunda + `/users/me/orders` |
| CUSTOMER'a terfi | Kimliği doğrulanmış checkout ile verilen siparişin ÖDENMESİ anında, `USER → CUSTOMER` |
| Rol değiştirme | Yalnızca **ADMIN**; hedef 5 değerin herhangi biri olabilir |

---

## 1. KARAR: Yeni `SiteRole` enum'ı

```prisma
enum SiteRole {
  ADMIN     // Süper Yönetici — sistem, ayarlar, kullanıcılar, serbest Page Builder
  MANAGER   // Yönetici — panelin tamamı; blok YAPISINI değiştiremez
  EDITOR    // Editör — blog (tam CRUD) + medya + sayfa İÇERİĞİ
  CUSTOMER  // Müşteri — panel YOK; ön yüzde hesap + sipariş geçmişi
  USER      // Standart Üye — panel YOK; yalnızca temel profil
}
```

**Değer sırası bağlayıcıdır** (ADMIN → USER, ayrıcalıktan azalan). Gerekçe: PostgreSQL
enum'unda tanım sırası `ORDER BY role` davranışını belirler; azalan ayrıcalık sırası, admin
kullanıcı listesinde "önce yöneticiler" sıralamasını ücretsiz verir. db-agent bu sırayı
DEĞİŞTİRMEZ.

### 1.1 Neden bu sefer enum genişletiliyor (önceki kararla çelişki DEĞİL)

`architect-scope-page-editor-roles.md` §1.3'te `AUTHOR` enum değeri eklemek REDDEDİLMİŞTİ.
O karar **bugün de doğrudur ve geçerlidir** — çünkü orada istenen şey bir *uç erişimi* değil,
*tek bir isteğin gövdesi içindeki alan* kısıtıydı ve `requireSiteRole` onu yapısal olarak
çözemezdi.

Bu istek FARKLIDIR: talep edilen 5 rolün ayrımı **uç seviyesindedir** (CUSTOMER `/admin/*`'a
hiç giremez; EDITOR `settings`'e giremez; MANAGER `api-keys`'e giremez). Bu tam olarak
`SiteRole` + `requireSiteRole`'ün çözmek için var olduğu problemdir. Yani:

- **Uç erişimi ekseni** → `SiteRole` (bu doküman, 5 değer).
- **Gövde-içi alan ekseni** → `assertTemplateEditAllowed` diff'i (§10.20.4, DEĞİŞMEDEN kalır).

İki eksen birbirinin yerine geçmez; bu istek birinci ekseni, önceki istek ikinci ekseni
gerektiriyordu. Bu ayrım korunur.

### 1.2 Kullanıcıya dönük etiketler (bağlayıcı — ui-designer sabitler, herkes AYNISINI kullanır)

| `SiteRole` | Panel/UI etiketi (TR) |
|---|---|
| `ADMIN` | `Süper Yönetici` |
| `MANAGER` | `Yönetici` |
| `EDITOR` | `Editör` |
| `CUSTOMER` | `Müşteri` |
| `USER` | `Standart Üye` |

**Eski etiketler KALDIRILIR:** `Editör (Gelişmiş Düzenleyici)`, `Yazar (Standart Düzenleyici)`,
`İzleyici`. Gerekçe: yetenek bayrağı kalktığı için (§3) "gelişmiş/standart" artık rolün
kendisidir, ikinci bir etiket ekseni yoktur. Kaynak dosya: `frontend/src/lib/role-badge.ts`.

---

## 2. KARAR: DB migration stratejisi ve veri eşlemesi

### 2.1 Eşleme

| Eski değer | Yeni değer | Etki |
|---|---|---|
| `ADMIN` | `ADMIN` | Yok |
| `EDITOR` | `EDITOR` | **Daralma** — bkz. §2.3 |
| `VIEWER` | `USER` | **Panel erişimini tamamen kaybeder** — bkz. §2.2 |

### 2.2 `VIEWER → USER`: bilinçli bir yetki DARALTMASIDIR

Bugün `VIEWER`, `/admin/*` altındaki salt-okunur uçların bir kısmına erişebiliyor
(`GET /admin/modules`, `GET /admin/pages`, `GET /admin/media`, `GET /admin/settings`,
`GET /admin/navigation`, `GET /admin/appearance` — bunların çoğu yalnızca `authenticated`
korumalı). Yeni modelde `USER` bunların **hiçbirine** erişemez (§4).

**Neden yine de `USER`:**
1. İstenen 5 rol arasında "salt-okunur panel izleyicisi" **yoktur**. Yeni modelde böyle bir
   kademe icat etmek, kullanıcının açıkça verdiği listeyi genişletmek olurdu.
2. Alternatif `VIEWER → EDITOR` **sessiz bir yetki YÜKSELTMESİDİR** (blog tam CRUD + medya
   yükleme + sayfa içeriği düzenleme). Bir migration'ın asla yapmaması gereken şey budur.
   Reddedildi.
3. Alternatif `VIEWER → MANAGER` daha da kötüdür (panelin tamamı). Reddedildi.
4. Fail-closed ilkesi: belirsizlikte **en az ayrıcalığa** düşürülür; geri vermek tek bir
   `PATCH /admin/users/{id}/role` çağrısıdır, geri almak imkânsızdır.

**db-agent + devops-agent için ZORUNLU operasyonel adım:** migration'dan ÖNCE etkilenen
hesaplar raporlanır ve deploy notuna yazılır:
```sql
SELECT id, email, name FROM users WHERE role = 'VIEWER' AND status <> 'DELETED';
```
Migration'dan SONRA, bu listedeki hesaplardan panele gerçekten ihtiyacı olanlar **ADMIN
tarafından elle** `MANAGER` veya `EDITOR`'e yükseltilir. Otomatik terfi YAPILMAZ.
documentation-agent bunu CHANGELOG'da **BREAKING** olarak işaretler.

### 2.3 `EDITOR → EDITOR`: kapsamı DARALIR

Bugünkü `EDITOR`, `products`, `portfolio`, `contact/submissions` ve `stats` (içerik
analitiği) uçlarına da erişiyor. Yeni modelde EDITOR bunların hepsinde **403** alır (§5.3).

Bu bir regresyon DEĞİL, **istenen davranıştır** (iş gereksinimi: "EDITOR sidebar'ında sadece
Blog Yazıları, Medya, Sayfalar görünür"). Ürün/portföy yönetmesi gereken mevcut EDITOR
hesapları **ADMIN tarafından elle `MANAGER`'a yükseltilir** — bu da §2.2 ile aynı deploy
notunda listelenir:
```sql
SELECT id, email, name FROM users WHERE role = 'EDITOR' AND status <> 'DELETED';
```
Otomatik terfi YAPILMAZ (aynı gerekçe: migration ayrıcalık yükseltmez).

### 2.4 Migration SQL'i (bağlayıcı iskelet — db-agent bunu uygular)

`SiteRole` şemada **yalnızca** `users.role` kolonunda kullanılıyor (doğrulandı:
`schema.prisma`'da başka hiçbir model bu tipi taşımıyor) → tip değiştirme tek kolonu etkiler.

```sql
-- 1) Yeni tip
CREATE TYPE "SiteRole_new" AS ENUM ('ADMIN', 'MANAGER', 'EDITOR', 'CUSTOMER', 'USER');

-- 2) Varsayılanı düşür (varsayılan varken tip dönüşümü yapılamaz)
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

-- 3) Kolonu dönüştür + VIEWER eşlemesi
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "SiteRole_new"
  USING (CASE WHEN "role"::text = 'VIEWER' THEN 'USER' ELSE "role"::text END)::"SiteRole_new";

-- 4) Tipleri takas et
DROP TYPE "SiteRole";
ALTER TYPE "SiteRole_new" RENAME TO "SiteRole";

-- 5) Yeni varsayılan
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';

-- 6) §3 — yetenek bayrağı kaldırılır
ALTER TABLE "users" DROP COLUMN "advanced_builder_enabled";
```

**Bağlayıcı migration kuralları:**
1. Bu **`ALTER TYPE ... ADD VALUE` DEĞİLDİR** — `schema.prisma`'daki geri-alınamazlık uyarısı
   (`SiteUserStatus`/`ImportJobType` notları) bu migration için geçerli değildir; tip
   değiştirme tek bir transaction içinde çalışır ve geri alınabilir bir down-migration
   yazılabilir.
2. Yine de **TEK BAŞINA (izole) gönderilir** — başka hiçbir şema değişikliği aynı migration
   dosyasına konmaz. `DROP TYPE`/`DROP COLUMN` içeren bir migration'ı başka değişikliklerle
   karıştırmak rollback'i imkânsız kılar.
3. Adım 6 **geri alınamaz veri kaybıdır** (`advanced_builder_enabled` değerleri). Kabul
   edilir: yeni modelde bu bilginin hiçbir anlamı yok (§3) ve türetilebilir değil ama
   *gerekli* de değil.
4. **İndeks EKLENMEZ.** `users.role` üzerinde bugün indeks yok; rol dağılımı sorgusu
   (`stats/users`) tam tarama yapıyor ve kullanıcı tablosu küçük. Spekülatif indeks açılmaz —
   ihtiyaç ölçümle kanıtlanırsa performance-agent açar.

---

## 3. KARAR: `canUseAdvancedBuilder` — saf rol türevi; `advancedBuilderEnabled` KALDIRILIR

### 3.1 Karar

```ts
// backend/src/lib/builder-capability.ts (TEK türetme noktası — imza DEĞİŞİR)
export function canUseAdvancedBuilder(user: { role: SiteRole }): boolean {
  return user.role === "ADMIN";
}
```

- `User.advancedBuilderEnabled` **kolonu DB'den kaldırılır** (§2.4 adım 6).
- `PATCH /admin/users/{userId}/builder-access` **ucu KALDIRILIR** (openapi'den ve koddan).
- `UpdateAdminUserBuilderAccessRequest` şeması **KALDIRILIR**.
- `AdminUser.advancedBuilderEnabled` DTO alanı **KALDIRILIR**.
- `middleware/advanced-builder.ts::requireAdvancedBuilder()` **KALDIRILIR** (§6.2).
- `User.canUseAdvancedBuilder` DTO alanı **KALIR** (salt-okunur, türetilmiş).

### 3.2 Gerekçe

1. **İş gereksinimi kesin:** MANAGER için `canUseAdvancedBuilder: false`, EDITOR için de
   (yapısal işlem yasağı) false. Yani ADMIN dışında hiç kimse `true` olamaz. Değeri asla
   `true` olamayacak bir kullanıcı-başı bayrağı tutmak **ölü kolondur** — ve ölü kolon,
   bir sonraki ajanın "acaba burada `true` olabilir mi?" diye kod yazmasına yol açan
   birinci sınıf bir drift kaynağıdır.
2. **Bayrağın var olma nedeni ortadan kalktı.** §10.20'de bayrak, "yeni bir `SiteRole`
   değeri eklememek için" seçilmişti (`architect-scope-page-editor-roles.md` §1.3). Artık
   enum'a 2 yeni değer ekliyoruz; bayrağın gerekçesi buharlaştı. İki mekanizmayı birden
   tutmak, tek bir problem için iki doğruluk kaynağı demektir.
3. **Spekülatif esneklik reddedildi.** "MANAGER için opsiyonel bir yükseltme olarak kalsın"
   ara yolu değerlendirildi ve **REDDEDİLDİ**: iş gereksinimi MANAGER'ı açıkça `false`
   olarak tanımlıyor; bugün hiçbir kullanıcının istemediği bir esnekliği korumak, her route
   ve her testte ikinci bir dal (`role === "MANAGER" && flag`) taşımak demektir.
4. **`canUseAdvancedBuilder` DTO alanı neden KALIYOR:** frontend'in 7 dosyası bu alanı
   okuyor (`app/admin/pages/[pageId]/page.tsx`, `pages/page.tsx`, `pages/new/page.tsx`,
   `users/page.tsx`, `content-list-table.tsx`, `revision-history.tsx`, `role-badge.ts`).
   Alanı kaldırmak sıfır kazanç için 7 dosyalık bir yeniden yazma demektir. Alan kalır,
   değeri artık `role === "ADMIN"`'den türer. **Ek fayda:** `simpleMode =
   !canUseAdvancedBuilder` ifadesi HİÇ DEĞİŞMEDEN, MANAGER/EDITOR için otomatik olarak
   doğru sonucu verir — iş gereksinimindeki "MANAGER/EDITOR sayfa açtığında BuilderCanvas
   tamamen gizlenir, sadece TemplateEditorView açılır" kuralı **yeni frontend mantığı
   gerektirmez**.

### 3.3 `PermissionsMatrix.capabilities` ne olur

Şema **ŞEKİL OLARAK DEĞİŞMEZ** (frontend "Yetkiler" ekranı bozulmaz), yalnızca veri değişir:

```ts
capabilities: [
  { key: "advancedBuilder", label: "Gelişmiş Düzenleyici",
    alwaysGrantedTo: ["ADMIN"], grantableTo: [] },  // grantableTo artık BOŞ
]
```
`grantableTo: []` → UI'daki "yetenek anahtarı" (Switch) doğal olarak render edilmez;
frontend'e ayrı bir "anahtarı kaldır" talimatı gerekmez. `capabilities` dizisi bilerek
korunuyor: ilerideki gerçek bir `Permission` tablosu için sözleşme yeri hazır kalır
(`architect-scope-page-editor-roles.md` §1.7 hâlâ geçerli — ikinci bir `User.canX` bayrağı
eklenmeden ÖNCE architect'e eskale edilir).

---

## 4. KARAR: `/admin/*` kapısı — `requirePanelAccess()`

### 4.1 Sorun

Bugün `/admin/*` altındaki pek çok GET ucu **yalnızca `authenticated`** korumalı
(`GET /admin/pages`, `GET /admin/media/folders`, `GET /admin/navigation`,
`GET /admin/appearance`, `GET /admin/settings`, `GET /admin/blog` …). `VIEWER` zaten panele
girebildiği için bu bir açık değildi. **Yeni modelde CUSTOMER ve USER kendi kendine kayıt
olabilen, ön yüz kullanıcılarıdır** — "authenticated" artık kapıyı açık bırakır. Bu, bu
görevin 1 numaralı güvenlik maddesidir.

### 4.2 Karar

Yeni middleware: `backend/src/middleware/panel-access.ts`
```ts
export const PANEL_ROLES = ["ADMIN", "MANAGER", "EDITOR"] as const;
export function requirePanelAccess() { /* = requireSiteRole(...PANEL_ROLES) */ }
```
`requireSiteRole` deseninin birebir aynısı: 403 `FORBIDDEN` + `FORBIDDEN` statülü audit.

**Uygulama biçimi (bağlayıcı):** her `/admin/*` prefix'iyle kayıtlı plugin, kendi scope'unda
`app.addHook("preHandler", requirePanelAccess())` çağırır. **URL string'ine bakan global bir
hook YAZILMAZ** (prefix eşleşmesi kırılgandır ve §4.3'teki istisnaları ifade edemez).

Uç-bazlı `requireSiteRole(...)` guard'ları **KALIR** (derinlemesine savunma) ve daha dardır;
panel kapısı yalnızca taban çizgisidir.

### 4.3 İSTİSNALAR — tam liste, sadece iki tane

| Prefix | Neden istisna |
|---|---|
| `/admin/settings/security/2fa` | **Self-servis.** Kullanıcının KENDİ 2FA'sını yönetmesi. `authenticated` kalır, 5 rolün hepsi erişir |
| `/admin/settings/security/sessions` | **Self-servis.** Kullanıcının KENDİ oturumlarını görmesi/kapatması. `authenticated` kalır |

> **Tespit (backlog):** bu iki router'ın `/admin/*` altında olması bir adlandırma kazasıdır —
> bunlar kullanıcı seviyesi uçlardır, panel uçları değil. `/users/me/security/*` altına
> taşınmaları doğru olurdu ama bu, bu turun kapsamı dışında bir BREAKING kontrat
> değişikliğidir. Takip kalemi: `chore/relocate-self-service-security-routes`.
> **Bu istisna listesi genişletilemez** — üçüncü bir istisna gerekiyorsa architect'e eskale edilir.

### 4.4 Zorlama testi (security-agent + qa-agent için ZORUNLU)

Fastify route tablosu (`app.printRoutes()` / `onRoute` hook ile toplanan kayıt) üzerinden
otomatik bir test: **`/api/v1/admin/` ile başlayan HER route'un preHandler zincirinde panel
guard'ı bulunmalıdır**, §4.3'teki iki prefix hariç. Bu test, gelecekte eklenecek bir
`/admin/*` router'ının guard'ı unutmasını yapısal olarak imkânsız kılar. Manuel gözden
geçirme yeterli KANIT DEĞİLDİR.

---

## 5. KARAR: 20 route dosyası için erişim tablosu

### 5.1 Yetki türetme ilkesi (bu tabloyu üreten kural — ezberlenmesi gereken tek şey)

**MANAGER = ADMIN'in tüm yetkileri, EKSİ aşağıdaki beş kategori:**
- **(a) Ayrıcalık yükseltme yüzeyi** — kullanıcı/rol yönetimi, izin matrisi, rol atayabilen
  toplu içe aktarma.
- **(b) Kimlik bilgisi yüzeyi** — API anahtarları, giden webhook secret'ları.
- **(c) Keyfi kod yürütme** — özel CSS/JS.
- **(d) Site-geneli kill switch** — `SiteSettings` yazma, modül aç/kapat, sistem sağlığı.
- **(f) Denetim izi** — audit log (denetleyen ile denetlenenin ayrılığı ilkesi).

**EDITOR = yalnızca `blog` + `media` + `pages` (içerik).** Diğer her modülde 403.

**CUSTOMER, USER = `/admin/*`'ın tamamında 403** (§4.3 istisnaları hariç).

### 5.2 İş gereksinimindeki çelişkinin hakemliği (açık gerekçe)

İş gereksinimi iki cümlede çelişiyor: madde 1 "ADMIN: **sistem, ayarlar, kullanıcılar** …",
madde 2 "MANAGER: **admin paneline tam erişir**". İkisi birden harfiyen doğru olamaz.

**Hakemlik:** madde 1, ADMIN'i *ayırt eden* yetkileri sayar; madde 2'deki "tam erişir",
"kapıda engellenmez ve panelin operasyonel/içerik alanlarının tamamına ulaşır" demektir —
"ADMIN ile birebir aynıdır" değil. Aksi okuma MANAGER'ı ADMIN'in kopyası yapar ve rolü
anlamsızlaştırır.

**Belirleyici güvenlik argümanı (tartışmaya kapalı):** `/admin/users`'a yazabilen bir MANAGER
kendini `ADMIN` yapabilir. Bu, tüm rol modelini tek adımda çökerten klasik bir dikey
ayrıcalık yükseltmesidir. MANAGER'ın kullanıcı yönetimine erişimi **hiçbir koşulda**
açılamaz. Aynı mantık (b)/(c)/(d)/(f) için de geçerlidir.

### 5.3 Modül tablosu (bağlayıcı — backend-agent bunu birebir uygular)

Kısaltma: **A**=ADMIN, **M**=MANAGER, **E**=EDITOR. Tümünde CUSTOMER/USER → 403 (§4).

| # | Route dosyası / prefix | Uç grubu | Bugün | **YENİ** |
|---|---|---|---|---|
| 1 | `api-keys` `/admin/settings/api-keys` | tümü (okuma dahil) | A | **A** — (b) |
| 2 | `appearance` `/admin/appearance` | `GET`, `GET /presets`, `GET /custom-code` | authenticated | **A, M, E** (panel kapısı) |
| 2 | " | `PATCH /`, `POST /reset` | A | **A, M** |
| 2 | " | `PUT /custom-code/css`, `PUT /custom-code/js` | A | **A** — (c) |
| 3 | `blog` `/admin/blog`, `/categories`, `/tags` | liste/okuma, oluştur, güncelle, yayınla, çöpe at, geri yükle, bulk, revizyon (okuma+restore), kategori/etiket oluştur-güncelle | A, E | **A, M, E** |
| 3 | " | `DELETE /:postId/permanent`, `DELETE /categories/:id`, `DELETE /tags/:id` | A | **A, M** |
| 4 | `contact` `/admin/contact` | form yapılandırması (`/form`, `/form/fields`) | A | **A, M** |
| 4 | " | gönderim okuma/durum (`/submissions*`) | A, E | **A, M** — EDITOR çıkarıldı (ziyaretçi PII'si, EDITOR kapsamı dışı) |
| 4 | " | gönderim silme | A | **A, M** |
| 5 | `email-templates` `/admin/notifications/templates` | tümü (GET dahil) | A | **A, M** |
| 6 | `import` `/admin/import/jobs` | tümü | A | **A** — (a): kullanıcı içe aktarma hesap oluşturup **rol atayabiliyor** |
| 7 | `localization` `/admin/locales` | `GET` | authenticated | **A, M, E** |
| 7 | " | `POST`, `PATCH`, `DELETE` | A | **A, M** |
| 8 | `logs` `/admin/logs` | tümü | A | **A** — (f) |
| 9 | `media` `/admin/media` | okuma, yükleme, alt metin, klasör oluştur/yeniden adlandır/taşı | A, E | **A, M, E** |
| 9 | " | medya kalıcı silme, klasör silme | A | **A, M** |
| 10 | `navigation` `/admin/navigation` | `GET` | authenticated | **A, M, E** |
| 10 | " | `PUT` | A | **A, M** |
| 11 | `orders` `/admin/orders` | tümü | A | **A, M** |
| 12 | `outbound-webhooks` `/admin/settings/webhooks` | tümü (okuma dahil) | A | **A** — (b) |
| 13 | `pages` `/admin/pages` | **üç katmanlı — bkz. §6** | karma | **bkz. §6** |
| 14 | `portfolio` `/admin/portfolio`, `/categories` | yazma uçları | A, E | **A, M** — EDITOR çıkarıldı |
| 14 | " | kalıcı silme, kategori silme | A | **A, M** |
| 14 | " | liste/okuma | A, E | **A, M** — EDITOR çıkarıldı |
| 15 | `products` `/admin/products`, `/categories` | 14 ile BİREBİR AYNI | A, E / A | **A, M** |
| 16 | `reports` `/admin/reports/exports` | tümü | A | **A, M** |
| 17 | `settings` `/admin/settings` | `GET /admin/settings` | authenticated | **A, M, E** |
| 17 | " | `PATCH /admin/settings` | A | **A** — (d) |
| 17 | " | `GET /admin/settings/permissions` | A | **A** — (a) |
| 17 | " | `/admin/settings/security/2fa`, `/sessions` | authenticated | **authenticated — 5 ROLÜN HEPSİ** (§4.3 istisnası) |
| 18 | `site-modules` `/admin/modules` | `GET` | A, E, VIEWER | **A, M, E** |
| 18 | " | `PATCH /:key` | A | **A** — (d): modül kapatmak public siteyi 404'e düşürür |
| 19 | `stats` `/admin/stats` | `/views`, `/breakdown`, `/top-content`, `/live-visitors` | A, E | **A, M** — EDITOR çıkarıldı |
| 19 | " | `/summary`, `/users`, `/revenue` | A | **A, M** |
| 20 | `system` `/admin/health` | tümü | A | **A** — (d), iş gereksinimi madde 1 "Sistem" |
| 21 | `users` `/admin/users` | tümü (okuma dahil) | A | **A** — (a). MANAGER GET'te de 403 (kullanıcı listesi = PII) |

> `contentRevisions` ayrı bir router değildir; `pages` ve `blog` router'larının içinde yaşar
> ve **kapsayıcı entity'nin eşiğini miras alır** (pages → §6, blog → satır 3).

### 5.4 Uygulama notu — rol listeleri sabitlenir

backend-agent, 100'den fazla çağrı yerinde elle dizi yazmaz. `backend/src/middleware/site-rbac.ts`
(veya yanına `lib/site-roles.ts`) şu sabitleri dışa verir ve route'lar BUNLARI kullanır:

```ts
export const ROLES_ADMIN        = ["ADMIN"] as const;                       // (a)(b)(c)(d)(f)
export const ROLES_ADMIN_MANAGER= ["ADMIN", "MANAGER"] as const;            // panel operasyonu
export const ROLES_PANEL        = ["ADMIN", "MANAGER", "EDITOR"] as const;  // içerik + panel kapısı
```
Gerekçe: `architect-scope-page-editor-roles.md` §1.3'te "40 ayrı `requireSiteRole` çağrısının
tek tek triyajı" bir RİSK olarak sayılmıştı. Bu risk şimdi gerçekleşiyor — sabitler, bir
sonraki rol değişikliğinde aynı triyajın tekrarlanmasını önler. Serbest dizi yazımı yalnızca
§5.3'te "istisna" olarak işaretlenmiş satırlarda kabul edilir.

---

## 6. KARAR: Sayfa modülü — üç katmanlı yetki

Sayfa modülü tek bir eşikle ifade edilemez. **Bağlayıcı üç katman:**

### Katman 1 — Blok YAPISI: **yalnızca ADMIN**
Blok ekleme/silme/taşıma/sıralama, `container.settings`, `reveal`, `custom-html.data.html`,
`isLegalDocument`, `authorId`.
**Mekanizma DEĞİŞMEZ:** `assertTemplateEditAllowed` diff'i, `!canUseAdvancedBuilder(user)`
olan HER kullanıcı için (artık: ADMIN olmayan herkes), HER sayfada, `editMode`'dan bağımsız
çalışır (§10.20, 2026-08-23 güncellemesi). MANAGER ve EDITOR ikisi de bu guard'a takılır.
İhlal → **403 `FORBIDDEN`** (422 değil).

### Katman 2 — Sayfa YAŞAM DÖNGÜSÜ ve KİMLİĞİ: **ADMIN, MANAGER**
`DELETE /admin/pages/{id}` (çöpe at), `POST /{id}/restore`, `DELETE /{id}/permanent`,
`POST /admin/pages/bulk`, `POST /{id}/revisions/{revisionId}/restore`; ve `PATCH` gövdesinde
`slug`, `editMode` alanları.
EDITOR bu uçlarda/alanlarda **403** — iş gereksinimi: "yeni sayfa ekleyemez, silemez".

### Katman 3 — Blok İÇERİĞİ ve sayfa META'sı: **ADMIN, MANAGER, EDITOR**
`GET /admin/pages`, `GET /admin/pages/{id}`, `PATCH /admin/pages/{id}`,
`POST /{id}/autosave`, `GET /{id}/revisions`, `GET /{id}/revisions/{revisionId}`; ve `PATCH`
gövdesinde `title`, `seoTitle`, `seoDescription`, `ogTitle`, `ogImageUrl`, `canonicalUrl`,
`noIndex`, `status`, `scheduledAt`, `translations` (içindeki `blocks` de Katman 1 diff'ine tabidir).

### 6.1 İSTİSNA: `POST /admin/pages` (yeni sayfa) → **yalnızca ADMIN**

Katman 2 mantığına göre MANAGER'a verilmesi beklenirdi; **bilinçli olarak verilmiyor.**
Gerekçe: Katman 1 gereği MANAGER blok EKLEYEMEZ. Bir MANAGER yeni bir sayfa oluşturursa
elinde **hiçbir zaman doldurabileceği bir blok kazanmayacak boş bir kabuk** kalır. Bu,
`architect-scope-page-editor-roles.md` §4.1'de standart kullanıcı için verilen kararın
birebir aynısıdır ve gerekçesi değişmemiştir. İş gereksinimi sayfa oluşturmayı yalnızca
EDITOR için açıkça yasaklıyor; MANAGER için yasak, `canUseAdvancedBuilder: false`
kuralından **zorunlu olarak türer** — açılsaydı kırık bir akış üretirdi.
**Takip kalemi (MANAGER'a anlamlı bir oluşturma yolu):** `feature/page-duplicate-from-template`
(zaten mevcut backlog kalemi) — şablon bir sayfayı klonlamak MANAGER'a açılabilir.

### 6.2 `requireAdvancedBuilder()` middleware'i KALDIRILIR

Bugün Katman 2 uçlarını `requireSiteRole("ADMIN","EDITOR") + requireAdvancedBuilder()`
koruyor. Yeni modelde `canUseAdvancedBuilder === (role === "ADMIN")` olduğu için bu kombinasyon
**fiilen ADMIN-only** demektir ve MANAGER'ı yanlışlıkla dışarıda bırakır. Bu yüzden:

- `middleware/advanced-builder.ts` **silinir**.
- Katman 2 uçları `requireSiteRole(...ROLES_ADMIN_MANAGER)` ile korunur.
- `POST /admin/pages` `requireSiteRole(...ROLES_ADMIN)` ile korunur (§6.1).
- Katman 3 uçları `requireSiteRole(...ROLES_PANEL)` ile korunur.
- `lib/builder-capability.ts::canUseAdvancedBuilder` **kalır** ve yalnızca **gövde-içi diff
  kararı** (Katman 1) ile DTO alanı için kullanılır — uç seviyesinde ARTIK KULLANILMAZ.

### 6.3 Frontend'e otomatik gelen davranış (yeni mantık YAZILMAZ)

`simpleMode = !user.canUseAdvancedBuilder` ifadesi
(`frontend/src/app/admin/pages/[pageId]/page.tsx`) değişmeden, MANAGER ve EDITOR için `true`
döner → `BuilderCanvas`, konteyner ekleme butonları, stil/efekt panelleri gizlenir ve
`TemplateEditorView` açılır. İş gereksinimindeki frontend kuralı **zaten karşılanmıştır**;
frontend-agent bu kural için yeni bir koşul EKLEMEZ.

---

## 7. KARAR: Yeni kullanıcı kaydında varsayılan rol ve CUSTOMER'a geçiş

### 7.1 Varsayılan rol: **`USER`**

```prisma
role SiteRole @default(USER)
```
`auth.service.ts::register` davranışı **kavramsal olarak DEĞİŞMEZ**: ilk kullanıcı `ADMIN`
(kilitlenme koruması), sonrakiler `undefined` → şema varsayılanı → artık `USER`.

**Gerekçe:** `POST /auth/register` **public**'tir; herkes çağırabilir. Varsayılanın panele
erişimi olan bir role (EDITOR/MANAGER) düşmesi doğrudan bir güvenlik açığıdır. `CUSTOMER`
de varsayılan OLAMAZ: müşteri olmak bir ticari ilişkinin sonucudur, kayıt formunun değil.
`USER` = en az ayrıcalık, ve `VIEWER → USER` migration eşlemesiyle tutarlıdır.

### 7.2 `USER → CUSTOMER` terfisi: **ödeme tamamlandığında, otomatik**

**Tetikleyici:** `Order.status` ödendi durumuna geçtiğinde (Stripe
`checkout.session.completed` işlenirken) ve `Order.siteUserId` **dolu** ise:
```
if (user.role === "USER") user.role = "CUSTOMER"
```
- Yalnızca `USER` → `CUSTOMER`. `EDITOR`/`MANAGER`/`ADMIN`/`CUSTOMER` **hiçbir koşulda
  değiştirilmez** (bir ADMIN alışveriş yaparsa rolü düşürülemez — bu bir ayrıcalık kaybı olurdu).
- Otomatik **geri düşürme YOKTUR** (iade/iptal `CUSTOMER`'ı `USER` yapmaz — üyelik durumu,
  sipariş durumu değildir).
- Audit: `user.role_change` (`metadata: { from: "USER", to: "CUSTOMER", reason: "order_paid",
  orderId }`), `actorId: null` (sistem aktörü).

**`Order.siteUserId`'nin dolması için gereken tek sözleşme değişikliği:**
`POST /checkout/session` **isteğe bağlı kimlik doğrulamalı** hale gelir — `Authorization:
Bearer` başlığı VARSA ve geçerliyse `siteUserId` kaydedilir; YOKSA bugünkü misafir akışı
aynen çalışır (401 ÜRETİLMEZ). Bu, sepet/checkout'un misafir kalması kararını (§10.9.3)
bozmaz, yalnızca giriş yapmış kullanıcıya siparişini sahiplendirir.

### 7.3 Reddedilen alternatifler (gerekçeli)

| Alternatif | Neden reddedildi |
|---|---|
| Kayıt formunda "müşteriyim" seçimi | Kullanıcı kendi rolünü seçemez — rol bir yetki ifadesidir, tercih değil. En temel RBAC ilkesi. |
| `order.customerEmail` ile hesap eşleştirip terfi | Misafir checkout'ta e-posta **doğrulanmamıştır**; saldırgan başkasının e-postasını girip o hesabın `/siparislerim` ekranına yabancı bir sipariş düşürebilir. Reddedildi. |
| Herkes doğrudan `CUSTOMER` doğsun | `USER` ile `CUSTOMER` arasındaki ayrımı anlamsızlaştırır; iş gereksinimi ikisini ayrı roller olarak istiyor. |

**KAPSAM DIŞI (bilinçli):** geçmiş misafir siparişlerinin sonradan bir hesaba bağlanması
("siparişimi hesabıma ekle" akışı, e-posta doğrulamalı). Takip kalemi:
`feature/order-account-linking`.

### 7.4 CUSTOMER ile USER'ın API'deki tek farkı

**API tarafında rol bazlı bir fark YOKTUR** — ve **icat EDİLMEYECEKTİR**.

Yeni uç: `GET /users/me/orders` — **authenticated (5 rolün hepsi)**, `Order.siteUserId = me`
filtresiyle cursor sayfalı liste döner. Bir `USER`'ın çağırması boş liste döndürür.

**Gerekçe (bağlayıcı):** yetkilendirmenin gerçek kontrolü **sahipliktir** (`siteUserId = me`),
rol değil. Üzerine bir `requireSiteRole("CUSTOMER")` eklemek ikinci, gereksiz bir kontroldür
ve terfi zamanlaması geciktiği an (webhook kuyruğu) kullanıcının kendi siparişini
görememesine yol açar. backend-agent bu uca rol guard'ı EKLEMEZ.

Ayrım **ön yüz sunum katmanındadır** (§8.3): `/siparislerim` bağlantısı/rotası yalnızca
`role === "CUSTOMER"` iken gösterilir.

---

## 8. KARAR: Frontend kuralları

### 8.1 `/admin/users` rol yönetimi

- Rol dropdown'ı **5 rolün hepsini** listeler (§1.2 etiketleriyle).
- Rolü **yalnızca ADMIN** değiştirebilir. MANAGER/EDITOR bu sayfaya zaten erişemez (403,
  §5.3 satır 21) → sayfa MANAGER/EDITOR için sidebar'da GÖRÜNMEZ ve doğrudan gidilirse
  "yetkiniz yok" ekranı gösterilir.
- Yetenek anahtarı (`advancedBuilderEnabled` Switch'i) **KALDIRILIR** (§3).

### 8.2 Sidebar görünürlüğü (bağlayıcı tablo)

| Sidebar öğesi | ADMIN | MANAGER | EDITOR |
|---|---|---|---|
| Panel ana sayfa / Gösterge paneli | ✔ | ✔ | ✖ (bkz. §8.4) |
| Sayfalar | ✔ (tam) | ✔ (tam) | ✔ — **"Sayfalar (Salt İçerik Düzenleme)"** etiketiyle |
| Blog Yazıları (+kategori/etiket) | ✔ | ✔ | ✔ |
| Medya | ✔ | ✔ | ✔ |
| Ürünler / Portföy | ✔ | ✔ | ✖ |
| Siparişler | ✔ | ✔ | ✖ |
| İletişim Formu / Gönderimler | ✔ | ✔ | ✖ |
| Navigasyon | ✔ | ✔ | ✖ |
| Görünüm (Site Özelleştirme) | ✔ | ✔ (özel CSS/JS sekmesi HARİÇ) | ✖ |
| Diller | ✔ | ✔ | ✖ |
| Bildirim Şablonları | ✔ | ✔ | ✖ |
| İstatistikler / Raporlar | ✔ | ✔ | ✖ |
| Modüller | ✔ (aç/kapat) | ✔ (salt-okunur) | ✖ |
| İçe Aktarma | ✔ | ✖ | ✖ |
| **Kullanıcılar** | ✔ | ✖ | ✖ |
| **Ayarlar** | ✔ | ✖ | ✖ |
| **Sistem Sağlığı** | ✔ | ✖ | ✖ |
| Loglar | ✔ | ✖ | ✖ |
| API Anahtarları / Webhook'lar | ✔ | ✖ | ✖ |
| Hesabım / Güvenlik (2FA, oturumlar) | ✔ | ✔ | ✔ |

Kaynak dosya: `frontend/src/components/admin/sidebar.tsx`.
**Gizleme bir güvenlik önlemi DEĞİLDİR** — sunucu her istekte bağımsız karar verir; gizleme
yalnızca kullanılabilirliktir (`architect-scope-page-editor-roles.md` §5.1 ile aynı ilke).

### 8.3 Ön yüz (storefront) görünürlüğü

| Rota | ADMIN | MANAGER | EDITOR | CUSTOMER | USER |
|---|---|---|---|---|---|
| `/hesabim` (profil, şifre, 2FA) | ✔ | ✔ | ✔ | ✔ | ✔ |
| `/siparislerim` | ✔ | ✔ | ✔ | ✔ | ✖ (bağlantı gizli) |
| Sepet / ürün sayfaları | herkese açık (giriş gerektirmez) ||||| 

`/hesabim` ve `/siparislerim` rotaları **HENÜZ YOKTUR** —
`frontend/src/app/[lang]/(site)/` altında oluşturulacaktır (frontend-agent).
`/siparislerim` yalnızca `role === "CUSTOMER"` iken navigasyonda gösterilir; doğrudan
gidilirse `GET /users/me/orders` boş liste döner ve "henüz siparişiniz yok" boş durumu çizilir
(hard 403 ekranı DEĞİL — §7.4 gerekçesi).

### 8.4 EDITOR'ün açılış sayfası (atlanması kolay, bağlayıcı)

`/admin` gösterge paneli `GET /admin/stats/*` çağırıyor; EDITOR bu uçlarda **403** alacak.
Bu yüzden **EDITOR girişte `/admin/blog`'a yönlendirilir** ve `/admin` gösterge paneli EDITOR
için render edilmez. Aynı sebeple `notification-center.tsx` (iletişim gönderimleri/siparişler
üzerinden besleniyorsa) EDITOR için **hiç fetch etmez** — aksi halde panel her açılışta 403
gürültüsü üretir.

---

## 9. KARAR: `/admin/users` rol değiştirme sözleşmesi

| Soru | Karar |
|---|---|
| Kim değiştirebilir | **Yalnızca ADMIN.** MANAGER dahil hiç kimse (§5.2 escalation gerekçesi) |
| Hedef rol kümesi | **5 değerin herhangi biri** — `ADMIN`, `MANAGER`, `EDITOR`, `CUSTOMER`, `USER` |
| `CUSTOMER`/`USER`'a düşürme | **İZİNLİ** — panel erişimini geri alma (ban/downgrade) senaryosunun doğru aracı budur |
| Son aktif ADMIN | `assertNotLastActiveAdmin` **DEĞİŞMEDEN** geçerli: son aktif ADMIN'i başka HERHANGİ bir role çekmek → **409 CONFLICT** |
| Kendi rolünü değiştirme | Bugünkü davranış korunur; §? ek kural İCAT EDİLMEZ (son-admin 409'u zaten kilitlenmeyi engelliyor) |
| `POST /admin/users` (`CreateAdminUserRequest.role`) | 5 değerin hepsi kabul; **varsayılan `EDITOR`** (en dar panel rolü) DEĞİŞMEZ |
| `advancedBuilderEnabled` gövde alanı | **KALDIRILIR** (create ve patch gövdelerinden) |
| Rate limit / audit | `ADMIN_USERS_RATE_LIMIT` (20/dk), `user.role_change` audit'i — DEĞİŞMEZ |
| `DELETED` kullanıcı | 404 — DEĞİŞMEZ |

**Eski notun geçersizliği:** openapi'deki "`role: VIEWER` hedefte de kabul edilir (422
üretilmez)" notu **KALDIRILIR** — `VIEWER` artık var olmayan bir değerdir ve gönderilirse
şema doğrulaması **422** verir. Bu, davranış değişikliği değil, enum daralmasının doğal sonucudur.

---

## 10. Görev dağılımı

Sıra: **db-agent → backend-agent → security-agent → frontend-agent → qa-agent →
documentation-agent.** (ui-designer yalnızca §1.2 etiket/rozet tokenleri için, backend ile
paralel.) Çok ajanlı olduğu için sıralama/bağımlılık planının detayı **release-coordinator**'a
devredilir; aşağıdaki liste her ajanın KAPSAM sınırıdır, takvim değildir.

### 10.1 db-agent
1. `enum SiteRole` → 5 değer, §1'deki SIRA ile. `VIEWER` kaldırılır.
2. `User.role SiteRole @default(USER)`.
3. `User.advancedBuilderEnabled` kolonunu **kaldır**.
4. Migration: §2.4'teki SQL, **izole/tek başına** bir migration dosyası.
5. Migration öncesi/sonrası operasyonel sorgular (§2.2, §2.3) deploy notuna yazılır.
6. **İndeks EKLEME** (§2.4 madde 4).
7. `///` yorumlarında bu dokümana referans ver; `SiteRole` yorumundaki
   "ADMIN/EDITOR/VIEWER" metnini güncelle.
8. **YAPMA:** guard, türetme mantığı, DTO.

### 10.2 backend-agent
1. `lib/site-roles.ts` (veya `middleware/site-rbac.ts` içinde): `ROLES_ADMIN`,
   `ROLES_ADMIN_MANAGER`, `ROLES_PANEL` sabitleri (§5.4).
2. `middleware/panel-access.ts::requirePanelAccess()` + her `/admin/*` plugin'ine
   `preHandler` hook'u; §4.3'teki İKİ istisna hariç.
3. `lib/builder-capability.ts`: imza `{ role: SiteRole }`, gövde `role === "ADMIN"`.
4. `middleware/advanced-builder.ts` **sil**; çağrı yerlerini §6'ya göre rol listelerine çevir.
5. §5.3 tablosundaki HER satırı uygula. `VIEWER` geçen tüm kaynak dosyalar (doğrulanmış liste):
   `lib/content-author.ts`, `lib/permissions-matrix.ts`, `lib/stats-query.ts`,
   `modules/appearance/appearance.routes.ts`, `modules/import/import.worker.ts`,
   `modules/pages/pages.routes.ts`, `modules/reports/reports.schemas.ts`,
   `modules/site-modules/site-modules.routes.ts`, `modules/stats/stats.schemas.ts`,
   `modules/users/admin-users.schemas.ts`, `schemas/entities.ts`.
6. `PATCH /admin/users/{userId}/builder-access` ucunu ve şemasını **sil**;
   `AdminUser.advancedBuilderEnabled` DTO alanını **sil**.
7. `lib/permissions-matrix.ts`: `roles` 5 değere, `modules` §5.3'e, `capabilities`
   §3.3'e göre güncellenir.
8. `POST /checkout/session`: isteğe bağlı kimlik doğrulama → `Order.siteUserId` (§7.2).
9. Stripe ödeme tamamlanma yolunda `USER → CUSTOMER` terfisi + audit (§7.2).
10. Yeni uç: `GET /users/me/orders` (authenticated, sahiplik filtresi, cursor sayfalı) —
    **rol guard'ı EKLEME** (§7.4).
11. `auth.service.ts::register` — kod değişikliği gerekmez (şema varsayılanı yeterli), ama
    satır 62'deki yorum güncellenir.
12. Unit test (zorunlu kapsam): §5.3'ün her satırı için izinli/reddedilen rol; CUSTOMER ve
    USER'ın `/admin/*` örneklerinde 403 alması; `/admin/settings/security/*`'ın 5 rol için
    de 200 dönmesi; MANAGER'ın blok yapısı değiştirmeye çalışınca 403 alması (PATCH **ve**
    autosave); MANAGER'ın `data.text` değiştirince 200 alması; EDITOR'ün `POST /admin/pages`
    ve `DELETE /admin/pages/{id}`'de 403 alması; MANAGER'ın `POST /admin/pages`'te 403
    alması (§6.1); son ADMIN'i `MANAGER`'a düşürmenin 409 vermesi; ödeme sonrası
    `USER → CUSTOMER` terfisi ve `EDITOR`'ün terfi ETMEMESİ.
13. **YAPMA:** şema tasarımı (§10.1'i tüket), görsel karar, ödeme sağlayıcı entegrasyonunun
    kendisi (§7.2'deki terfi kancası integration-agent ile koordine edilir — Stripe webhook
    işleyicisi integration-agent'ın alanıdır, rol terfisi mantığı backend-agent'ın).

### 10.3 security-agent
1. **§4.4 zorlama testi** — bu görevin 1 numaralı denetimi. Route tablosu üzerinden her
   `/admin/*` ucunun panel guard'ı taşıdığını KANITLA.
2. `/admin/settings/security/*` istisnasının gerçekten self-servis olduğunu (başka bir
   kullanıcının 2FA'sına/oturumuna dokunamadığını) doğrula.
3. Dikey ayrıcalık yükseltmesi taraması: MANAGER'ın `/admin/users`, `/admin/settings`,
   `/admin/import`, `api-keys`, `webhooks`, `custom-code/js`, `logs`, `modules PATCH`,
   `/admin/health` uçlarının HİÇBİRİNE (GET dahil) erişemediğini doğrula.
4. `GET /users/me/orders`'ın **yalnızca** `siteUserId = me` döndürdüğünü, `orderId` tahminiyle
   başkasının siparişine erişilemediğini (IDOR) doğrula.
5. `USER → CUSTOMER` terfi yolunun yalnızca doğrulanmış Stripe olayından tetiklendiğini,
   istemciden tetiklenemediğini doğrula.
6. Migration'ın hiçbir hesabı yükseltmediğini doğrula (§2.2/§2.3).
7. Rol reddi audit kayıtlarının PII sızdırmadığını doğrula.

### 10.4 frontend-agent
1. `lib/api/types.ts`: `SiteRole` union 5 değere; `AdminUser.advancedBuilderEnabled` ve
   `UpdateAdminUserBuilderAccessRequest` **silinir**; `Order`/`MyOrder` tipleri.
   Kaynak: `openapi.yaml` (kontrat kazanır).
2. `lib/role-badge.ts`: §1.2 etiketleri (ui-designer onayından sonra).
3. `sidebar.tsx`: §8.2 tablosu.
4. EDITOR açılış yönlendirmesi + `notification-center` kısıtı (§8.4).
5. `/admin/users`: 5 rollü dropdown, yetenek anahtarının kaldırılması (§8.1).
6. `/hesabim` ve `/siparislerim` rotaları (§8.3) + `usersApi.getMyOrders()`.
7. Sayfa düzenleyicide **yeni koşul EKLEME** — `simpleMode` zaten doğru sonucu veriyor (§6.3).
8. `VIEWER` geçen tüm dosyalar (doğrulanmış liste): `app/admin/account/page.tsx`,
   `app/admin/blog/{page,new/page,[postId]/page}.tsx`, `app/admin/settings/page.tsx`,
   `app/admin/users/page.tsx`, `components/admin/blog/{category-select,tag-select}.tsx`,
   `components/admin/notification-center.tsx`, `components/admin/reports/create-export-dialog.tsx`,
   `components/admin/stats/users-stats-panel.tsx`, `components/admin/users/new-user-dialog.tsx`,
   `lib/api/appearance.ts`, `lib/api/types.ts`.
9. **YAPMA:** görsel/stil kararı (ui-designer bekle), meta tag/SEO (seo-agent'ın).

### 10.5 qa-agent (e2e — kritik akış)
1. CUSTOMER ve USER hesaplarıyla `/admin` → **403/yetkisiz ekranı** (UI'da bağlantı
   olmaması KANIT DEĞİLDİR; doğrudan API isteğiyle test edilir).
2. EDITOR: blog oluştur + yayınla → başarı; `/admin/settings`, `/admin/users`,
   `/admin/products`, `/admin/stats/views` → 403.
3. EDITOR: sayfada metin düzenle → 200; konteyner ekle (doğrudan API) → 403;
   **autosave üzerinden yapısal değişiklik → 403** (zorunlu senaryo, §10.20 mirası).
4. MANAGER: `/admin/settings` → 403; `/admin/orders` → 200; sayfada konteyner ekleme → 403;
   sayfa çöpe atma → 204; `POST /admin/pages` → 403.
5. ADMIN: hepsinde serbest; Page Builder tam açık.
6. Her rol için `/admin/settings/security/2fa` erişilebilir (§4.3).
7. Ödeme akışı: giriş yapmış `USER` sipariş verir → ödeme sonrası rolü `CUSTOMER` olur,
   `/siparislerim` siparişi listeler.
8. Migration sonrası: eski `VIEWER` hesabı panele giremez.

### 10.6 documentation-agent
`ARCHITECTURE.md` §5/§6/§8 ve yeni §10.21 (bu turda architect tarafından yazıldı —
documentation-agent yalnızca implementasyon bittikten sonra detaylandırır) + CHANGELOG
**BREAKING** bölümü (§2.2/§2.3 yetki daralmaları, `builder-access` ucunun kaldırılması).

---

## 11. Önceki karar dokümanına (`architect-scope-page-editor-roles.md`) yapılan REVİZYONLAR

| Eski karar | Durum |
|---|---|
| §1.1 `User.advancedBuilderEnabled` kolonu | **YÜRÜRLÜKTEN KALDIRILDI** (§3) |
| §1.1 `canUseAdvancedBuilder = role==="ADMIN" \|\| flag` | **REVİZE:** `role === "ADMIN"` |
| §1.2 etiket tablosu (Yazar/İzleyici…) | **REVİZE:** §1.2 (bu doküman) |
| §1.3 "yeni `SiteRole` değeri EKLENMEZ" | **BAĞLAMSAL:** o gerekçe *gövde-içi alan kısıtı* içindi ve hâlâ geçerli; *uç erişimi* ekseninde enum genişletildi (§1.1) |
| §1.6 `VIEWER + flag` durumu | **KONUSUZ** (her iki taraf da kaldırıldı) |
| §1.7 "tek yetenek bayrağı, ikincisi architect'e eskale" | **GEÇERLİ** (bayrak sayısı artık sıfır; kural aynen sürer) |
| §2 `PageEditMode` / `Page.editMode` | **DEĞİŞMEDİ** — kozmetik rozet olarak kalır, hiçbir yetki kararını etkilemez |
| §3 `TEMPLATE_EDITABLE_FIELDS` haritası + fail-closed | **DEĞİŞMEDİ, TAMAMEN GEÇERLİ** |
| §3.4 `assertTemplateEditAllowed` (iteratif diff, 403) | **DEĞİŞMEDİ, TAMAMEN GEÇERLİ** — artık MANAGER ve EDITOR için çalışır |
| §3.5 çağrı yerleri (PATCH + autosave) | **DEĞİŞMEDİ** |
| §4.1 `requireAdvancedBuilder()` middleware | **KALDIRILDI** → rol listeleri (§6.2) |
| §4.3 `PATCH /admin/users/{id}/builder-access` | **KALDIRILDI** (§3.1) |

---

## 12. Bilinçli olarak KAPSAM DIŞI

| Konu | Neden | Takip branşı |
|---|---|---|
| Genel `Permission`/`UserPermission` tablosu | 5 rol bugünkü ihtiyacı karşılıyor; spekülatif | — |
| Rol bazlı içerik sahipliği ("sadece kendi yazısını düzenler") | Farklı bir eksen (sahiplik ≠ rol); istenmedi | `feature/content-ownership` |
| MANAGER'a şablondan sayfa klonlama | §6.1 — böyle bir uç bugün yok | `feature/page-duplicate-from-template` |
| Geçmiş misafir siparişlerini hesaba bağlama | §7.3 — e-posta doğrulama akışı gerektirir | `feature/order-account-linking` |
| `/admin/settings/security/*` rotalarının taşınması | §4.3 — BREAKING kontrat değişikliği | `chore/relocate-self-service-security-routes` |
| Editoryal onay/moderasyon akışı (EDITOR'ün yayını onaya düşsün) | İstenmedi; iş gereksinimi EDITOR'e doğrudan yayın hakkı veriyor | — |
| Organizasyon bazlı `MembershipRole` ekseni | Tamamen ayrı bir eksen; bu iş onu HİÇ etkilemez | — |
| CUSTOMER'a özel ön yüz özellikleri (adres defteri, favoriler) | İstenmedi | — |

---

## 13. Definition of Done (bu görev için ek maddeler)

- [ ] §4.4 route-tablosu zorlama testi mevcut ve geçiyor (security-agent onayı).
- [ ] `VIEWER` string'i backend ve frontend kaynak ağacında **sıfır kez** geçiyor
      (migration SQL'i hariç).
- [ ] `advancedBuilderEnabled` backend, frontend ve `openapi.yaml`'da **sıfır kez** geçiyor.
- [ ] `openapi.yaml`'daki her `enum: [...]` rol listesi 5 değeri içeriyor; YAML geçerli ve
      tüm `$ref`'ler çözümleniyor.
- [ ] `frontend/src/lib/api/types.ts` ile `openapi.yaml` arasında `SiteRole`/`User`/
      `AdminUser` için sıfır drift.
- [ ] `lib/permissions-matrix.ts` ile §5.3 tablosu arasında sıfır fark.
- [ ] Migration izole bir dosyada ve down-migration yazılmış.
- [ ] Deploy notunda etkilenen `VIEWER` ve `EDITOR` hesaplarının listesi var (§2.2/§2.3).
- [ ] CHANGELOG'da **BREAKING** bölümü mevcut (documentation-agent).
