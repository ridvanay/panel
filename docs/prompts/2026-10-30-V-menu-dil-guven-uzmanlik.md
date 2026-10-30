# Paket V: "Consult Physicians", mobil dil seçici, çok dilli destek, güven logoları, iki yeni uzmanlık (2026-10-30)

**Hızlı Mod geçerli** (`.claude/CLAUDE.md`). Ajanlar yalnızca inceleme yapar. Testler ana oturumda dosya dosya ve sıralı (`--no-file-parallelism`) koşar. **Bütün cevaplarını ve raporunu Türkçe yaz.**

## Başlangıç
- `origin/master` (`ca948a6`) üzerinden `feat/physicians-trust-locales-oct30` dalını aç. Push etme.
- Bu paket, sonraki W/X/Y/Z paketlerinin temelidir. Yalnızca burada istenenleri yap.

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, meeting-token, kayıt, egress
- Ödeme ve randevu oluşturma kuralları
- docker-compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/`
- Yeni npm paketi yok.
- Migration: **yalnızca ekleme yapan** migration'a izin var (yeni tablo/kolon/enum değeri). Kolon silme, yeniden adlandırma, tip değiştirme yok.

---

## İş 1: "Doctors" → "Consult Physicians" (menü ve bütün bağlantılar)

1. **Etiket**
   - Menüde (masaüstü, mobil, footer) "Doctors" yerine EN **"Consult Physicians"** yazılsın.
   - Diğer 8 dilde doğal karşılık kullanılsın (öneri: TR "Hekime Danışın"). Seçilen 9 karşılığı rapora tablo olarak yaz, onaya sunulacak.
   - Etiket sözlükten ve `NavigationItem` çevirilerinden gelsin. Sabit metin bırakma.
   - Sayfa başlıkları, "Featured Doctors" gibi bölüm başlıkları ve düğmeler de aynı terminolojiye geçsin (EN: "Physicians", "Featured Physicians", "View physician"). Değişen bütün görünür metinleri rapora listele.
2. **URL**
   - Liste ve profil yolu `/[lang]/doctors` → **`/[lang]/physicians`** olsun. Örnek: `/en/physicians/hakan-sofu`. Slug'lar değişmez.
   - Eski bütün URL'ler (`/[lang]/doctors`, `/[lang]/doctors/<slug>`, query string korunarak) **301** ile yeni adrese yönlensin. Yönlendirme Next.js tarafında (middleware veya `redirects`) yapılsın; Nginx'e dokunulmaz.
   - Güncellenecek yerler:
     - iç bağlantılar
     - canonical, hreflang
     - sitemap, `robots`, `llms.txt`, `llms-full.txt`
     - JSON-LD `url` alanları
     - e-posta şablonlarındaki bağlantılar
     - CRM'deki yol eşlemeleri ve raporlar (eski `/doctors` verisi de aynı sayfa sayılsın)
     - `NavigationItem` kayıtları (gerekirse ekleme scriptiyle, kuru çalışma + `--confirm`)
   - Doktor portalı `(doctor)` ve admin rotaları değişmez.
3. **Test:**
   - Eski URL → 301 → yeni URL (9 dil, liste ve profil).
   - Sitemap'te `/doctors` kalmadığı.
   - Sayfa kaynaklarında `/doctors/` bağlantısı kalmadığı (tarama testi).

## İş 2: Mobil dil seçici (profesyonel)

Şu an mobil menüde 9 dil alt alta uzun bir liste olarak açılıyor. Bunun yerine:
- Mobil menüde **tek satır**: küre ikonu, aktif dilin bayrağı ve yerel adı, sağda ok ("🌐 English ›").
- Dokununca **alt sayfa (bottom sheet)** açılsın:
  - başlık "Language / Dil"
  - **2 sütunlu ızgara**: bayrak ve yerel ad
  - aktif dil vurgulu ve işaretli
  - kapatma düğmesi
  - aşağı kaydırarak kapatma
  - arka plan karartma
  - odak tuzağı ve ESC ile kapanma
- Arapça satırında yerel ad `dir="rtl"` ile izole edilsin. Ekran görüntüsünde "العربية" sağa kaymış, satır düzeni bozuk; bu düzeltilsin.
- Header'da (mobil) menü düğmesinin yanında yalnızca bayrak olarak küçük bir dil düğmesi olsun ve aynı sheet'i açsın.
- Masaüstü dil seçici aynı kalsın. Yalnızca 9 dilde açılır menünün düzenini kontrol et.
- Dil değişince aynı sayfanın karşılık dil URL'sine gidilsin (mevcut davranış korunur).
- **Test:**
  - 360, 390 ve 430 piksel genişlikte ekran görüntüsü (`docs/prompts/2026-10-30-V-ekran/`).
  - Klavye ve ekran okuyucu etiketleri.
  - RTL düzen.

## İş 3: "Kendi dilinizde destek, ek ücret yok" bölümü

- **Site ayarları (mevcut settings JSON'u içinde):**
  - `supportLanguages`: destek verilen dil kodları
  - `supportHours`: metin, dil başına çeviri
  - `interpreterIncluded`: boolean. Görüşmelerde tercüman desteği.
- **Görünüm:**
  - **Anasayfa:** Hero'nun hemen altında belirgin bir bant. Örnek EN metin: "Speak with a patient coordinator in your language — at no extra cost." Yanında desteklenen dillerin bayrakları ve "Talk to us" düğmesi (WhatsApp/canlı destek/iletişim; X paketiyle birlikte WhatsApp eklenecek, şimdilik canlı destek ve iletişim).
  - **Doktor profili ve randevu sihirbazı:** küçük bir rozet ("🌐 Support in 9 languages").
  - **Footer:** kısa satır.
- **Doğruluk kuralı:** Yalnızca `supportLanguages` içindeki diller listelenir. Liste boşsa bölüm **hiç görünmez**. "Tercüman ücretsiz" cümlesi yalnızca `interpreterIncluded=true` ise gösterilir. Varsayılan: liste boş, bölüm kapalı. Site yöneticisi gerçekte desteklenen dilleri seçince açılır.
- Admin Görünüm/Ayarlar ekranında bu alanlar ve dil sekmeleri olsun.
- Bütün metinler 9 dilin sözlüğünde olsun.

## İş 4: Güven ve yetki logoları (Health Türkiye, TÜRSAB, T.C. Sağlık Bakanlığı)

- **Yeni tablo `AccreditationBadge`:**
  - `name`, `issuer`, `logoMediaId` (yönetici yükler)
  - `certificateNo`, `verificationUrl`
  - `validUntil` (opsiyonel)
  - `translations` (ad/açıklama)
  - `sortOrder`, `isActive`
- Admin'de "Yetki Belgeleri ve Akreditasyonlar" ekranı.
- **Görünüm:**
  - Anasayfada "Licensed & accredited" şeridi
  - Footer'da küçük logolar
  - Hakkımızda sayfasında ayrıntılı liste: belge numarası ve "Doğrula" bağlantısı
- **Kurallar:**
  - Logo dosyaları **repoya eklenmez ve çizilmez/üretilmez.** Resmi dosyaları yönetici yükleyecek.
  - `isActive=true` olabilmesi için `certificateNo` dolu olmalı (backend doğrulaması). Belge numarası olmayan logo **gösterilmez**.
  - Süresi geçen (`validUntil` < bugün) belge otomatik gizlenir ve admin panelinde uyarı çıkar.
  - JSON-LD Organization'a `hasCredential` yalnızca aktif belgeler için eklenir.
- Seed yok. Tablo boş başlar.

## İş 5: İki yeni uzmanlık

- **Göğüs Cerrahisi** — EN "Thoracic Surgery", slug `thoracic-surgery`, ikon lucide `wind` veya uygun olanı
- **Beyin ve Sinir Cerrahisi** — EN "Neurosurgery", slug `neurosurgery`, ikon `brain`

Uygulama:
- `backend/scripts/add-specialties.ts` yaz: kuru çalışma varsayılan, `--confirm=add-specialties --operator=...`, idempotent, audit log. Mevcut uzmanlıklara dokunmaz.
- Açıklamalar EN kanonik yazılsın. 8 dilin çevirisi mevcut export/import akışıyla yapılacak; komutları rapora yaz.
- **Doktoru olmayan uzmanlık:**
  - Uzmanlık sayfası yayında kalsın ama doktor listesinin yerine "Bu alanda size uygun hekimi koordinatörümüz belirlesin" kutusu çıksın (iletişim/canlı destek, W paketinden sonra eşleştirme sihirbazı).
  - Sayfa doktor atanana kadar `noindex` olsun.
  - Sitemap'e doktor atanınca girsin.
- Uzmanlık ve ikon seçimini rapora yaz.

---

## Testler
- İş 1–5'te sayılan testler.
- Sözlük anahtar eşitliği (9 dil).
- `AccreditationBadge` doğrulaması: belge numarasız aktif edilemez, süresi geçen gizlenir.
- Destek bandı: liste boşken görünmez, doluyken yalnızca seçili diller.

## İnceleme
- `frontend-agent`, `security-agent` (admin uçları, yönlendirmede açık yönlendirme olmaması) ve `db-agent` (migration yalnızca ekleme) incelesin.
- Şu kontrolün çıktısı **boş** olmalı:
  ```
  git diff origin/master --stat -- frontend/src/components/site/telehealth/consultation-room.tsx docker-compose.yml backend/src/modules/billing backend/src/modules/checkout frontend/package.json backend/package.json
  ```
- `backend/prisma` diff'i yalnızca yeni migration klasörü ve şemaya eklemeler içermeli. Migration SQL'ini rapora koy.

## Rapor
`docs/prompts/2026-10-30-V-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- 9 dil menü etiketi tablosu
- değişen görünür metinler
- 301 listesi
- migration SQL
- ekran görüntüleri
- testler
- canlıya alma sırası (yedek → pull → migrate → backend → frontend → `add-specialties` kuru/gerçek → export/çeviri/import → kontrol)
