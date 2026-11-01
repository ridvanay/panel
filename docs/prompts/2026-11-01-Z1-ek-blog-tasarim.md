# Paket Z1-ek: Blog ve güven sayfalarının profesyonel tasarımı (2026-11-01)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar. Push etme. E2E headless (`E2E_HEADLESS=1`).

**Z2'ye (konu planı) bu paket bitip canlıya alınana kadar başlama.** Konu planına başladıysan dur, bu paketi önce bitir.

## Başlangıç
- Ana proje klasöründe çalış, yeni worktree açma.
- `git fetch`, ardından güncel `origin/master` (Z1 canlıda, `9ad912e`) üzerinden `feat/blog-design-nov01` dalını aç.
- Commit'lenmemiş dosyalara (`.claude/…`, `design/`) dokunma.

## Kullanıcının canlıdaki gözlemi
1. **Güven sayfaları profesyonel değil:**
   - `/content-standards` sayfasında başlık iki kez görünüyor (sayfa başlığı ve içerikteki H1).
   - H2'ler çok büyük ve aralıksız.
   - Altta sayfaya uymayan paylaşım ikonları var.
   - `/medical-reviewers` sayfasında başlıklar sol kenara yapışık, metin ortada; aralarında büyük boşluklar var, düzen kırık.
2. **"Blog sayfası yok":**
   - Menüde blog bağlantısı yok.
   - Canlıda henüz yazı ve kategori olmadığı için `/blog` boş bir liste gibi görünüyor.
   - Kullanıcı, örnek aldığımız sağlık rehberi sitesindeki gibi (flymedi bilgi mimarisi) dolu ve güven veren bir blog görünümü istiyor.

Canlı veri: varsayılan dil `en`, blog yazısı 0, kategori 0, aktif hekim 9, aktif paket 8. Marka renkleri `#2951a0` (koyu mavi) ve `#4ab9e1` (açık mavi). Site tema token'ları zaten bunları veriyor. **Sabit renk yazma, tema token'larını kullan.**

## KIRMIZI ÇİZGİ
- Görüşme odası, LiveKit, egress, ödeme ve randevu kuralları, compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/` değişmez.
- **Yeni npm paketi yok.**
- Migration gerekmemeli. Gerekirse yalnızca ekleme yapar, önce sor.
- **Sahte içerik yok:**
  - Canlıya örnek yazı, sahte hekim yorumu ya da uydurma istatistik konmaz.
  - Örnek içerik yalnızca yerel test fixture'larında olur.
- Z1'in yayın kuralı (hekim onayı) ve SEO davranışı değişmez.

---

## İş 1: Güven sayfaları için özel tasarım
`content-standards` ve `medical-reviewers` için CMS'in ham HTML görünümü yerine **özel tasarlanmış sayfa şablonu** yapılsın.
- **Yöntem:** Metinler 9 dilde site sözlüğünden gelsin (EN metin, Z1'de kullanıcının onayladığı metindir; diğer dillere çevir).
  - Bu iki slug için Next'te özel route'lar olsun. Dinamik `[slug]` route'unun önüne geçtiklerini doğrula.
  - CMS'teki mevcut iki `Page` kaydına dokunma. Rapora bu kayıtların artık gösterilmediğini yaz.
  - Daha iyi bir yöntem önerirsen gerekçesiyle rapora yaz.
- **Ortak düzen:**
  - Marka tonlarında hafif bir üst bant: breadcrumb, H1, tek paragraflık giriş, "Last updated" tarihi.
  - Sitenin diğer sayfalarıyla aynı kap genişliği ve tipografi ölçeği.
  - Paylaşım ikonları yok.
- **Content standards:**
  - İkonlu ilke kartları ızgarası: "How guides are written", "Medical review", "Sources", "Updates & corrections", "What our guides are not".
  - **Süreç şeması** (yatay adımlar, mobilde dikey): Yazım, kaynak kontrolü, hekim incelemesi, yayın, düzenli yeniden inceleme.
  - Vurgulu bir uyarı kutusu: "not a substitute for a medical consultation", acil durum notu.
  - Sonda iki CTA: "Read our health guides" ve "Find my physician".
- **Authors & medical reviewers:**
  - "WM Health Editorial Team" kartı.
  - "What a review covers" maddeleri (ikonlu liste).
  - **İnceleyen hekimler ızgarası:**
    - Kartta fotoğraf, unvan (izleyicinin dilinde, AF'deki unvan çevirisi kuralı), görünen ad kuralı, uzmanlık ve profil bağlantısı.
    - **Yalnızca en az bir yazıyı onaylamış (approved) hekimler gösterilir.** Hekimler bu rolü kabul etmeden "reviewer" olarak listelenmesin.
    - Henüz onaylanmış yazı yoksa ızgara yerine nötr bir cümle çıkar ("Our physicians review each guide before publication.").
- 9 dil, RTL, 44 px dokunma alanı. SEO: canonical, hreflang, `WebPage` JSON-LD.

## İş 2: CMS sayfa görünümünün genel düzeltmesi
Aynı ham görünüm sorunu diğer CMS sayfalarında da olabilir.
- **İçerik başlığı tekrarı:** İçerik bir H1 ile başlıyor ve bu H1 sayfa başlığıyla aynıysa, içerikteki H1 gösterilmez. Benzer başlık tekrarlarını da düzelt.
- **Tipografi:** CMS zengin metnine Z1'deki yazı tipografisi uygulansın: başlık ölçeği, aralıklar, liste ve tablo stilleri, okunur satır genişliği.
- **Hizalama:** Başlık ve metin aynı kolonda hizalı olsun.
- **Önce envanter çıkar:** CMS sayfa tipleri ve bloklarını listele (hakkımızda, iletişim, yasal sayfalar vb.). Değişiklik **yalnızca görsel** olsun. Yasal sayfaların metni ve sürüm notları değişmez.
- Önce/sonra ekran görüntüsü: en az Hakkımızda, bir yasal sayfa ve iki güven sayfası.

## İş 3: Blog ana sayfası — boşken de profesyonel
Yazı sayısı ne olursa olsun sayfa güven veren, dolu bir görünümde olsun.
- **Üst bant:** Marka tonlarında; "Health Guides" başlığı, açıklama, arama kutusu ve güven satırı ("Reviewed by physicians · Sources cited · Regularly updated" → Content standards sayfasına bağlantı).
- **"Browse by specialty":**
  - Aktif uzmanlıklardan ikonlu kartlar.
  - Yazısı olan uzmanlıkta kart filtreye gider ve yazı sayısını gösterir. Yazısı olmayan uzmanlıkta kart uzmanlık sayfasına gider ve sayı göstermez.
  - Sahte sayı yazılmaz.
- **Yazı yokken:**
  - Liste yerine düzgün bir boş durum: "Our first guides are being reviewed by our physicians."
  - Altında "Find my physician" ve "Talk to a patient coordinator" CTA'ları ile "Popular packages" bloğu.
  - Boş bir ızgara ya da "Articles: 0" görünmez.
- **Yazı varken:** Z1 düzeni.
  - Öne çıkan yazı, kart ızgarası, konu filtresi.
  - Kartlarda kapak fotoğrafı yoksa uzmanlık ikonlu şablon kapak.
  - Kartta onaylayan hekimin küçük fotoğrafı ve adı.
- **Kategori çipleri:** uzmanlığa göre tutarlı ikon ve tonlar (tema paletinden).

## İş 4: Yazı sayfasının cilası
- Başlığın altında **"Medically reviewed by"** satırı: hekim fotoğrafı, unvanı, adı, inceleme tarihi; tıklanınca hekim profili.
- Yazar kutusu (WM Health Editorial Team, Content standards bağlantısıyla).
- Üstte ince bir **okuma ilerleme çubuğu.**
- Kapak görseli alanı: oranı sabit, yoksa şablon kapak.
- Mevcut olanlar korunur, görsel kalite artırılır: içindekiler, ana çıkarımlar, SSS, kaynaklar, "Consult a physician" kartları, ilgili yazılar, uyarı. Masaüstünde iki kolon dengeli, mobilde tek kolon.
- Paylaşım düğmeleri yalnızca yazı sayfasında kalır.

## İş 5: Menü bağlantısı (hazırla, çalıştırma)
- Header ve footer menüleri admin'deki Navigasyon'dan geliyor. Bu menülere 9 dilde etiketli "Health Guides" bağlantısını ekleyen script yaz: `backend/scripts/add-blog-nav-item.ts`.
  - Varsayılan kuru çalışma. Gerçek çalıştırma: `--confirm=add-blog-nav --operator=...`
  - Idempotent; yedek alır ve `--restore` desteği olur.
- **Script'i çalıştırma.** Kullanıcı, ilk onaylı yazılar yayına çıktığında çalıştıracak. Rapora menünün mevcut yapısını ve script'in nereye ekleyeceğini yaz.

## Testler
- Güven sayfaları:
  - 9 dilde render
  - başlık tekrarı yok
  - onaylı yazısı olmayan hekim ızgarada yok
  - JSON-LD
- CMS sayfası: içerikteki H1 sayfa başlığıyla aynıysa gizleniyor; yasal sayfa metni değişmiyor.
- Blog ana sayfası:
  - 0 yazıda boş durum ve CTA'lar; "Articles: 0" yok.
  - Yazı varken öne çıkan yazı ve ızgara.
  - Uzmanlık kartlarında sahte sayı yok.
- Yazı sayfası: hekim satırı, ilerleme çubuğu, mevcut Z1 testleri.
- Menü script'i: kuru çalışma, idempotent çalışma, geri yükleme.
- Kırmızı çizgi kontrolü boş olmalı. Z1 testlerinin tamamı geçmeli.

## Ekran görüntüleri
Kayıt yeri `docs/prompts/2026-11-01-Z1-ek-ekran/`. Yerelde gerçekçi örnek içerikli fixture'larla al: 6–8 yazı, kapaklı ve kapaksız, 3 uzmanlık.
- Blog: boş ve dolu hâlleri.
- Yazı sayfası.
- İki güven sayfası.
- Hakkımızda ve bir yasal sayfa (önce/sonra).
- Masaüstü 1440 ve mobil 390; EN, TR ve AR.

## Rapor
`docs/prompts/2026-11-01-Z1-ek-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- değişen dosyalar ve gerekçeleri
- güven sayfası yöntemi
- CMS sayfa envanteri
- ekran görüntüleri
- testler
- canlıya alma sırası (migration yoksa backend ve frontend derlemesi)

**Bitince dur ve onay bekle.**
