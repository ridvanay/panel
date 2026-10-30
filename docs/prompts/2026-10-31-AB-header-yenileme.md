# Paket AB: Profesyonel header (masaüstünde menü sığmıyor) (2026-10-31)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar.

## Başlangıç
- `origin/master` üzerinden `feat/header-redesign-oct31` dalını aç. Push etme.

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, ödeme ve randevu kuralları
- compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/`
- Yeni npm paketi yok.
- Migration yok.

## Sorun
- Paket W'de "Find my physician" düğmesi eklenince menü, 1920 piksel geniş bir masaüstü ekranda bile sığmıyor ve hamburger menüye düşüyor. Sebebi, header içeriğinin dar bir kapsayıcıya (yaklaşık 1100 px) sıkışması.
- Sayfada logo, Appointment, bayrak ve hamburger dışında hiçbir şey görünmüyor; profesyonel durmuyor.
- Almanca, Romence ve Fransızca gibi uzun etiketli dillerde aynı sorun daha erken başlıyor.

## İstenen: iki katlı header

**1. Üst bilgi şeridi (ince, ~36 px, yalnızca ≥1024 px):**
- **Sol taraf:**
  - "🌐 Support in 9 languages · Free interpreter". Bu metin V paketindeki `languageSupport` ayarından gelir; ayar kapalıysa gizlenir.
  - Yanında, ayarlanmışsa WhatsApp/telefon bağlantısı. WhatsApp X paketinde eklenecek, şimdilik yalnızca destek bağlantısı.
- **Sağ taraf:**
  - dil seçici (bayrak, yerel ad, ok)
  - "Sign in" ya da hesap menüsü
  - kullanıcının tercüman profili varsa "Tercüman paneli"
- Sayfa kaydırılınca bu şerit yumuşak bir şekilde gizlenir. Ana bar yapışkan kalır.

**2. Ana bar:**
- **Sol:** logo.
- **Orta:** menü (Home, About, Consult Physicians, Specialties ▾, Contact). `NavigationItem` kayıtlarından gelir.
- **Sağ:**
  - **"Find my physician"**: ikonlu, ikincil (outline) düğme
  - **"Appointment"**: birincil düğme
- **Kapsayıcı:** header, sayfa içeriğinden bağımsız olarak daha geniş bir kapsayıcı kullanır: `max-w` yaklaşık 1320–1400 px, yan boşluklar 24–32 px.
- Kaydırınca ana bar yüksekliği 80 px'ten 64 px'e küçülür, logo da orantılı küçülür. Gölge ve ince alt çizgi eklenir.

**3. Kırılma noktaları:**
- **≥1280 px:** bütün menü, iki düğme ve üst şerit tek satırda görünür. **Hiçbir dilde satır kayması ya da hamburger olmaz.** Bunu 9 dilin en uzun etiketleriyle (DE, RO, FR, RU) test et.
- **1024–1279 px:**
  - menü aralıkları daralır
  - "Find my physician" yalnızca ikon olur; tooltip ve `aria-label` taşır
  - etiketler hâlâ sığmıyorsa "Contact" gibi ikincil öğeler "More ▾" altına toplanır
  - hamburger yine **yok**
- **<1024 px:** mevcut mobil menü ve dil alt sayfası (V paketi) aynen kalır. "Find my physician" mobil menünün en üstünde, belirgin bir düğme olsun.
- **Ölçüm:** genişlik kontrolü sabit piksel tahminiyle değil, ölçerek yapılsın (`ResizeObserver`; menü taşarsa kompakt moda geçilir). SSR'da varsayılan masaüstü düzeni kullanılsın ve CLS üretilmesin.

**4. Specialties açılır menüsü:**
- "Obesity and Metabolic Surgery" gibi uzun adlar 2 satıra düzgün sarılsın; tooltip çıkmasın.
- Kart yükseklikleri eşit olsun.

**5. Erişilebilirlik ve RTL:**
- Klavye ile gezinme ve görünür odak.
- Açılır menüler ESC ile kapanmalı.
- `aria-current`.
- Arapçada düzen ayna görüntüsü olmalı (logo sağda).

**6. Değişmeyenler:**
- Menü öğelerinin kaynağı (`NavigationItem`), sözlük etiketleri ("Consult Physicians" kuralı), dil yönlendirme davranışı ve Paket O'nun tek satır kuralı.

## Testler
- Ekran görüntüleri: 1024, 1280, 1440 ve 1920 px × EN, DE, RO, AR, RU. Ayrıca mobil 390 px EN. Klasör: `docs/prompts/2026-10-31-AB-ekran/`.
- Otomatik test: 1280 px ve üzerinde 9 dilde hamburger görünmüyor ve menü öğelerinin hepsi görünür.
- Kaydırmada üst şeridin gizlenmesi ve ana barın küçülmesi.
- Klavye, ESC, RTL.
- Lighthouse erişilebilirlik puanı düşmemeli; CLS 0.1'in altında olmalı.

## Rapor
`docs/prompts/2026-10-31-AB-RAPOR.md` dosyasına şunları yaz: commit listesi, önce/sonra ekran görüntüleri, kırılma noktası kararları, testler. Canlıya alma yalnızca frontend.
