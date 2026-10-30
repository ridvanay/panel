# Paket W-ek: Eşleştirme kataloğunun genişletilmesi (2026-10-31)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar.

## Başlangıç
- `origin/master` üzerinden `feat/matcher-catalog-expand-oct31` dalını aç. Push etme.
- AB (header) paketiyle aynı anda yürüyorsan ayrı bir worktree kullan.

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, ödeme ve randevu kuralları
- compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/`
- Yeni npm paketi yok.
- Migration yalnızca ekleme yapar.
- **Tanı yok** (W kuralları aynen geçerli). Katalog yalnızca "hangi uzmanlık / koordinatör" sorusuna cevap verir.

## Amaç
Canlıdaki 110 konu dar kalıyor. Örneğin "baş dönmesi", "çarpıntı", "yorgunluk", "horlama" gibi sık şikayetler hiç yok. Hasta, kendi şikayetini kendi kelimeleriyle bulabilmeli. Sihirbaz bu şikayeti ya uygun hekime ya da koordinatöre yönlendirmeli. Acil belirtileri de yakalamalı.

## İş 1: Katalogu yaklaşık 300 konuya çıkar
**Önce yalnızca tabloyu yaz ve dur:** `docs/prompts/2026-10-31-W-ek-katalog.md`. Ben onay verdikten sonra seed'e geç.

Kapsanacak alanlar (bunlar örnek; listeyi sen genişlet):
- **Genel belirtiler:** baş dönmesi/vertigo, yorgunluk/halsizlik, ateş (uzun süren), açıklanamayan kilo kaybı, iştahsızlık, gece terlemesi, ödem/şişlik, kansızlık.
- **Kalp ve damar:** çarpıntı, yüksek tansiyon, düşük tansiyon, bacakta ağrı/kramp, varis, damar tıkanıklığı.
- **Akciğer:** öksürük (uzun süren), nefes darlığı (acil olmayan), astım, KOAH, horlama/uyku apnesi, sigarayı bırakma.
- **Kulak-burun-boğaz:** sinüzit, burun tıkanıklığı, işitme kaybı, kulak çınlaması, bademcik, ses kısıklığı.
- **Göz:** bulanık görme, katarakt, gözlükten kurtulma (lazer).
- **Hormon ve metabolizma:** diyabet, tiroid hormon bozukluğu (nodülden ayrı), PCOS, kolesterol.
- **Sinir sistemi:** migren (kırmızı bayrak olmayan), uyuşma/karıncalanma, titreme, hafıza sorunları, epilepsi takibi.
- **Kas-iskelet:** spor yaralanması, menisküs/bağ yırtığı, omuz ağrısı, kireçlenme, osteoporoz, skolyoz.
- **Üroloji:** böbrek taşı, sık idrara çıkma, idrar kaçırma, prostat, sertleşme sorunu, erkek kısırlığı.
- **Kadın sağlığı:** adet düzensizliği, menopoz, kist, rahim sarkması, gebelik takibi, smear/HPV.
- **Cilt:** akne, egzama, sedef, ben kontrolü, saç dökülmesi, terleme.
- **Estetik:** burun, göz kapağı, yüz germe, meme estetiği, liposuction, karın germe, dolgu/botoks, saç ekimi.
- **Diş:** Hollywood smile, kaplama, beyazlatma, implant, kanal, çekim, diş eti, diş sıkma/çene eklemi.
- **Onkoloji:** her kanser türü için "tanı aldım, ikinci görüş / tedavi" konuları.
- **Ruh sağlığı:** depresyon, kaygı, uyku sorunu (kırmızı bayrak olmayanlar).
- **Çocuk:** "çocuğum için" konuları. Bunlar şimdilik koordinatöre gitsin; 18 yaş altı kuralı (veli) geçerli.

**Her konu için:**
- EN/TR etiket.
- Uzmanlık ağırlıkları (canlıdaki 14 slug).
- **9 dilde 8–15 eş anlamlı.** Halk ağzı, yazım hataları ve aksansız yazımlar dahil ("bas donmesi", "basim donuyor", "dizziness", "Schwindel" gibi).
- **`targetSpecialtyHint`** (yeni, metin): Konunun bizde karşılığı olmayan doğal uzmanlığı. Örnekler: "Nöroloji / KBB", "Kardiyoloji", "Üroloji". Hasta bunu görmez; admin ve raporlar için.

**Ağırlık kuralı:**
- Bizde uygun uzmanlık yoksa ağırlık **verilmez**; konu koordinatöre gider ve `targetSpecialtyHint` dolu olur.
- Zorlama eşleme yapılmaz. Örnek: baş dönmesi → Beyin Cerrahisi **olmaz**.

**Kırmızı bayrak kapsamı genişlesin.** Mevcut 8 konuya ek olarak şunları değerlendir ve tabloda öner:
- bayılma ile göğüs ağrısı
- yüksek ateş ile ense sertliği
- gebelikte kanama veya şiddetli ağrı
- ani görme kaybı
- kusmada kan / kahve telvesi
- çocukta nefes güçlüğü
- ağır yanık
- zehirlenme

**Eş anlamlılarda kırmızı bayrak tetikleyicileri de olsun.** Örnek: "göğsüm sıkışıyor", "nefes alamıyorum".

## İş 2: Arayüz (çok konu olunca sade kalsın)
- Vücut bölgesi açıldığında ilk **12 popüler konu** çip olarak görünsün. Altında **"Daha fazla göster (N)"** olsun.
  - Popülerlik önce `sortOrder`'a göre, zamanla arama ve seçim sayısına göre belirlensin. Sayılar mevcut anonim sayaçtan gelir.
- **Arama kutusu:**
  - Bütün konuları ve 9 dildeki eş anlamlıları tarar.
  - Yazım hatası toleransı olsun (basit benzerlik; yeni paket yok).
  - En iyi 8 sonuç gösterilir.
- **Hiçbir şey bulunamazsa:** "Şikayetinizi kendi cümlelerinizle yazın, koordinatörümüz sizi doğru hekime yönlendirsin" ve serbest metin.
- Arapça (RTL) ve mobil görünüm kontrol edilsin.

## İş 3: Admin ve raporlar
- Admin katalog ekranında `targetSpecialtyHint` alanı ve buna göre filtre.
- **Yeni rapor: "Talep var, hekim yok".** Son 90 günde en çok seçilen/aranan ama koordinatöre giden konular, `targetSpecialtyHint`'e göre gruplu (örn. "Nöroloji / KBB: 34 talep"). Hangi branşta hekim alınacağına karar vermek için kullanılacak.
- **Hekim eklendiğinde** (örneğin Kardiyoloji uzmanlığı açılıp hekim atandığında): admin, ilgili `targetSpecialtyHint` konularına tek ekrandan toplu ağırlık atayabilsin ("Kardiyoloji ipucu olan 18 konuyu bu uzmanlığa bağla").

## İş 4: Seed (güvenli güncelleme)
- `seed-care-topics.ts` **yalnızca yeni konuları ekler.**
- Var olan konulara (admin düzenlemiş olabilir) dokunmaz.
- Yalnızca `--update-existing` verilirse ve kayıt seed'den beri **değişmemişse** günceller. Bunu bir hash ile kontrol et.
- Kuru çalıştırmada eklenecek, atlanacak ve güncellenecek kayıtlar ayrı ayrı listelenir.

## Testler
- 9 dilde örnek aramalar: "baş dönmesi" / "Schwindel" / "головокружение" / "دوخة" → doğru konu → koordinatör.
- Yazım hatası toleransı ("bas donmesi").
- Yeni kırmızı bayrakların ve tetikleyici eş anlamlıların çalışması.
- "Daha fazla göster".
- Seed: var olan ve admin tarafından değiştirilmiş kayda dokunulmaması.
- "Talep var, hekim yok" raporu ve toplu atama.

## Rapor
`docs/prompts/2026-10-31-W-ek-RAPOR.md` dosyasına şunları yaz: commit listesi, konu sayıları (bölge bazında), yeni kırmızı bayraklar, migration SQL, testler, canlıya alma sırası.
