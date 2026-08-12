# Security Review — Çok Dillilik (i18n) — OWASP/Politika Denetimi

> **Denetçi:** security-agent
> **Kapsam:** `.claude/architect-scope-i18n.md` bağlayıcı kararlarına göre, henüz commit
> edilmemiş `backend/` değişiklikleri (`git status`/`git diff` ile görüldüğü hâliyle).
> **Sonuç:** genel olarak sağlam bir implementasyon. **1 orta/yüksek öncelikli bulgu**
> (yetkilendirme/audit atlaması — revizyon geri yükleme yolu), **1 düşük öncelikli hijyen
> bulgusu** (query şeması uzunluk sınırı). Kritik (injection, auth bypass, secret sızıntısı)
> bulgu YOK.

---

## Kritik bulgular

Yok.

---

## Orta/Yüksek öncelikli bulgular

### [ORTA-YÜKSEK] `POST /admin/pages/{pageId}/revisions/{revisionId}/restore` — `isLegalDocument`
### ADMIN-only yetki kontrolünü ve `content.legal_flag_change` audit kaydını ATLIYOR

**Dosya:** `backend/src/modules/pages/pages.routes.ts` (revizyon geri yükleme route'u, ~satır
520-590)

**Sorun:** §5.1 ve §9 backend-agent madde 10'a göre `Page.isLegalDocument` alanını
**yalnızca ADMIN değiştirebilir** (EDITOR → `403`) ve **her değişiklik**
`content.legal_flag_change` ile denetlenir. `PATCH /admin/pages/{pageId}` ve `POST
/admin/pages` bu kuralı doğru uyguluyor (`assertLegalDocumentAuthorized` + audit — doğrulandı).

Ancak `POST /admin/pages/{pageId}/revisions/{revisionId}/restore` route'u
`requireSiteRole("ADMIN", "EDITOR")` ile korunuyor ve geri yükleme sırasında
`snapshot.isLegalDocument` değeri **doğrudan** `tx.page.update()`'e yazılıyor:

```ts
...(snapshot.isLegalDocument !== undefined ? { isLegalDocument: snapshot.isLegalDocument } : {}),
```

Bu satırdan önce ne `assertLegalDocumentAuthorized()` çağrılıyor ne de değer değiştiğinde
`content.legal_flag_change` audit kaydı üretiliyor.

**Somut senaryo:** ADMIN bir sayfayı `isLegalDocument: true` yapar (bir revizyon bu değeri
snapshot'lar) → ADMIN daha sonra `false`'a çeker → bir **EDITOR**, `isLegalDocument: true`
içeren eski revizyonu geri yükler → sayfa sessizce (403 yok, audit yok) tekrar
`isLegalDocument: true`/`false` olarak işaretlenir. Bunun hukuki etkisi somuttur: §5.1 fallback
davranışı ADMIN onayı olmadan açılıp kapanabilir, ve denetim izi (kim, ne zaman, neden
değiştirdi) bu yol için hiç oluşmaz — KVKK/GDPR uyumluluk denetiminde görünmez bir değişiklik
demektir.

**Test kapsamı:** `backend/tests/integration/localization.test.ts`'te bu senaryoyu kapsayan
bir test YOK (yalnızca `POST`/`PATCH` yolları test ediliyor, satır ~298-390).

**Önerilen düzeltme (backend-agent'a):** iki seçenekten biri:
1. Geri yüklemede `isLegalDocument` her zaman KORUNUR (mevcut değer değişmez) — snapshot'taki
   değer asla uygulanmaz. Bu, "field snapshot'ta yoksa mevcut değer korunur" davranışının
   (zaten kodda var olan `undefined` dalı) tüm durumlara genişletilmesi kadar basit bir
   değişikliktir.
2. Ya da snapshot'taki değer mevcut değerden farklıysa `assertLegalDocumentAuthorized(value,
   request.user!.role)` çağrılır (EDITOR → 403) ve değiştiğinde `content.legal_flag_change`
   audit kaydı üretilir — normal `PATCH` yoluyla birebir aynı davranış.

Mimari karar gerektirmiyor, backend-agent'ın kendi yetki alanında düzeltebileceği bir
implementasyon boşluğu. Yine de review notu olarak architect'e de iletilmeli (Definition of
Done — "güvenlik denetiminden geçmiş" kriteri bu bulgu kapatılmadan sağlanmış sayılmamalı).

---

## Düşük öncelikli bulgular

### [DÜŞÜK] `LocaleQuerySchema.locale` üst sınır (max length) yok

**Dosya:** `backend/src/schemas/common.ts`

```ts
export const LocaleQuerySchema = z.object({
  locale: z.string().min(1).optional(),
});
```

Bilinçli olarak enum/regex ile kısıtlanmaması doğru (openapi.yaml `LocaleQuery` sözleşmesi
gereği geçersiz kod `400` değil sessiz fallback üretmeli — bunu doğruladım, `lib/
localization.ts::resolveEffectiveLocaleCode` çözümlemeyi doğru yapıyor, injection riski YOK
çünkü değer yalnızca bellekte küçük bir diziyle karşılaştırılıyor ve Prisma parametreli
`findUnique`'e giriyor). Ancak projenin genel girdi doğrulama alışkanlığıyla (diğer string
alanlarda `max()` kullanımı) tutarlılık için bir üst sınır (ör. `.max(35)`, `LOCALE_CODE_PATTERN`
ile aynı büyüklük mertebesi) eklenmesi önerilir. Pratik DoS riski ihmal edilebilir düzeyde
(Node/Fastify zaten URL uzunluğunu pratik olarak sınırlıyor) — bu bir sertleştirme/hijyen
maddesidir, engelleyici değildir.

**Not (bilgi amaçlı, aksiyon gerekmiyor):** `POST /admin/locales`'te `findUnique` +ardından
`create` arasında teorik bir TOCTOU aralığı var, ama `plugins/error-handler.ts`'teki genel
Prisma `P2002` yakalayıcısı bunu zaten sızıntısız `409 CONFLICT`'e çeviriyor — gerçek bir
güvenlik açığı değil, sadece not düşüyorum.

---

## Doğrulanan ve GÜVENLİ bulunan alanlar (OWASP checklist)

| Alan | Bulgu |
|---|---|
| **A03 Injection** | `?locale=` hiçbir zaman ham SQL/jsonb path'ine enjekte edilmiyor; yalnızca bellekte küçük harf normalize edilip DB'den çekilmiş etkin dil listesiyle exact-match karşılaştırılıyor (`resolveEffectiveLocaleCode`) veya Prisma'nın parametreli `findUnique`'ine giriyor (`resolveEntityIdBySlug`). `DELETE /admin/locales/{code}` içindeki 4 `$executeRaw` çağrısı Prisma tagged-template parametrizasyonu kullanıyor (`${existing.code}::text` — `::text` cast'i yalnızca Postgres operatör overload çözümlemesi için, string concatenation YOK). Migration SQL'i (`db-agent`) yalnızca sabit literallerle çalışıyor, kullanıcı girdisi almıyor. **Injection riski yok.** |
| **A01 Broken Access Control** | `/admin/locales` yazma uçları (`POST`/`PATCH`/`DELETE`) `requireSiteRole("ADMIN")` ile doğru korunuyor; `GET` herhangi bir authenticated rolü kabul ediyor (sözleşmeyle tutarlı). `Page.isLegalDocument` yazma yolu `POST`/`PATCH /admin/pages`'te `assertLegalDocumentAuthorized` ile doğru uygulanıyor (EDITOR → 403). **Tek istisna:** revizyon geri yükleme yolu — yukarıdaki ORTA-YÜKSEK bulgu. |
| **Race condition — `isDefault` devri** | DB seviyesinde partial unique index (`locales_single_default ... WHERE "isDefault" = true`) + tek `$transaction` içinde eski varsayılanı düşürüp yeniyi yükseltme — eşzamanlı iki `PATCH` isteği DB kısıtı sayesinde iki varsayılanlı duruma düşemez. Doğrulandı. |
| **Slug hijacking / veri bütünlüğü** | `ContentSlug` yazımı `@@unique([locale, slug])` ihlalinde Postgres `P2002`'yi yakalayıp `ConflictError` (409) fırlatıyor (`upsertContentSlug`/`slugConflictError`) — sessiz üzerine yazma YOK. Bir kullanıcı başka bir içeriğin slug'ını "çalamaz"; 409 alır. |
| **A03/A07 Stored XSS** | `translations` JSON içindeki her locale'in `blocks`/`contentHtml`/`descriptionHtml` alanları, kanonik alanlarla AYNI sanitizer'lardan (`sanitizePageBlocks`, `sanitizeRichHtml`) geçiyor — hem create/update hem de revizyon geri yükleme yollarında. Yeni bir stored-XSS yüzeyi açılmamış. |
| **Fail-safe hukuki belge istisnası** | `blocks` boşaltma işlemi yalnızca **public** route handler'ında (`applyPageLocale`) yapılıyor; `/admin/pages/*` ham kaydı döndürüyor (editör akışı bozulmuyor). Frontend `LegalDocumentNotice` bileşeni yalnızca sunum katmanı — istemciye güvenilmediği doğrulandı (savunma derinliği ilkesiyle uyumlu). |
| **Rate limiting** | Yeni `/locales`, `/admin/locales` uçları global `@fastify/rate-limit` (`global: true`) kapsamında; kimlik bilgisi/brute-force riski taşımadıkları için ek route-özel limit gerektirmiyor. |
| **Audit logging** | `localization.locale_create`/`locale_update`/`locale_delete` ve `content.legal_flag_change` (create/patch yollarında) doğru şekilde `logAudit` ile yazılıyor; `requireSiteRole` zaten her yetkisiz erişim denemesini ayrıca logluyor (`FORBIDDEN` durumu, mevcut ortak middleware — pre-existing). |
| **Import sistemi** | `git diff --stat` ile doğrulandı: bu iş kapsamında `backend/src/modules/import/` altında HİÇBİR değişiklik yok — mimari kararla (§8, kapsam dışı/`feature/i18n-import`'a ertelendi) tutarlı. Yeni bir injection yüzeyi YOK çünkü dosyalara hiç dokunulmamış. |
| **Secrets/env** | Bu iş kapsamında yeni bir secret/API key eklenmedi; `.env` kullanım paterni değişmedi (kapsam dışı, kontrol edildi — ilgisiz). |
| **Güvenlik header'ları (Helmet/CORS)** | Değişmedi; yeni endpoint'ler mevcut global `helmet`/`cors` yapılandırmasını miras alıyor (`plugins/security.ts`) — ek bir aksiyon gerekmiyor. |

---

## Backend-agent'a iletilecek aksiyon maddeleri

1. **[Öncelikli]** `pages.routes.ts` revizyon geri yükleme route'unda `isLegalDocument`
   uygulamasını düzelt (yukarıdaki iki seçenekten biri) ve
   `localization.test.ts`/`revisions.test.ts`'e bunu kapsayan bir regresyon testi ekle
   (EDITOR restore ile `isLegalDocument` değişemiyor + değişirse audit üretiliyor).
2. **[Düşük öncelik, isteğe bağlı]** `LocaleQuerySchema.locale`'e `.max(35)` gibi bir üst sınır
   ekle (tutarlılık/hijyen amaçlı, engelleyici değil).

Bunların dışında bu iş **Definition of Done**'daki "güvenlik denetiminden geçmiş" kriterini
madde 1 düzeltildikten sonra karşılar.
