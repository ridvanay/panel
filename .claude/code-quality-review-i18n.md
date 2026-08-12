# Code Quality Review — Çok Dillilik (i18n)

> **Denetçi:** code-quality-agent
> **Kapsam:** `.claude/architect-scope-i18n.md` zincirinin son adayı — henüz commit edilmemiş
> çalışma ağacı (`git status`/`git diff`), backend `localization` modülü, frontend `[lang]`
> rota ağacı, yeni Playwright altyapısı.
> **Sonuç:** **Lint/typecheck/test PR kapsamında temiz. Kodda mimari/mantık düzeltmesi
> yapılmadı** (görev tanımına uygun, yalnızca denetlendi). **Documentation-agent ve
> devops-agent'ın işleri henüz yapılmamış** — bunlar bu raporun ana blokeri.

---

## 1. Lint

### Backend (`npm run lint` → `eslint .`)
**Bu PR kapsamında (i18n diff'i) TEMİZ.** Genel taramada 2 hata + 3 uyarı bulundu, ama
hepsi bu diff'in **dışındaki**, önceden var olan dosyalarda (doğrulandı: `git diff --stat`
bu dosyalarda hiç değişiklik göstermiyor):
- `backend/tests/unit/reports-format.test.ts:17,30` — `no-irregular-whitespace` (2 hata)
- `backend/src/config/env.ts:117`, `backend/src/lib/keys.ts:25` — kullanılmayan
  `eslint-disable` yorumu (2 uyarı, auto-fixable)
- `backend/tests/integration/import.test.ts:477` — `no-explicit-any` (1 uyarı)

Bu dosyalar i18n işinin parçası olmadığı için **düzeltmedim** (scope creep'ten kaçınmak
için) — pre-existing teknik borç olarak not düşülüyor, ayrı bir chore görevi önerilir.

### Frontend (`npm run lint` → `eslint`)
**Tamamen temiz** — 0 hata, 0 uyarı (tüm proje, i18n dahil).

## 2. Typecheck

### Backend (`npm run typecheck` → `tsc -p tsconfig.test.json --noEmit`)
**i18n dosyalarında hata YOK.** Ancak genel komut şu an **kırmızı**:
`backend/tests/integration/navigation.test.ts` içinde 18 adet `TS2322`/`TS2339` hatası
(fastify `light-my-request`/`InjectPayload` tip uyuşmazlığı). Bu dosya bu PR'ın **hiç
dokunmadığı** bir dosya (`git diff --stat` boş) — commit `9a47f08` (navigation
self-relation özelliği, ayrı bir iş) ile önceden gelmiş bir tip regresyonu. **i18n PR'ının
sorumluluğunda değil**, ama `npm run typecheck`'in projede şu an genel olarak yeşil
olmadığını (CI'da typecheck adımı varsa muhtemelen zaten kırmızı) architect'e/backend-agent'a
ayrıca bildirilmeli.

### Frontend (`npm run typecheck` → `tsc --noEmit`)
**Tamamen temiz.**

## 3. Test suite bütünlüğü

| Proje | Komut | Sonuç |
|---|---|---|
| Backend | `npm test` (vitest) | **58 dosya / 517 test — hepsi geçti.** Rapor edilen sayı doğrulandı. |
| Frontend | `npx vitest run` | **70 dosya / 357 test — hepsi geçti.** Rapor edilen sayı doğrulandı. |

`localization.test.ts` içinde security-agent'ın bulduğu yetki-bypass bulgusuna (revizyon
geri yükleme → `isLegalDocument`) karşı **regresyon testi mevcut ve geçiyor**
(`backend/tests/integration/localization.test.ts:404` — EDITOR alanı atlanır/mevcut değer
korunur + audit; ADMIN uygular + `content.legal_flag_change` audit'i). Kod tarafında da
(`backend/src/modules/pages/pages.routes.ts:558-645`) düzeltmenin security-agent'ın önerdiği
2. seçenekle (mevcut değerden farklıysa yetki kontrolü + audit) birebir uygulandığı
doğrulandı — **bu bulgu kapalı.**

## 4. Yeni bağımlılık politikası

`frontend/package.json` diff'i incelendi — 2 yeni **devDependency** eklenmiş:

| Paket | Sürüm | Lisans | Bakım | Değerlendirme |
|---|---|---|---|---|
| `@playwright/test` | `^1.62.1` | Apache-2.0 | Microsoft, çok aktif | Uygun. Yalnızca `devDependencies` — prod bundle'a girmiyor, bloat riski yok. |
| `cross-env` | `^10.1.0` | MIT | Olgun/stabil, geniş kullanım | Uygun. `playwright.config.ts`'teki `webServer.command`'da Windows/Unix ortam değişkeni uyumluluğu için kullanılıyor (`NEXT_PUBLIC_API_URL=... next dev`) — gerekçeli, gereksiz değil. |

Her ikisi de MIT/Apache ailesinde, copyleft (GPL) yok. **Onaylandı.**

`package-lock.json` güncel: `@playwright/test@1.62.1`, `playwright`/`playwright-core@1.62.1`,
`cross-env@10.1.0` ve transitive `@epic-web/invariant@1.0.0`/`fsevents@2.3.2` (opsiyonel,
macOS-only) girişleri mevcut; `node_modules` içinde kurulu sürümler lockfile ile birebir
eşleşiyor (`1.62.1` / `10.1.0`) — **senkron, sorun yok.**

`backend/.env.e2e` yeni bir tracked dosya (test-only sabitler, gerçek sır yok — `sk_test_e2e`,
boş JWT anahtarları, sabit test `ENCRYPTION_KEY`). Bir `.env` dosyasının repoya commit
edilmesi genel bir alışkanlık olarak dikkat gerektirir; **security-agent zaten bunu
inceleyip "yeni secret/API key eklenmedi, ilgisiz" olarak işaretlemiş** — code-quality
tarafında ek bir aksiyon önerilmiyor, sadece PR reviewer'ın bu dosyanın içeriğini
onaylarken görmesi için not düşülüyor.

## 5. PR Checklist (CLAUDE.md "Definition of Done")

| Kriter | Durum | Not |
|---|---|---|
| API kontratına uygunluk | **Geçti** | `openapi.yaml`'daki `/locales`, `/admin/locales`, `LocaleQuery`, `isLegalDocument` tanımları koddaki (`localization.routes.ts`, `pages.routes.ts` vb.) implementasyonla örneklenerek karşılaştırıldı, tutarlı. |
| Unit/entegrasyon test kapsamı | **Geçti** | 517 backend + 357 frontend test yeşil; `localization.test.ts` yetki-bypass regresyonu dahil. |
| Lint/format | **Geçti (i18n kapsamında)** | Bkz. §1 — pre-existing/kapsam dışı 2 hata + 3 uyarı ayrı not edildi. **Format-check script'i projede hiç yok** (Prettier/Husky kurulu değil) — bu i18n'e özgü değil, projenin genel bir eksiği; code-quality-agent'ın kendi kurulum görevi (CLAUDE.md madde 1) olarak ayrıca ele alınmalı. |
| Güvenlik denetimi | **Geçti** | `.claude/security-review-i18n.md` — tek orta/yüksek bulgu (yetki bypass) backend-agent tarafından düzeltilmiş ve doğrulandı (§bkz. yukarı). Düşük öncelikli `LocaleQuerySchema.locale` max-length önerisi hâlâ açık ama **engelleyici değil**. |
| KVKK/GDPR etkisi | **Geçti (mimari eskalasyonlarla)** | `.claude/compliance-notes-i18n.md` — PII yok onaylandı. Ancak compliance-agent'ın **architect'e eskale ettiği** 2 açık madde var: (a) `Page` "hukuki belge" işaretleme mekanizması mimari §2.3 ile çelişiyordu — **bu iş kapsamında zaten çözülmüş görünüyor** (`isLegalDocument` alanı şemada var, migration `20260812061128_add_page_is_legal_document` mevcut), (b) `SiteSettings.cookieBannerText/PolicyHref`'in çok dilli olup olmayacağı ve cookie banner'ın public sitede hiç render edilmediği — **bunlar hâlâ açık, architect'in karara bağlaması gerekiyor** (i18n işinin bloklayıcısı değil, ayrı takip). |
| E2E test | **Geçti** | `.claude`/`TEST_COVERAGE.md` — Playwright ile 13 mimari maddeden 21/22 senaryo yeşil (1 tanesi Windows-yerel ortam sorunu, API ile ayrıca doğrulanmış). **Düzeltme notu (bu denetim raporundan SONRA doğrulandı):** qa-agent'ın bulduğu 2 bug — (1) client-side dil değişiminde `<html lang>` güncellenmiyor, (2) `/en/<tr-slug>` → kendi EN slug'ına 301 eksik — frontend-agent tarafından **düzeltildi ve doğrulandı**: `frontend/src/components/html-lang-sync.tsx` ve `frontend/src/lib/i18n/canonical-slug.ts` çalışma ağacında mevcut, `routing-locale.spec.ts`'teki `test.fail()` işaretleri kaldırıldı (8/8 geçiyor). Bu denetimin orijinal çalıştırılması muhtemelen frontend-agent'ın düzeltmesinden ÖNCEki bir dosya durumuna/transkripte dayandı — orkestratör tarafından `ls`/`grep` ile doğrudan dosya sisteminden yeniden doğrulandı. |
| Dokümantasyon | **EKSİK — açık madde** | Bkz. §6 aşağıda. |
| CI pipeline | **EKSİK — açık madde** | Bkz. §6 aşağıda. |

## 6. Eksik/devam eden maddeler (net liste)

### documentation-agent (henüz yapılmamış)
- **`docs/architecture/ARCHITECTURE.md` §10.5 "Çoklu Dil & Yerelleştirme (i18n)"
  (satır 578-604) hâlâ ESKİ/plan aşaması içeriğini taşıyor** — tek `translations Json`
  alanı, `Locale`/`ContentSlug` tablosu yok, `isLegalDocument` yok, `[lang]` route ağacı yok.
  Gerçek implementasyon bunun çok ötesine geçti (ayrı `Locale` modeli, `ContentSlug`
  polimorfik tablo, `isLegalDocument` alanı + yetki kuralı, `frontend/src/app/[lang]/`,
  `language-switcher.tsx`, hreflang/sitemap entegrasyonu). `git status` bu dosyayı
  **modified olarak göstermiyor** — yani bu iş boyunca hiç güncellenmemiş. Bu, Definition of
  Done'daki "Dokümantasyon güncellenmiş" kriterinin karşılanmadığı anlamına geliyor.
- **`CHANGELOG.md`'de i18n girdisi yok** (dosyada "i18n"/"Locale"/"Yerelleştirme"/"locale"
  arandı, 0 eşleşme; `git status` dosyayı modified göstermiyor). `[Unreleased]` bölümünde
  medya/appearance girdileri var ama i18n eklenmemiş.
- Bu ikisi **architect'in notuna göre zaten documentation-agent'a devredilecekti** — teyit
  edildi, henüz devreye girmemiş.

### devops-agent (henüz yapılmamış)
- `.github/workflows/ci.yml` içinde `playwright`/`test:e2e`/`e2e` geçen **hiçbir satır yok**
  — yeni Playwright paketi CI'a hiç bağlanmamış.
- `TEST_COVERAGE.md` "CI entegrasyonu" bölümünde qa-agent'ın bıraktığı not: backend'in
  `ci.yml`'deki mevcut `saas_test`/Postgres servis deseninin kopyalanıp `saas_e2e` +
  `backend/.env.e2e` ile ayrı portta (4001) başlatılması, test adımının **lint/build'den
  SONRA, deploy'dan ÖNCE** koşması gerekiyor. Bu, CLAUDE.md kural #4'teki ("CI pipeline'ında
  lint + format-check adımının PR'ı bloklayacak şekilde zorunlu olması") ötesinde ayrıca bir
  e2e adımı — devops-agent'a devredilmesi gereken açık bir görev.

### frontend-agent (qa-agent tarafından bulundu, henüz düzeltilmedi)
- `<html lang>` client-side dil değiştiricide güncellenmiyor (a11y/SEO).
- `/en/<tr-kanonik-slug>` → kendi EN slug'ına 301 yönlendirmesi eksik (§12.2).
- Bunlar code-quality-agent'ın düzeltme yetkisinde değil (mantık değişikliği), yalnızca
  PR checklist'te "eksik" olarak işaretleniyor ve frontend-agent'a devrediliyor.

### architect (compliance-agent'ın eskale ettiği, hâlâ açık olabilecek)
- `SiteSettings.cookieBannerText/PolicyHref` çok dilli mi olacak — açık karar bekliyor.
- Cookie banner'ın public sitede hiç render edilmediği (i18n'den bağımsız, önceden var
  olan boşluk) — ayrı görev olarak ele alınmalı.

### code-quality-agent'ın kendi altyapı borcu (bu PR'a özgü değil, genel proje)
- Projede **Prettier/format:check script'i ve Husky/lint-staged pre-commit hook'u yok**
  (CLAUDE.md madde 1'in gerektirdiği kurulum henüz yapılmamış — bu PR'ın konusu değil,
  ayrı bir chore olarak planlanmalı).
- **`TECH_DEBT.md` dosyası yok** — proje genelinde TODO/FIXME izleme mekanizması eksik
  (i18n'in yeni dosyalarında TODO/FIXME taraması yapıldı, **temiz** — sorun bu PR'da değil,
  altyapının kendisinde).
- `backend/tests/unit/reports-format.test.ts`, `backend/src/config/env.ts`,
  `backend/src/lib/keys.ts`, `backend/tests/integration/import.test.ts` — pre-existing
  lint sorunları (bkz. §1), ayrı bir "chore: lint temizliği" PR'ı önerilir.
- `backend/tests/integration/navigation.test.ts` — pre-existing typecheck kırığı (bkz. §2),
  backend-agent'a/architect'e bildirilmeli.

## 7. Genel kod kalitesi taraması (i18n dosyaları)

- **Ölü kod / kullanılmayan import:** Bulunamadı — ESLint (`no-unused-vars` dahil) ve
  `tsc --noEmit` her iki projede de i18n dosyalarında temiz. Eski `frontend/src/lib/i18n/
  dictionaries.ts` silinip `dictionaries/` (namespace başına dosya) ile değiştirilmiş;
  kalan `@/lib/i18n/dictionaries` import'ları yeni `dictionaries/index.ts`'e doğru
  çözümleniyor (dangling import yok, typecheck ile doğrulandı).
- **`console.log`/`debugger`:** Yeni i18n dosyalarında (`backend/src/lib/localization.ts`,
  `backend/src/modules/localization/`, `frontend/src/lib/i18n/`, `frontend/src/app/[lang]/`,
  yeni locale bileşenleri) taranan, bulunamadı.
- **İsimlendirme tutarlılığı:** Yeni React bileşen dosyaları mevcut proje konvansiyonuyla
  (kebab-case dosya adı, `PascalCase` export) tutarlı (`locale-tabs.tsx` → `LocaleTabs`, vb.
  mevcut `blog-card.tsx`/`site-footer.tsx` paternini izliyor). Backend'de `locale`/`Locale`
  terimi tutarlı kullanılmış, İngilizce kod + Türkçe kullanıcı metni/dokümantasyon kuralına
  uyulmuş.
- **Dosya/fonksiyon boyutu:** i18n eklemeleri sonrası `pages.routes.ts` (741 satır),
  `products.routes.ts` (864 satır), `portfolio.routes.ts` (797 satır), `blog.routes.ts`
  (712 satır) — bu PR'la +295/+426/+304/+308 satır büyümüş, tek dosyada CRUD + revizyon +
  locale-uygulama + sanitizasyon birlikte duruyor. Bloklayıcı değil (mevcut proje paterniyle
  tutarlı — her modülün tek `*.routes.ts` dosyası var) ama **büyüme trendi not ediliyor**:
  bir sonraki i18n benzeri genişlemede bu dosyaların locale-özel mantığını (`applyLocale`
  zaten `lib/localization.ts`'e çıkarılmış, iyi) ayrı bir `*.locale.ts` dosyasına bölmek
  architect/backend-agent'a **öneri** olarak iletiliyor — mimari karar gerektirir, kendim
  refactor etmedim.
- **Şüpheli güvenlik kalıbı (`eval`, dinamik SQL concat):** Taranan i18n dosyalarında
  bulunamadı; `DELETE /admin/locales/{code}`'daki `$executeRaw` çağrıları zaten
  security-agent tarafından incelenip parametrize/güvenli bulunmuş (bkz.
  `.claude/security-review-i18n.md` §A03 Injection satırı).

---

## Özet

**Geçti:** Lint (i18n kapsamında), typecheck (i18n kapsamında), backend testleri (517/517),
frontend testleri (357/357), bağımlılık politikası (Playwright + cross-env — lisans/bakım
uygun, lockfile senkron), API kontratına uygunluk, güvenlik denetimi (yetki-bypass bulgusu
kapatıldı ve regresyon testiyle doğrulandı).

**Otomatik düzeltme yapılmadı** — i18n diff'inde düzeltilecek bir lint/format sorunu
bulunmadı; PR dışı pre-existing sorunlara (yukarıda listelenen) dokunulmadı (scope creep'ten
kaçınıldı, görev tanımına uygun).

**Kaldı / eksik (PR "bitmiş" sayılmadan önce kapatılmalı):**
1. **documentation-agent:** `docs/architecture/ARCHITECTURE.md` §10.5 güncel değil (eski
   plan içeriği duruyor); `CHANGELOG.md`'ye i18n girdisi eklenmemiş.
2. **devops-agent:** `ci.yml`'e Playwright/e2e adımı hiç eklenmemiş (`TEST_COVERAGE.md`'deki
   not bekliyor).
3. ~~**frontend-agent:** qa-agent'ın bulduğu 2 bug~~ — **DÜZELTİLDİ** (bu raporun ilk
   yazımından sonra doğrulandı, bkz. §5 tablosu E2E satırı). Kapalı madde.
4. **architect:** cookie banner çok dillilik kararı ve public'te render edilmemesi konusu
   açık (i18n'in bloklayıcısı değil, ayrı takip).
