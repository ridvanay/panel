# Blog taslak önizlemesi (D) ve ESD not düzeltmesi (C2) — RAPOR (2026-11-02)

- **Dal:** `feat/blog-preview-nov02` (temel `origin/master` `3c26afa`). Push edilmedi.
- **Akış:** Tam akış (imzalı bağlantı ve yetki, yalnızca ekleme yapan migration, doktor paneli erişimi).
- **Yayın kuralı (B) DEĞİŞMEDİ:** yazı yalnızca atanan hekim doktor panelinden onayladıktan sonra yayınlanabilir. "Yönetici onayı / editorial_approved" diye bir istek alınmadı, hiçbir şey eklenmedi. Önizleme hiçbir yazının durumunu değiştirmez (testli).

## Commit'ler

| Hash | Kapsam |
|---|---|
| `d0ee5e5` | Backend: önizleme alanları (migration), paylaşım ve oturum belirteçleri, `GET /blog/preview/:postId`; import script'ine `medicalReviewNote` |
| `b97ddfc` | Frontend: önizleme sayfası, admin "Önizle / bağlantı oluştur / iptal", admin listesinde "Önizle", hekim panelinde "Preview" |
| `01de848` | E2E'de bulunan hata: doktor yönlendirme koruması hekimin önizleme sekmesini portala atıyordu. Dar `/blog/preview/{id}` istisnası eklendi; karar `.claude/architect-scope-doctor-subdomain.md` §5.6.2'ye yazıldı. |
| `27610c5` | E2E (headless): önizleme; `blog-z1ek` uzmanlık kartı beklentisi aktif hekim kuralına göre güncellendi |
| (bu commit) | Rapor ve ekran görüntüleri |

## Tasarım

**Neden iki belirteç türü:** admin ve doktor oturumu tarayıcıda taşınıyor (Authorization başlığı), sunucuda render edilen sayfa bu oturumu göremez. Bu yüzden önizleme sayfası her zaman URL'de bir belirteçle açılır (`?t=`).

| | Paylaşım bağlantısı (`s_…`) | Oturum belirteci (`p_…`) |
|---|---|---|
| Kim | Admin editöründe "Önizleme bağlantısı oluştur" | Admin "Önizle" ya da atanan hekim "Preview" |
| Oturum gerekir mi | Hayır, bağlantıya sahip herkes açar | Belirteci almak için oturum gerekir |
| Süre | 7 gün | 30 dakika |
| Saklama | DB'de yalnızca SHA-256 özeti | Durumsuz HMAC-SHA256 (postId, süre ve amaç imzalı) |
| İptal | Admin "Bağlantıyı iptal et"; yeniden oluşturma eskisini geçersiz kılar | Kısa ömürlü |
| Kapsam | Yalnızca o yazı | Yalnızca o yazı; hekim yalnızca kendisine atanmış yazı için alabilir |

- **İmza anahtarı:** mevcut `JWT_PRIVATE_KEY_BASE64`'ten HKDF ile türetiliyor (`info = "blog-preview-v1"`). **Yeni `.env` değişkeni yok.** JWT anahtarı döndürülürse açık oturum belirteçleri düşer; en fazla 30 dakikalık etki.
- **404 kuralı:** belirteç yoksa, bozuksa, süresi dolmuşsa, iptal edildiyse, başka yazıya aitse ya da yazı çöpteyse **aynı 404**. Ayrım sızdırılmaz.
- **Sızıntı önlemleri:**
  - Belirteç audit, log ve admin yanıtlarına girmez; paylaşım bağlantısının tam adresi yalnızca oluşturulduğu anda bir kez gösterilir.
  - Sayfa `Referrer-Policy: no-referrer` gönderir; böylece belirteç dış bağlantılara `Referer` ile sızmaz.
  - Kaynak bağlantıları `rel="noopener noreferrer nofollow"`.

## Önizleme sayfası `/[lang]/blog/preview/[postId]?t=…`

- Yayındaki yazı sayfasının **birebir tasarımı** (aynı bileşen).
- Üstte 9 dilde şerit:
  - "Preview — awaiting physician approval" (TR: "Önizleme — hekim onayı bekliyor");
  - onaylı ama yayınlanmamışsa "awaiting publication".
- **"Medically reviewed by" yerine** "Review pending: <unvan + görünen ad>". Onay varmış gibi görünmez; API'de `reviewer` önizlemede daima `null`.
- **JSON-LD hiç basılmaz** (reviewedBy yok). Paylaşım düğmeleri, görüntülenme sayacı ve dil alternatifleri de yok.
- **Arama motorları:**
  - `<meta name="robots" content="noindex,nofollow">` ve HTTP `X-Robots-Tag: noindex, nofollow`;
  - canonical ve hreflang yok; API yanıtı `Cache-Control: no-store`;
  - sitemap ve `llms.txt`'ye girmez (testli). Sitede RSS yok.
  - `robots.txt`'e Disallow eklenmedi; noindex'in görülebilmesi için tarayıcının sayfaya girebilmesi gerekiyor.
- `/blog/preview` CRM ziyaretçi izlemesinin dışında (backend ve frontend listesi).

## Admin ve hekim

- **Admin editörü — "Önizleme" kartı:**
  - "Önizle": yeni sekmede, 30 dk'lık belirteçle;
  - "Önizleme bağlantısı oluştur": tam URL bir kez gösterilir, kopyala düğmesi ve son geçerlilik;
  - etkin bağlantı durumu ve onaylı "Bağlantıyı iptal et".
- **Admin → Blog listesi:** yayında olmayan ve çöpte olmayan her yazıda "Önizle" (masaüstü ve mobil menü).
- **Doktor paneli → Medical review:** her yazıda "Preview". Önizleme yalnızca hekime atanmış yazılarda açılıyor; başka yazının belirteci alınmak istenirse 404.
  - **E2E'nin bulduğu hata:** doktor oturumu ana sitede açılan önizleme sekmesini `/doctor`'a geri atıyordu.
  - Doktor yönlendirme korumasına `/consultation/{id}`'nin yanına **yalnızca** `/blog/preview/{postId}` istisnası eklendi. `/blog` ve `/blog/{slug}` istisna değil (birim testi).
  - Yetki korumada değil, imzalı belirteçte.

## Migration `20261110090000_blog_preview_links` (yalnızca ekleme)

```sql
ALTER TABLE "blog_posts" ADD COLUMN "previewTokenCreatedAt" TIMESTAMP(3),
ADD COLUMN "previewTokenCreatedById" TEXT,
ADD COLUMN "previewTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN "previewTokenHash" TEXT;
CREATE UNIQUE INDEX "blog_posts_previewTokenHash_key" ON "blog_posts"("previewTokenHash");
```

## C2 — ESD notu

- `import-blog-posts.ts` parti şemasına isteğe bağlı `medicalReviewNote` (≤ 2000) eklendi.
  - Oluşturmada ve "taslak + onaysız" güncellemede yazılır; "değişiklik yok" karşılaştırmasına dahil.
  - **Alan yoksa mevcut not korunur**, `null` temizler.
  - Onaylı ya da yayındaki yazı yine atlanır.
- Düzeltme dosyası `imports/blog/fix-01-esd-note.json`: batch-01'deki ESD kaydının birebir kopyası ve `"medicalReviewNote": "Tedavi sonrası seyahat süresi notunu özellikle kontrol edin."`. `categories` boş.
  - `imports/` gitignore'da; dosyayı sunucuya batch-01 gibi taşıyın.
- Test DB'sinde doğrulandı: kuru çalıştırma "güncelle"; gerçek çalıştırma notu yazdı, yazı DRAFT ve pending kaldı; tekrar çalıştırma "atla (değişiklik yok)".
- Hekim notu doktor panelindeki "Medical review" kartında görür.

## Testler

| Kapsam | Sonuç |
|---|---|
| Backend `blog-preview` | 18/18. Belirteçsiz, bozuk, başka yazının, süresi dolmuş, iptal edilmiş, yeniden oluşturulmuş, kurcalanmış oturum belirteci ve çöp durumlarının hepsi 404. Başlıklar, `reviewer` null ve `pendingReviewer`, yetkiler, audit'te ve DB'de düz belirteç yok, durum değişmiyor. |
| Backend blog + import + CRM | `blog-preview`, `import-blog-posts` (medicalReviewNote dahil), `blog-z1`, `crm-collect`: 94/94. Ajanın geniş koşusu 114/114. `tsc` ve eslint temiz. |
| Frontend birim | Önizleme 3 dosya + Z1/Z1-ek blog + CRM + sitemap: 222/222. Yönlendirme koruması istisnası 2/2. `tsc` ve eslint temiz. |
| E2E `blog-preview.spec.ts` (headless) | **12/12.** Oturumsuz, iptal edilmiş ve süresi dolmuş bağlantı 404; oturumsuz paylaşım bağlantısı 200; noindex, no-referrer, canonical, hreflang ve JSON-LD kontrolleri; admin, liste ve hekim akışları; hekimin önizleme sekmesi (düzeltme sonrası); durum değişmiyor; sitemap ve llms'de yok. |
| E2E regresyon | `blog-z1` 12/12; `blog-z1ek` 13/13. |

**`blog-z1ek` beklenti değişikliği (gerekçeli):** "Browse by specialty" artık yalnızca aktif hekimi olan uzmanlıkları gösteriyor (onaylı karar, `88989d9`). Testin fixture'ında nöroloji ve "boş" uzmanlığın hekimi yok, bu yüzden kartları artık beklenmiyor. Hekimli uzmanlıkların kartları ve sayıları aynı şekilde doğrulanıyor.

**Bilinen ve bu işten bağımsız:** `edit-blog-post-page.test.tsx` içindeki 2 test, `origin/master`'da da düşüyor.

## Ekran görüntüleri (`docs/prompts/2026-11-02-blog-onizleme-ekran/`, masaüstü 1440 ve mobil 390)

- `01-onizleme-en`, `03-onizleme-tr`, `05-onizleme-ar` (şerit ve "inceleme bekliyor"; AR sağdan sola)
- `07-admin-editor-onizleme-karti-baglanti-olusturuldu`, `09-…-etkin-baglanti`
- `11-admin-blog-listesi-onizle`
- `13-doktor-paneli-onizleme`
- `15-404-iptal-edilmis-baglanti`

Fixture adları kullanıldı. Sol alttaki "N" rozeti yalnızca yerel geliştirme sunucusunda görünür.

## Açık notlar

1. **Şerit yalnızca onay durumuna bakıyor.** Yayındaki ve onaylı bir yazının paylaşım bağlantısıyla önizlemesinde "awaiting publication" yazar. Taslak gösterimi için sorun değil; istenirse API yazı durumunu da döndürür ve şerit ona göre ayrılır.
2. **Doktor paneli dili.** `/en/doctor/blog-review` düğmeleri tarayıcının dil çerezine göre Türkçe gelebiliyor; önceki raporlarda belgelenen mevcut davranış.

## Canlıya alma sırası

1. Dalı master'a alın, `git pull`.
2. **Migration** (canlı imajda prisma CLI yok): compose ağında tek kullanımlık `node:20-alpine` (+openssl) konteynerinde `npx prisma migrate deploy` (`20261110090000_blog_preview_links`).
3. `docker compose up -d --build --no-deps backend frontend`.
   - Frontend `next.config.ts` önizleme başlıkları içerdiği için yeniden derlenmeli.
   - **LiveKit ve diğer servisler yeniden başlatılmaz.**
4. **ESD notu (C2)**, batch-01 ile aynı yöntem:
   ```bash
   docker compose cp backend/scripts/import-blog-posts.ts backend:/app/scripts/   # imaj yeni script'i zaten içeriyorsa gerekmez
   docker compose cp imports/blog/fix-01-esd-note.json backend:/tmp/fix-01-esd-note.json
   docker compose exec backend npx tsx scripts/import-blog-posts.ts --file=/tmp/fix-01-esd-note.json
   ```
   Beklenen: `esd-early-digestive-tract-tumours` için "güncelle", 0 hata. Sonra gerçek yazım:
   ```bash
   docker compose exec backend npx tsx scripts/import-blog-posts.ts --file=/tmp/fix-01-esd-note.json --confirm=import-blog --operator=<ad>
   ```
   Yedek ve geri alma komutu çıktıda basılır. Yazı bu arada onaylandıysa script atlar ve notu ezmez.
5. **Duman testi:**
   - Admin → Blog → bir taslak → "Önizle" yeni sekmede açılır.
   - "Önizleme bağlantısı oluştur" ile alınan URL gizli pencerede açılır; "Bağlantıyı iptal et" sonrası 404 verir.
   - Kamil Özdil doktor panelinden "Preview" ile açar; ESD kartında notu görür.

**Bitti; onay bekleniyor.** D onaylanıp canlıya alındıktan sonra parti 2'ye (11–20) geçeceğim.
