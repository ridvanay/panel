# Paket AA-ek: Var olan kullanıcıya tercümanlık yetkisi — RAPOR (2026-10-30)

- **Dal:** `fix/interpreter-existing-users-oct30`. `origin/master` (`9807bfd`) üzerinden, ayrı bir worktree'de açıldı. **Push edilmedi.**
- **Ek karar (kullanıcı):** 2FA zorunlu değil. Bunun için admin ayarı `interpreterRequire2fa` eklendi; varsayılanı **kapalı**.
- **Migration:** yok. Ayar mevcut `SiteModule(telehealth).settings` JSON'unda tutuluyor.

## 1. Commit listesi

| Commit | Açıklama |
|---|---|
| `ae6527f` | fix(telehealth): tercümanlık rol değil yetki; var olan kullanıcıya tercümanlık (Paket AA-ek) |
| (bu rapor) | docs(prompts): Paket AA-ek raporu |

## 2. Değişen yetki kontrolleri

Kişinin tercüman sayılması için gereken koşullar artık rolden bağımsız:
- `InterpreterProfile.isActive = true`
- güncel gizlilik onayı
- hesabın `ACTIVE` olması
- ayar açıksa 2FA

| Yer | Önce | Sonra |
|---|---|---|
| `/interpreter/*` (panel, onay, atamalar, token, ayrılış, kayıt durumu) | `requireSiteRole("INTERPRETER")` | Rol kontrolü yok. Kullanıcının **kendi** profili olmalı ve hesabı `ACTIVE` olmalı. Pasif profil yalnızca `INTERPRETER` rollü (sadece tercüman) hesapta "pasif" uyarısı için okunur; diğer rollerde 403. |
| `POST /interpreter/assignments/:id/meeting-token` | 2FA her zaman zorunlu | 2FA yalnızca `interpreterRequire2fa=true` iken zorunlu. Taahhüt, aktif profil, aktif atama ve katılım penceresi aynı kaldı. **Yeni:** çıkar çatışması kontrolü (403). Her rolde her zaman tercüman token'ı üretilir (`interpreter:<profil>:<booking>`); dinleyici veya doktor yetkisi kullanılmaz. |
| `GET /interpreter/access` (yeni) | — | Her oturumlu kullanıcı yalnızca kendi `hasProfile` bayrağını görür. Hesap menüsündeki "Tercüman paneli" bağlantısı bunu kullanır. |
| `findAssignableInterpreters` (atama adayları) | `user.role = INTERPRETER` | Rol filtresi kaldırıldı; `user.status = ACTIVE`. Booking'in hasta ve doktor tarafı listeden çıkarılır (çıkar çatışması). |
| `POST /admin/.../bookings/:id/interpreter` (atama) | — | Çıkar çatışmasında 422 "çıkar çatışması". Audit'e `selfAssigned` bayrağı yazılır. |
| `interpreter-sweeper` (temizleyici) | Profil aktif **ve** rol `INTERPRETER` | Profil aktif, hesap `ACTIVE` ve **çıkar çatışması yok**. Atamadan sonra doğan çatışmada tercüman odadan çıkarılır. |
| `POST /admin/telehealth/interpreters` (yeni hesap) | Kayıtlı e-postada 409 "zaten kayıtlı" | 409, mesaj "Bu e-posta kayıtlı. Var olan kullanıcıdan ekle sekmesinden tercümanlık verebilirsiniz." ve `details.email = EMAIL_REGISTERED_USE_EXISTING`. Ön yüz bu durumda sekmeye yönlendirir. |
| `GET /admin/.../interpreters/user-search` (yeni) | — | Yalnızca ADMIN. Arama terimi en az 3 karakter, 20 istek/dk, en çok 20 sonuç. Dönen alanlar: ad, e-posta, rol, doktor mu, profil var mı. Audit'e yalnızca terimin uzunluğu ve sonuç sayısı yazılır (terim yazılmaz). |
| `POST /admin/.../interpreters/from-user` (yeni) | — | Yalnızca ADMIN. Kullanıcının **rolü değişmez**. Profil zaten varsa yenisi açılmaz; mevcut profil `200 existing:true` ile döner. Audit `interpreter.profile_created_for_existing_user`: kullanıcı ID'si, rol ve diller; e-posta yok. Kişiye 9 dilde "Tercümanlık yetkisi verildi" e-postası gider. |
| `PATCH /admin/.../interpreters/:id` (`isActive=false`, yani "Tercümanlığı kapat") | Yalnızca pasif yapıyordu | Ek olarak: bitmemiş görüşmelerdeki aktif atamalar `CANCELLED` olur. `JOINED` olan tercüman **hemen** odadan çıkarılır; başarısız olursa temizleyici yakalar. Rol ve hesap değişmez. Audit: `interpreter.deactivated`. |
| `GET/PUT /admin/.../interpreters/settings` (yeni) | — | Okuma ADMIN/MANAGER, yazma ADMIN. Ayar `require2fa` (varsayılan false); her değişiklik audit'e `interpreter.settings_updated` olarak yazılır. |
| Ön yüz tercüman paneli | `role === "INTERPRETER"` değilse 403 | Erişim API yanıtına göre belirlenir; profil yoksa "Bu hesapta tercümanlık yetkisi yok" mesajı çıkar (9 dil). 2FA adımı yalnızca ayar açıksa gösterilir. |
| Hesap menüsü (masaüstü + mobil) | — | Profili olan kullanıcılarda "Tercüman paneli" bağlantısı (9 dil). Hasta portalı, admin ve doktor paneli değişmedi. |

**Çıkar çatışması kuralı** (atama, aday listesi, token ve temizleyicide aynı fonksiyon): Kişi şu durumlarda bir booking'e tercüman olamaz:
- booking'in hasta kullanıcısıysa,
- booking'deki herhangi bir randevunun hasta kullanıcısıysa,
- doktorun kullanıcı hesabıysa,
- misafir randevuda hasta e-postası, kişinin hesap e-postasıyla eşleşiyorsa (büyük/küçük harf duyarsız).

## 3. Güvenlik incelemesi (security-agent) ve yapılanlar

| Bulgu | Önem | Durum |
|---|---|---|
| Çıkar çatışması yalnızca booking düzeyindeydi; randevu düzeyindeki hasta ve misafir e-postası kontrol edilmiyordu | Yüksek | ✅ Kapsam genişletildi; testi eklendi. |
| Atamadan sonra doğan çatışmada tercüman odada kalıyordu | Yüksek | ✅ Temizleyiciye çatışma kontrolü eklendi; testi eklendi. |
| 2FA varsayılan kapalı ve ayrıcalıklı hesaplar (admin, doktor) için de geçerli | Orta | ⚠️ **Bilinçli kabul.** Kullanıcı 2FA'nın zorunlu olmamasını istedi. Ayar kapalıyken admin ekranında risk uyarısı gösteriliyor. Öneri: canlıda ayarı açık tutmak. |
| `user-search` ile kullanıcı numaralandırma | Orta | ✅ En az 3 karakter, 20/dk, audit (terim yazılmadan). E-posta maskelenmedi: yalnızca ADMIN kullanabiliyor ve ADMIN `/admin/users` ekranında e-postaları zaten görüyor. |
| Tercümanlık kapatılınca odadan çıkarma temizleyiciye (30 sn) kalıyordu | Orta | ✅ `JOINED` tercüman hemen çıkarılıyor. |
| Hesap askıya alınınca canlı odadan çıkarma | Orta | ⏭️ Kullanıcı yönetimi koduna dokunulmadı. Temizleyici askıdaki hesabı 30 sn içinde çıkarıyor (Paket AA davranışı). |
| ADMIN'in kendini ataması izlenmeli | Düşük | ✅ Audit'te `selfAssigned`. |
| SMTP hatası loguna alıcı adresi düşebilir | Düşük | ✅ Yalnızca hata mesajı loglanıyor. |
| Rol/yetki karışması, IDOR, yetki yükseltme | — | Bulgu yok. Sorgular `interpreterId = kendi profili` ile sınırlı; başkasının atamasında 404. |

## 4. Kırmızı çizgi kontrolü

`git diff --stat origin/master` çıktısı şu dosyalar için **boş**:
- `consultation-room.tsx`, `livekit.ts`, egress, billing, checkout
- `package.json`, docker-compose, Dockerfile'lar
- `backend/prisma`, `.env`, `docs/legal`

## 5. Testler (sıralı, `--no-file-parallelism`)

**Backend**
- `telehealth-interpreter.test.ts`: **19/19**. Paket AA'nın 13 testi de geçiyor; 2FA testi yeni varsayılana göre güncellendi (ayar açıkken 403, kapalıyken 200). Yeni testler:
  - USER (hasta), ADMIN ve doktor kullanıcıya profil verilmesi: rol değişmiyor, eski yetkiler aynı, e-posta ve audit doğru (e-posta adresi yok), ikinci istekte mevcut profil dönüyor, `/access` bayrağı doğru.
  - ADMIN tercüman: token yalnızca kendi atandığı görüşme için ve tercüman kimliğiyle alınıyor; başkasının atamasında 404; panelde yalnızca tercümanlık atamaları.
  - Taahhüt yokken 403; 2FA yalnızca ayar açıkken zorunlu; ayarı MANAGER değiştiremiyor.
  - Çıkar çatışması: kendi hasta ya da doktor randevusuna atanamıyor ve aday listesinde görünmüyor. Misafir e-postası eşleşmesi de engelleniyor. Atamadan sonra doğan çatışmada token reddediliyor ve temizleyici çıkarıyor.
  - Tercümanlığı kapatma: gelecek atama `CANCELLED`, geçmiş atama değişmiyor, rol ve hesap aynı, panel erişimi kapanıyor.
  - Kayıtlı e-posta: 409 + yönlendirme mesajı + kod. Arama rolü gösteriyor. MANAGER arama yapamıyor ve yetki veremiyor.
- **Regresyon** — 127/127 + 32/32. Kapsanan dosyalar: `telehealth-qa-listener`, `qa-listener-sweeper`, `telehealth-livekit`, `admin-panel-guard-route-table`, `telehealth-bookings`, `admin-users`, `admin-users-regression-matrix`, `crm-collect`, `telehealth-availability`.
  - `telehealth-livekit` bir toplu koşuda bir kez düştü; tek başına 18/18, sonraki toplu koşuda da geçti. Sıralama ya da zamanlama kaynaklı; bu değişiklikle ilgisi yok.
- tsc ve eslint temiz.

**Frontend**
- Yeni `admin-interpreters-existing-user.test.tsx` (3): kayıtlı e-postada yönlendirme ve sekmenin e-postayla açılması; aramada mevcut rol; onay penceresi metni; "Tercümanlığı kapat" onayı; 2FA ayarı varsayılan kapalı ve risk uyarısı.
- `interpreter-panel-room.test.tsx` güncellendi (+2): 2FA zorunlu değilken doğrudan atamalar görünüyor; ADMIN rolünde profil varsa panel açılıyor, profil yoksa "yetki yok" mesajı çıkıyor.
- **Tam birim koşusu:** 1387/1389. Düşen 2 test `edit-blog-post-page`'de; temiz master'da da aynı şekilde düşüyor, bu işle ilgisi yok.
- 9 dil sözlük eşitliği: yeni anahtarlar `nav.interpreterPanel` ve `portal.interpreter.noAccess` 9 dilde eklendi; parite testleri tam koşu içinde geçti.
- tsc ve eslint temiz.

**Yerel Docker:** Docker ana çalışma dizininden (W dalı) çalıştığı için bu worktree'deki değişiklikler yerel konteynerlere yüklenmedi. Birleştirme sonrasında `docker compose up --build -d` gerekli.

## 6. Canlıya alma sırası

1. **Yedek:** PostgreSQL tam yedeği (tedbir; migration yok).
2. **Migrate:** gerekmiyor (şema değişmedi).
3. **Backend:** `docker compose up -d --build --no-deps backend`
4. **Frontend:** `docker compose up -d --build --no-deps frontend`
5. **Kontrol:**
   - Admin → Tele-Sağlık → Tercümanlar → "Ayarlar": 2FA zorunluluğu varsayılan **kapalı**. Kurum politikasına göre açılabilir; açık tutulması önerilir.
   - "Tercüman ekle" → "Var olan kullanıcıdan ekle" ile test için bir personele yetki verin. Kişinin rolünün değişmediğini ve "Tercümanlık yetkisi verildi" e-postasının geldiğini kontrol edin.
   - Kişi giriş yapınca hesap menüsünde "Tercüman paneli" görünmeli; taahhüdü onaylamalı.
   - Test booking'ine atayın ve katılımı doğrulayın. Kendi hasta ya da doktor olduğu bir booking'e atamanın reddedildiğini görün.
   - "Tercümanlığı kapat" ile atamaların iptal edildiğini ve rolün aynı kaldığını kontrol edin.

LiveKit konteyneri yeniden başlatılmaz.
