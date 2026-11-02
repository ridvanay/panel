# Paket AG: Alt uzmanlık, admin randevu bildirimi, harici toplantı bağlantısı (2026-11-02)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar. Push etme. E2E headless (`E2E_HEADLESS=1`).

## Başlangıç
- **Sıra:** Blog parti 6–7 (51–70) bitip raporlandıktan sonra başla. Yarıda bırakma.
- Ana klasörde çalış, yeni worktree açma. `git fetch`, ardından güncel `origin/master` üzerinden `feat/ag-specialty-notify-meeting-nov02` dalını aç.
- Commit'lenmemiş dosyalara (`.claude/…`, `design/`) dokunma.

## Kırmızı çizgi
- Ödeme ve randevu oluşturma kuralları, compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/` değişmez.
- Yeni npm paketi yok.
- Migration yalnızca ekleme yapar.
- `consultation-room.tsx` ve mevcut görüşme token kuralları (`meeting-token`, erken katılım, TTL, grant'lar) **değişmez.**
- İş 3 için kullanıcı onaylı **sınırlı istisna** aşağıda tanımlı; önce tasarım raporu, onaydan sonra kod.

---

## İş 1: ESD, ERCP ve POEM, Gastroenterology'nin alt uzmanlığı olsun
Şu an bu üçü ayrı birer uzmanlık olarak görünüyor (menü, uzmanlık sayfaları, sihirbaz, filtreler). İstenen: **Gastroenterology'nin altında** listelenmeleri.
- **Veri:** `Specialty` tablosuna `parentId` (kendine referans, nullable) eklenir. Migration yalnızca ekleme yapar.
  - Canlıdaki `esd`, `ercp` ve `poem` kayıtlarını `gastroenterology` altına bağlayan idempotent bir script yaz: `backend/scripts/set-specialty-parents.ts`. Kuru çalışma varsayılan; gerçek çalıştırma `--confirm=set-specialty-parent --operator=...`; yedek ve `--restore` desteği olur.
  - Kayıtlar silinmez; slug'lar ve URL'ler değişmez.
- **Admin:** Uzmanlık formunda "Üst uzmanlık" seçimi.
  - Yalnızca tek seviye olur; alt uzmanlığın altına başka alt uzmanlık eklenemez.
  - Bir uzmanlık kendi alt uzmanlığına bağlanamaz (döngü engeli).
- **Ziyaretçi tarafı:**
  - **Header "Specialties" menüsü:** Alt uzmanlıklar üst seviyede ayrı kart olarak görünmez; Gastroenterology'nin altında (girintili ya da "Procedures: ESD · ERCP · POEM" satırı) görünür.
  - **Uzmanlıklar sayfası ve ana sayfa kartları:** Yalnızca üst uzmanlıklar listelenir. Gastroenterology sayfasında "Procedures" bölümü, alt uzmanlıklara bağlantı verir.
  - **Alt uzmanlık sayfası** (`/specialties/esd` vb.): Açılmaya devam eder. Breadcrumb `Specialties › Gastroenterology › ESD` olur. Hekim yoksa üst uzmanlığın hekimleri "Physicians performing this procedure" başlığıyla listelenir.
  - **Blog "Browse by specialty" ve filtreleri:** Yalnızca üst uzmanlıklar listelenir. Alt uzmanlığın yazıları üst uzmanlıkta da sayılır.
  - **Hekim eşleştirme sihirbazı (W):** Mevcut konu ağırlıkları değişmez. Sonuçta alt uzmanlık çıkarsa üst uzmanlığın hekimleri de önerilir.
- **SEO:** sitemap ve hreflang aynı kalır. Alt uzmanlık sayfasına `BreadcrumbList` JSON-LD eklenir.
- 9 dil, RTL.

## İş 2: Her randevuda admin@wmhealthistanbul.com adresine bildirim
- Herhangi bir hekime randevu oluştuğunda (ödeme veya onay akışında randevunun kesinleştiği an) bildirim e-postası gider. Varsayılan alıcı `admin@wmhealthistanbul.com`.
  - Önce mevcut admin bildirimlerini incele (Paket AC envanteri). Varsa yeniden kullan, yoksa ekle.
- **Ayar:** Admin → Ayarlar'da "Randevu bildirimi alıcıları" alanı.
  - Virgülle ayrılmış birden çok adres girilebilir; her adres doğrulanır.
  - Alan boşsa bildirim gitmez.
  - Varsayılan değer migration/seed ile değil, ayar boşken kodda varsayılan olarak verilir.
- **İçerik** (kurumsal şablon, `renderBrandedEmail`; dil EN, istenirse admin dili):
  - Konu: `New appointment #<no> — <hekim unvan + görünen ad> — <tarih saat (Europe/Istanbul)>`
  - Gövde:
    - randevu no
    - hekim
    - tarih ve saat (İstanbul ve hastanın saat dilimi)
    - süre
    - görüşme dili
    - tercüman var/yok
    - paket varsa paket adı
    - ödeme durumu
  - **"Randevuyu aç" düğmesi:** Admin panelindeki randevu detayına giden mutlak https bağlantısı. Oturum yoksa giriş sayfasına, girişten sonra randevuya döner (mevcut `next`/`redirect` parametresi).
  - **Gizlilik:** Hasta adı, e-postası, telefonu, şikâyeti ve hiçbir sağlık bilgisi e-postada **yer almaz.** Mevcut AC kuralı korunur. Bu bilgiler yalnızca bağlantıdan, oturum açmış adminle görülür.
- **Ek olaylar:** İptal ve saat değişikliğinde aynı alıcılara kısa bildirim gider ("Appointment #<no> cancelled / rescheduled").
- **Güvenilirlik:**
  - Gönderim mevcut e-posta kuyruğu/yeniden deneme mekanizmasıyla yapılır.
  - E-posta hatası randevu akışını **asla** bozmaz.
  - Aynı olay için çift gönderim olmaz (idempotent anahtar).
- **Testler:**
  - ödeme sonrası randevuda tek e-posta
  - iptal ve saat değişikliği bildirimleri
  - alıcı ayarı boşsa e-posta yok
  - içerikte hasta adı veya sağlık bilgisi yok
  - bağlantı doğru ve oturum yönlendirmesi çalışıyor
  - e-posta hatasında randevu yine oluşuyor

## İş 3: Admin'in yetkilendirdiği kullanıcı harici toplantı bağlantısı oluşturabilsin
**Önce yalnızca tasarım raporu yaz ve dur.** Kod, kullanıcı onayından sonra yazılır.

Amaç: Randevuya bağlı olmayan görüntülü toplantılar. Örnekler: hasta koordinatörünün ön görüşmesi, hekimler arası konsültasyon, kurum dışı katılımcıyla toplantı. Admin bu yetkiyi seçtiği kullanıcılara verir.

**Önerilen tasarım** (rapor bunun üzerinden; farklı önerin varsa gerekçesiyle yaz):
- **Yetki:** Admin, kullanıcı yönetiminde seçtiği kullanıcıya "Harici toplantı oluşturabilir" yetkisi verir veya geri alır. Adminler bu yetkiye her zaman sahiptir. Yetki değişiklikleri audit log'a yazılır.
- **Oluşturma** (yetkili kullanıcının panelinde "Toplantılar" sayfası):
  - başlık, tarih/saat ve süre (en çok 2 saat)
  - katılımcı sayısı sınırı (varsayılan 4, en çok 8)
  - isteğe bağlı not
- **Bağlantılar:**
  - **Ev sahibi bağlantısı:** oluşturana özel, oturum gerektirir.
  - **Misafir bağlantısı:** tek paylaşılabilir imzalı bağlantı, oturum gerektirmez.
  - Misafir girişte adını yazar. Ev sahibi gelene kadar bekleme ekranında kalır (ya da ev sahibi "misafirleri doğrudan al" seçeneğini açar).
  - Bağlantı yalnızca toplantı penceresinde çalışır: başlangıçtan 15 dk önce açılır, bitişten sonra kapanır. Ev sahibi bağlantıyı iptal edebilir.
- **Görüşme:**
  - Ayrı bir oda adı öneki (`meet_…`) kullanılır.
  - **Kayıt yok.**
  - AF'deki oda arayüz bileşenleri (ad etiketleri, kontrol çubuğu, yeniden bağlanma, cihaz testi) yeniden kullanılır. Görüşme odası (`consultation-room.tsx`) **değiştirilmez**; ayrı ve hafif bir `meeting-room` bileşeni yazılır.
  - Ekran paylaşımı yalnızca ev sahibine açıktır.
- **Kayıtlar:** Toplantı oluşturma, katılma ve iptal audit log'a düşer. Misafir için yalnızca girdiği ad ve saat tutulur; e-posta veya telefon toplanmaz.
- **İsteğe bağlı:** Misafir bağlantısını e-postayla gönderme düğmesi (kurumsal şablon).
- **Kullanıcı onaylı sınırlı istisna** (yalnızca iş 3 için ve tasarım onaylandıktan sonra):
  - Yeni toplantı token ucu ve bu uca özel grant'lar.
  - Yeni `meeting-room` bileşeni.
  - Mevcut görüşme token'ı, `consultation-room.tsx`, egress, LiveKit sunucu ayarları, compose ve Nginx **değişmez.**

**Tasarım raporu** (`docs/prompts/2026-11-02-AG-IS3-TASARIM.md`) şunları içerir:
- veri modeli (migration yalnızca ekleme)
- uç noktalar
- token grant'ları ve süreleri
- yetki kontrolü
- güvenlik: imzalı bağlantı, kaba kuvvet ve oran sınırı, bilgi sızıntısı
- ekran akışı
- test listesi
- tahmini iş büyüklüğü
- açık sorular

---

## Rapor
`docs/prompts/2026-11-02-AG-RAPOR.md` dosyasına iş 1 ve iş 2 için şunları yaz:
- commit listesi
- migration SQL
- script'in kuru çalışma çıktısı (yerelde)
- ekran görüntüleri: header menüsü, uzmanlıklar sayfası, Gastroenterology sayfası, ESD sayfası, admin uzmanlık formu, örnek bildirim e-postası (EN, masaüstü ve mobil) → `docs/prompts/2026-11-02-AG-ekran/`
- testler
- canlıya alma sırası

İş 3 için yalnızca tasarım raporu yazılır.

**İş 1–2 bitince ve iş 3 tasarımı yazılınca dur, onay bekle.**
