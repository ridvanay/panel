# Paket J — Yasal sayfaların TR/EN içeriği, yükleme scripti, iletişim formu linki (2026-10-19)

**Hızlı Mod geçerli** (`.claude/CLAUDE.md`). Ajanlar yalnızca inceleme yapar. Testleri ana oturum dosya dosya, sırayla çalıştırır.

## Arka plan
Canlı sitedeki yasal sayfaların çoğu boş şablon durumunda:
- `kvkk-aydinlatma-metni-2`, `acik-riza-metni-2` ve `kullanim-kosullari-2` sayfalarında yalnızca başlıklar ve "Bu metin bir yer tutucudur ve hukuki geçerliliği yoktur" yazısı var.
- `distance-service-agreement` sayfası yalnızca İngilizce. İçinde doldurulmamış alanlar (`[Phone Number]`, `[City / Country]`, `yourwebsite.com`), yanlış yazılmış bir e-posta (`wmhealtistanbul.com`) ve tekrar eden bölümler var.
- İletişim formundaki "Aydınlatma Metni" linki yanlışlıkla `distance-service-agreement` sayfasına gidiyor.

Yeni metinler `docs/legal/` klasöründe hazır: her sayfa için `.tr.md` ve `.en.md`, ayrıca `values.json` ve `README.md`. Bu metinlerin içeriğini **değiştirme**. Yalnızca aşağıdaki "Doğruluk kontrolü" bölümünde istenen notları rapora yaz.

## Başlangıç
- `origin/master` (`7694489`) üzerinden `feat/legal-pages-oct19` dalını aç.
- Push etme.

## KIRMIZI ÇİZGİ: değişmeyecekler
- `consultation-room.tsx`, LiveKit, meeting-token, egress ve kayıt kodu
- docker-compose, Dockerfile'lar, Nginx, `.env`
- Prisma şeması ve migration'lar. Bu pakette migration **yok**. Mevcut tablolar yeterli değilse dur ve rapora yaz.
- `package.json` ve `package-lock.json`

## İş 1 — `docs/legal/` dosyalarını commit'le
Dosyalar çalışma klasöründe hazır. İçeriğine dokunmadan ilk commit olarak ekle.

## İş 2 — Yükleme scripti: `backend/scripts/publish-legal-pages.ts`
Önce CMS'in sayfaları ve TR/EN çevirilerini nasıl sakladığını incele. Bunun için Page modeline, varsa çeviri/locale yapısına ve Paket A2'nin dil desteğine bak. Script şunları yapmalı:

1. **Eşleme:** `docs/legal/README.md` tablosundaki dört slug'ı, ilgili `.tr.md` ve `.en.md` dosyalarıyla eşle. Sayfalar slug ile bulunur. Yeni sayfa **açılmaz**; slug bulunamazsa script hata verip durur.
2. **Yer tutucular:** `{{ANAHTAR}}` değerleri dile göre `docs/legal/values.json` dosyasından (`tr` / `en`) doldurulur. Değeri boş kalan ya da metinde çözülmemiş `{{...}}` bırakan bir dosya varsa gerçek yüklemeye **izin verilmez**. Bu durumda script eksik anahtarları listeler.
3. **Format:** Markdown, CMS'in kullandığı içerik biçimine dönüştürülür (bloklar, rich text ya da markdown alanı; hangisiyse). Dosyadaki ilk `# Başlık` satırı sayfa başlığı olur.
4. **Korunacak alanlar:** Slug, `isLegalDocument`, yayın durumu ve menü/footer bağlantıları değişmez. Yalnızca başlık ve içerik güncellenir; TR asıl kayda, EN çeviri kaydına yazılır. EN çeviri kaydı yoksa, CMS'in mevcut çeviri mekanizmasıyla oluşturulur.
5. **Kuru çalışma (varsayılan, hiçbir şey yazmaz):**
   - Her sayfa için mevcut başlık ve içerik uzunluğu, yeni başlık ve içerik uzunluğu, eksik yer tutucular ve EN kaydının var olup olmadığı yazdırılır.
   - Eksik yer tutucular olsa bile kuru çalışma çalışır, eksikleri yalnızca listeler.
6. **Gerçek yükleme:** `--confirm=publish-legal` parametresiyle yapılır.
   - Yüklemeden önce dört sayfanın tam mevcut hâli (TR + EN) `backups/legal-pages-<zaman>.json` dosyasına yazılır. Bu dosya `.gitignore`'da olmalı; değilse yalnızca bu satırı ekle.
   - Tüm güncellemeler tek bir transaction içinde yapılır.
   - AuditLog'a `cms.legal_pages.published` kaydı düşülür. Kayıtta operatör (`--operator` zorunlu), slug listesi ve yedek dosyası adı bulunur.
   - Cache veya ISR kullanılıyorsa, sayfaların yenilenmesi için mevcut revalidate mekanizması tetiklenir.
7. **Geri dönüş:** `--restore=<yedek dosyası> --confirm=restore-legal --operator=...` ile yedekteki hâl birebir geri yazılır.
8. **Sunucuda çalıştırma:** Script, prod imajında Paket G'de kullandığımız yöntemle çalışabilmeli:
   - `docker compose cp` ile `scripts`, `src`, `tsconfig.json` ve `docs/legal` konteynere kopyalanır.
   - Çalıştırma: `npx -y tsx@4.23.1 scripts/publish-legal-pages.ts ...`
   - `docs/legal` yolu `--dir` parametresiyle verilebilmeli; varsayılan `../docs/legal` olmalı.
9. Yer tutucu doldurma, markdown dönüşümü, eksik anahtar engeli ve yedek/geri dönüş için birim testleri yaz.

## İş 3 — İletişim formu linki
`frontend/src/components/site/contact-form.tsx` dosyasındaki "Aydınlatma Metni" linki KVKK aydınlatma sayfasına gitmeli. Bunun için `legal-pages.ts` içindeki mevcut KVKK çözümleyicisini kullan (`resolveKvkkNoticePage` veya `resolveKvkkConsentPage`; hangisi uygunsa). Bulunamazsa link gösterilmez; mesafeli sözleşmeye düşen yedek davranış (fallback) kaldırılır. `live-chat-widget.tsx` ve checkout'taki KVKK linklerini de aynı açıdan kontrol et. Yanlış sayfaya gidenler varsa aynı şekilde düzelt ve rapora yaz. Bu düzeltmeler için test ekle.

## Doğruluk kontrolü (metinleri DEĞİŞTİRME, sadece rapora yaz)
Metinlerde aşağıdaki iddialar var. Her birinin kodla uyumlu olup olmadığını kontrol et ve rapora "doğru / yanlış / kısmen" diye yaz:
1. Görüşmeler varsayılan olarak kaydedilmez. Kayıt, görüşme başlamadan önce ekranda ayrıca onay alınırsa yapılır ve kayıt göstergesi görünür.
2. Kayda onay vermemek hizmet almayı engellemez.
3. Kayıtlar mevzuattaki sürelerin sonunda silinir (`recording-retention`).
4. Görüşme bağlantısı e-posta ile ve hesap paneli üzerinden iletilir.
5. Sözleşmenin bir kopyası danışanın e-posta adresine gönderilir.
6. Kart bilgileri saklanmaz; ödeme lisanslı bir ödeme kuruluşu üzerinden alınır. Kullanılan sağlayıcıyı da yaz.
7. Randevu saatinden 24 saat öncesine kadar ücretsiz iptal veya erteleme yapılabilir. Sistemdeki iptal kuralı bununla aynı mı?
8. 18 yaş altı için bir kontrol var mı?

## İnceleme
- `security-agent` ve `compliance-agent` (hangileri varsa) diff'i incelesin. Özellikle scriptin yedek, transaction ve onay akışına baksınlar.
- Şu kontrol boş çıkmalı:
  ```
  git diff origin/master -- frontend/src/components/site/telehealth/consultation-room.tsx docker-compose.yml backend/prisma
  ```

## Rapor
`docs/prompts/2026-10-19-J-RAPOR.md` dosyasına şunları yaz:
- Commit listesi
- CMS'te TR/EN sayfa yapısının nasıl çalıştığı
- Scriptin kullanımı: kuru çalışma, gerçek yükleme ve geri dönüş için ayrı ayrı örnek komut
- Test sonuçları
- Doğruluk kontrolü tablosu
- Canlıya alma sırası:
  1. Yalnızca frontend yeniden derlenir (iletişim formu linki için).
  2. Script sunucuda önce kuru çalışma modunda çalıştırılır.
  3. `values.json` doldurulup hukuk onayı alındıktan sonra gerçek yükleme yapılır.
