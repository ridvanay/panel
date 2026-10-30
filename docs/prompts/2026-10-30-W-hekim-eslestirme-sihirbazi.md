# Paket W: "Find My Physician" eşleştirme sihirbazı (2026-10-30)

**Hızlı Mod geçerli.** Testler sıralı koşar. **Bütün cevaplarını ve raporunu Türkçe yaz.**

## Başlangıç
- Paket V canlıya alındıktan sonra `origin/master` üzerinden `feat/physician-matcher-oct30` dalını aç. Push etme.
- Mevcut yapılar yeniden kullanılsın:
  - `CrmLead`
  - CRM onayı (`CrmConsent`)
  - iletişim formunun hız sınırı ve honeypot'u
  - `Specialty`, `DoctorProfile`, `DoctorAdditionalSpecialty`
  - müsaitlik API'si
  - Paket R'nin çift saat bileşenleri

## KIRMIZI ÇİZGİ
- `consultation-room.tsx`, LiveKit, meeting-token, kayıt, egress
- Ödeme kuralları
- **Randevu oluşturma kuralları:** Sihirbaz randevu **oluşturmaz**, yalnızca doktorun mevcut randevu sayfasına yönlendirir.
- docker-compose, Dockerfile'lar, Nginx, `.env`, `docs/legal/`
- Yeni npm paketi yok.
- Migration yalnızca ekleme yapar.
- **Tanı koyma yok.** Sihirbaz yalnızca "hangi uzmanlık alanı ve hangi hekim" önerir. Hastalık adı tahmini, olasılık, tedavi önerisi üretmez. Yapay zekâ ya da dış API kullanılmaz; eşleştirme kural tabanlıdır ve admin'den yönetilir.

---

## İş 1: Veri modeli (yalnızca ekleme)

**`CareTopic`** (şikayet/ihtiyaç kataloğu):
- `slug`
- `bodyArea`: head, neck-spine, chest, abdomen, pelvis-urology, women, skin-aesthetic, dental, joints-bones, general-checkup, cancer, mental-wellbeing, other
- `translations`: `{ [dil]: { label, description, synonyms: string[] } }`
- `isRedFlag`: acil belirtileri
- `isActive`, `sortOrder`

**`CareTopicSpecialty`:**
- `topicId`, `specialtyId`
- `weight` (1–100)

`CrmLeadChannel` enum'una **`MATCHER`** değeri eklenir. Talebin ayrıntıları için yeni bir tablo:

**`MatcherSubmission`:**
- `leadId`
- `topicIds[]`, `freeText`
- `ageBand` ya da `birthYear`
- `forWhom`: self / relative
- `duration`, `preference`: online / in-person / either
- `preferredLanguage`, `country`, `timeZone`
- `recommendedSpecialtyIds[]`, `recommendedDoctorIds[]`
- `consentHealthAt`, `consentContactAt`
- `anonymizedAt`, `createdAt`

## İş 2: Katalog seed'i (`backend/scripts/seed-care-topics.ts`)

- Kuru çalışma varsayılan, `--confirm=seed-care-topics`, idempotent.
- **Yaklaşık 80 yaygın şikayet ya da ihtiyaç**, mevcut ve V paketindeki yeni uzmanlıklara ağırlıkla eşlenir. Örnekler:
  - mide fıtığı / reflü
  - boyun ağrısı, bel fıtığı
  - diş apsesi, diş eti çekilmesi, implant
  - meme kitlesi, rahim miomu, kısırlık
  - böbrek taşı, prostat
  - akciğerde nodül, göğüs duvarı
  - baş ağrısı / migren, beyin tümörü şüphesi
  - check-up, kanser taraması, obezite
  - estetik: dolgu/botoks, burun estetiği
  - longevity / sağlıklı yaşlanma
- Her konu için EN etiket ve **her dilde eş anlamlılar** olsun (halk ağzı dahil). Örnekler:
  - TR "mide yanması"
  - DE "Sodbrennen"
  - AR "حرقة المعدة"
  - RU "изжога"
- 9 dil eş anlamlıları seed dosyasında doğrudan yer alsın. Bu kısa terimler export/import'a girmez.
- **Kırmızı bayrak konuları** (`isRedFlag=true`):
  - göğüs ağrısı ile nefes darlığı
  - inme belirtileri (yüzde kayma, konuşma bozukluğu, kolda güçsüzlük)
  - şiddetli kanama
  - bilinç kaybı
  - ani şiddetli baş ağrısı
  - intihar düşüncesi
- Kırmızı bayrak konuları uzmanlığa eşlenmez.
- Bütün eşleme tablosunu `docs/prompts/2026-10-30-W-eslesme-tablosu.md` dosyasına yaz. **Hekim kontrolüne sunulacak.**

## İş 3: Sihirbaz akışı

**Erişim noktaları:**
- Anasayfa hero'da büyük arama kutusu: "What do you need help with?", yer tutucu "e.g. neck pain, hiatal hernia, dental abscess"
- Header'da "Find my physician" düğmesi
- Uzmanlık sayfaları, blog yazıları (Z paketi) ve 404 sayfası

Ayrı bir sayfa: `/[lang]/find-a-physician`. Ayrıca sayfa içi modal sürümü. URL adım bilgisini taşır (geri tuşu çalışır), **kişisel veri URL'ye girmez.**

**Adımlar** (ilerleme çubuğu, geri dön, her adım tek ekran, mobil öncelikli):

1. **Şikayet/ihtiyaç**
   - Otomatik tamamlamalı arama: aktif dil ve EN eş anlamlıları üzerinden, aksan ve büyük/küçük harf duyarsız, Türkçe İ/ı kuralları geçerli.
   - Arama kutusunun altında vücut bölgesi kartları (ikonlu) ve her birinin altında konu çipleri.
   - Birden çok seçim yapılabilir (en çok 3).
   - "Listede yok, kendim yazayım" serbest metin alanı (en çok 500 karakter).
   - **Kırmızı bayrak seçilir ya da serbest metinde eşleşirse** akış durur ve tam ekran acil uyarısı çıkar: "Bu belirtiler acil olabilir. Lütfen hemen bulunduğunuz ülkenin acil numarasını arayın (Türkiye 112, AB 112, ABD 911, BK 999)." Kullanıcının ülkesine göre numara vurgulansın (Paket R ülke tanıma). Devam etmek için "Acil değil, devam et" onayı gerekir; bu seçim kayda geçer.
2. **Kimin için ve süre:** kendim / yakınım; "Ne zamandır?" (1 haftadan az, 1–4 hafta, 1–6 ay, 6 aydan fazla); daha önce tanı konmuş mu (evet/hayır/bilmiyorum).
3. **Tercihler:**
   - online görüşme / İstanbul'da tedavi / farketmez
   - görüşme dili (aktif dil önseçili)
   - ülke ve saat dilimi (Paket R'deki otomatik öneri)
4. **İletişim bilgileri:**
   - Alanlar: ad soyad, yaş (ya da doğum yılı), e-posta ve/veya telefon (en az biri; telefon ülke kodlu), ülke.
   - 18 yaş altı: "Lütfen veli/vasi olarak doldurun" notu ve veli adı alanı.
   - **İki ayrı onay kutusu, ikisi de varsayılan işaretsiz:**
     - (a) Sağlık verimin işlenmesine açık rıza → bağlantı mevcut açık rıza sayfası
     - (b) Benimle iletişime geçilmesine izin
   - (a) olmadan sağlıkla ilgili alanlar (`topicIds`, `freeText`) **kaydedilmez.**
   - Admin ayarı `matcherContactRequired` (varsayılan **true**). `false` ise bu adım "Sonuçlardan sonra" opsiyonel olur.
5. **Sonuç:**
   - Önerilen uzmanlık(lar), kısa açıklamayla.
   - **3 hekim kartı.** Sıralama kuralı rapora yazılsın:
     - birincil uzmanlık eşleşmesi > ek uzmanlık
     - hastanın dilini konuşan
     - en yakın müsait slot
     - kurucu önceliği yok, kural şeffaf
   - Her kartta:
     - fotoğraf, ad (V/U paketlerindeki görünen ad kuralı), unvan, uzmanlık
     - konuştuğu diller
     - en yakın müsait 3 slot (Paket R çift saat gösterimi)
     - **"Book with Dr. X"** → doktorun randevu sayfası. URL'ye yalnızca `?topic=<slug>&from=matcher` eklenir.
     - "View profile"
   - Altta:
     - "Let a coordinator call me" → lead durumunu "callback" yapar
     - "Chat on WhatsApp" (X paketinden sonra)
     - "Change answers"
   - Eşleşme yoksa: "Koordinatörümüz size en uygun hekimi 1 iş günü içinde bildirsin" ve lead oluşur.
   - Sayfa altında sabit not: "This tool does not provide a diagnosis or medical advice."

## İş 4: Backend

- `GET /api/v1/matcher/topics?lang=`: katalog (önbellekli).
- `POST /api/v1/matcher/recommend`: yalnızca konu ID'leri ve tercihleri alır, kişisel veri almaz. Uzmanlık ve hekim önerisi döndürür. Kaydetmez.
- `POST /api/v1/matcher/submit`:
  - Lead ve `MatcherSubmission` oluşturur.
  - Hız sınırı, honeypot, `zod` doğrulaması.
  - Telefon E.164.
  - Serbest metinde HTML temizlenir.
- **Bildirim:**
  - Admin/koordinatöre e-posta: mevcut `EmailTemplate` sistemi, yeni şablon `matcher.new_lead`. **E-postada şikayet metni yer almaz**, yalnızca "Yeni eşleştirme talebi #123" ve admin bağlantısı.
  - Kullanıcıya onay e-postası (dilinde).
- **CRM:** Lead listesinde "Matcher" kanalı ve filtresi. Lead detayında sihirbaz cevapları ayrı kartta, yalnızca CRM yetkili rollere görünür. Görüntüleme audit log'a düşer.
- **Saklama:** Admin ayarı `matcherRetentionDays` (varsayılan 365). Süre dolunca `MatcherSubmission` sağlık alanları anonimleştirilir (gece işi). Mevcut CRM anonimleştirme deseni kullanılır.
- **CRM olayları** (yalnızca CRM onayı varsa): `matcher_start`, `matcher_step`, `matcher_red_flag`, `matcher_result`, `matcher_book_click`, `matcher_submit`. Kişisel veri olay içine girmez.

## İş 5: Admin

**"Eşleştirme kataloğu" ekranı:**
- konu ekle/düzenle
- dil sekmeleri, eş anlamlılar
- uzmanlık ağırlıkları
- kırmızı bayrak işareti
- aktif/pasif
- canlı önizleme ("Bu terimi yazınca şu uzmanlıklar çıkar")

**Raporlar:**
- en çok aranan terimler
- eşleşmeyen serbest metinler (anonim, yalnızca terim sıklığı)
- adım bazında terk oranı

## İş 6: Tasarım
- Kart tabanlı, yumuşak geçişli, sitenin mevcut tasarım tokenleri.
- `prefers-reduced-motion` desteği.
- Klavye ile tam kullanım ve ekran okuyucu etiketleri.
- RTL (Arapça) düzeni.
- Mobilde alt sabit "Continue" düğmesi.
- Ekran görüntüleri (360 px ve 1440 px, EN/TR/AR) `docs/prompts/2026-10-30-W-ekran/`.

## Testler
- **Arama:** 9 dilde eş anlamlı eşleşmesi (TR "mide yanması", DE "Sodbrennen", AR, RU örnekleri). İ/ı ve aksan.
- **Kırmızı bayrak:** seçimde ve serbest metinde acil ekranı; ülkeye göre numara.
- **Öneri sıralaması:** dil, uzmanlık, müsaitlik. Eşleşme yoksa koordinatör yolu.
- **Rıza:** (a) yoksa sağlık alanları kaydedilmez; (b) yoksa iletişim izni yok olarak işaretlenir.
- **Güvenlik:** URL'de ve CRM olaylarında kişisel veri olmadığı; hız sınırı; bildirim e-postasında şikayet metni olmadığı.
- **Saklama:** süre dolunca anonimleştirme.
- Randevu sayfasına yönlendirme parametreleri.
- Sözlük eşitliği (9 dil).

## İnceleme
- `security-agent`, `compliance-agent` (sağlık verisi, açık rıza, saklama), `frontend-agent` ve `db-agent` incelesin.
- Kırmızı çizgi kontrolü (V paketindeki komut) boş olmalı. Migration SQL'i rapora konsun.

## Rapor
`docs/prompts/2026-10-30-W-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- eşleme tablosu dosyası
- sıralama kuralı
- **hukuk kontrolü gereken metinler** (rıza cümleleri, acil uyarısı, "tanı değildir" notu; 9 dil)
- ekran görüntüleri
- testler
- canlıya alma sırası (yedek → migrate → backend → frontend → `seed-care-topics` kuru/gerçek → kontrol)
