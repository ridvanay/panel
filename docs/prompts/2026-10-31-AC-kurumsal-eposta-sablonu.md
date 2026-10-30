# Paket AC: Bütün e-postalar için kurumsal şablon (logo, footer, KVKK) (2026-10-31)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar.

## Başlangıç
- `origin/master` üzerinden `feat/email-branding-oct31` dalını aç. Push etme.
- Başka bir iş açıksa (W-ek) ayrı bir worktree kullan.

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, ödeme ve randevu kuralları değişmez. Yalnızca e-posta **görünümü** değişir; ne zaman ve kime gittiği değişmez.
- compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/` değişmez.
- Yeni npm paketi yok.
- Migration yalnızca ekleme yapar; büyük ihtimalle gerekmez.

## Sorun
- Hekim eşleştirme onay e-postası ("Talebinizi aldık #2") düz metin olarak gidiyor. Logo, kurum bilgisi, KVKK bağlantısı ve iletişim bilgisi yok.
- `backend/src/lib/email-renderer.ts` içinde logo başlığı ve zorunlu KVKK footer'ı olan bir yapı var. Ama `matcher-notifications.ts` ve büyük ihtimalle başka modüller `sendMail`'i ham HTML ile çağırıyor ve bu yapıyı kullanmıyor.

## İş 1: Envanter
- `sendMail(` çağrılarının hepsini listele (yaklaşık 12 dosya). Her biri için şunları rapora yaz:
  - hangi e-posta (hasta onayı, randevu, hatırlatma, şifre sıfırlama, tercüman ataması, doktor bildirimi, admin bildirimi, CRM)
  - alıcı türü
  - kurumsal şablonu kullanıyor mu
  - kaç dilde gidiyor

## İş 2: Ortak kurumsal düzen
Hiçbir e-posta ham HTML ile gitmemeli. Hepsi ortak bir düzenden geçmeli: `renderBrandedEmail({ locale, preheader, title, bodyHtml, cta?, audience })`.
- **Başlık:**
  - Site logosu: `SiteSettings.logoUrl`, mutlak **https** adresiyle, `width/height` ve alt metniyle. Logo yoksa yalnızca metin olarak "WM Health Istanbul".
  - Marka rengiyle ince bir üst şerit.
- **Gövde:**
  - Tablo tabanlı, en fazla 600 px genişlik, satır içi CSS (Gmail, Outlook ve Apple Mail uyumlu).
  - `dir="rtl"` desteği (Arapça).
  - Okunaklı tipografi; birincil düğme (bulletproof button).
- **Gizli önizleme metni (preheader).**
- **Footer** (her e-postada, 9 dilde):
  - Kurum adı ve şehir. Kaynak: site ayarları; adres ve telefon eksikse o satır çıkmaz.
  - İletişim: `info@` ve sitenin iletişim sayfası bağlantısı.
  - "Kendi dilinizde ücretsiz destek" satırı. Yalnızca Paket V ayarı açıksa çıkar.
  - **KVKK aydınlatma metni** ve **gizlilik** bağlantıları. Mevcut zorunlu KVKK footer'ı yeniden kullanılır ve alıcının dilindeki yasal sayfaya gider. TR/EN dışındaki dillerde EN sayfasına gider.
  - "Bu e-posta otomatik gönderilmiştir" notu.
  - Hasta e-postalarına ek not: "Acil durumda 112'yi arayın".
  - Pazarlama değil işlem e-postası olduğu için abonelik iptal bağlantısı **gerekmez**. Bu kararı rapora yaz.
- **Düz metin sürümü:** Her e-postanın `text/plain` alternatifi de üretilsin (spam puanı için).
- **Admin ve doktor bildirimleri:** Aynı düzen, ama daha sade bir footer.
  - Bu e-postalarda **hasta adı, şikayet ve sağlık bilgisi bulunmaz.** Mevcut kural korunur.

## İş 3: Uygula
- İş 1'de listelenen e-postaların **hepsini** yeni düzene geçir:
  - hekim eşleştirme
  - randevu onayı ve hatırlatmaları
  - şifre sıfırlama ve doğrulama
  - tercüman bildirimleri
  - doktor ve admin bildirimleri
  - CRM bildirimleri
- E-posta metinleri değişmez, yalnızca kabuk değişir. Eksik dil varsa ekle.
- Admin'deki `EmailTemplate` (blok tabanlı) e-postalar zaten kendi yapısını kullanıyorsa ikisi aynı görünümde olsun.
- **Gönderen adı:** `"WM Health Istanbul" <info@wmhealthistanbul.com>`. `Reply-To` olarak destek adresi kullanılsın.

## İş 4: Önizleme
- Admin → E-posta Şablonları'nda **"Sistem e-postaları önizleme"** sekmesi olsun. Her sistem e-postası 9 dilde örnek veriyle görüntülenebilsin.
- Bir de "Kendime test gönder" düğmesi olsun; e-posta oturum açmış adminin adresine gider.

## Testler
- Her sistem e-postası için snapshot testi: TR, EN ve AR (RTL).
- Logo yokken metin başlığa düşüyor.
- Footer'da KVKK bağlantısı alıcının dilinde.
- `text/plain` sürümü üretiliyor.
- Admin ve doktor bildirimlerinde hasta adı ve sağlık bilgisi **yok**.
- Tek `sendMail` çağrısı bile ham HTML ile kalmamış (statik tarama testi).

## Rapor
`docs/prompts/2026-10-31-AC-RAPOR.md` dosyasına şunları yaz:
- envanter tablosu
- önce/sonra ekran görüntüleri (Gmail genişliğinde ve mobilde, `docs/prompts/2026-10-31-AC-ekran/`)
- testler
- canlıya alma sırası (backend + frontend)
