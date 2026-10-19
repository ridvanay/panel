# Paket I: Dinleyici uyarısı EN sürümü ve Node 22 test düzeltmesi (2026-10-19)

**Hızlı Mod geçerli** (`.claude/CLAUDE.md`). Ajanlar yalnızca inceleyici. Testleri ana oturum dosya dosya, sırayla çalıştırır.

## Başlangıç
- `origin/master` (`731e7ac`) üzerinden `fix/listener-en-test-oct19` branch'i aç. Yerel master eski, onu kullanma.
- Push etme.
- İki ayrı commit at.

## KIRMIZI ÇİZGİ: Bu dosyalara dokunulmayacak
- `consultation-room.tsx`
- `lib/livekit.ts`, `lib/livekit-egress.ts`, meeting-token, kayıt
- docker-compose, Dockerfile'lar, Nginx, `.env`
- Prisma şeması ve migration'lar (bu pakette migration olmayacak)
- `package.json` ve `package-lock.json`

## İş 1: Dinleyici uyarısının İngilizce sürümü
**Dosya:** yalnızca `frontend/src/components/site/telehealth/qa-listener-notice.tsx` (ve gerekirse bu dosyanın kendi testi).

**Sorun:** `QaListenerBanner` metni sabit Türkçe veriyor. İngilizce sitede de hasta bu uyarıyı Türkçe görüyor.

**Yapılacaklar:**
- Banner'ın dili, bileşenin **kendi içinde** `useActiveLocaleCode()` ile belirlensin (`@/context/locale-alternates-context`). `consultation-room.tsx` zaten bu bağlamı kullanıyor. Bileşene prop **eklenmeyecek**, çünkü `consultation-room.tsx` değişmeyecek.
- Metinler hukuk onayından geçti, birebir kullanılacak:
  - **TR (mevcut):** "Kalite kontrol amacıyla yetkili bir WM Health personeli bu görüşmeyi dinliyor."
  - **EN:** "An authorised WM Health staff member is listening to this consultation for quality control purposes."
  - **Alt satır, TR:** "Katılımcı: WM Health – Kalite Kontrol"
  - **Alt satır, EN:** "Participant: WM Health – Quality Control"
- **Dil seçimi:** Locale kodu `en` ile başlıyorsa İngilizce, diğer her durumda Türkçe gösterilecek. Bağlam yoksa ya da hata verirse Türkçe gösterilecek; uyarı hiçbir koşulda kaybolmamalı.
- **Dokunulmayacaklar:** `QA_LISTENER_NOTICE_TEXT`, `QA_LISTENER_DISPLAY_NAME`, `QA_LISTENER_IDENTITY_PREFIX` ve `isQaListenerParticipant` aynen kalacak. Bunlar admin tarafında ve testlerde kullanılıyor olabilir; grep ile kontrol et.
- Kapatma düğmesi eklenmeyecek, `role="status"` korunacak.
- **Test:** TR ve EN locale'de doğru metnin göründüğünü, bağlam yokken de Türkçe metnin göründüğünü doğrula.

## İş 2: `reports-export-download` testinin Node 22 kırığı
**Dosya:** yalnızca `frontend/tests/unit/reports-export-download.test.ts`. Gerekirse test setup'ı da değişebilir, ama yalnızca bu dosyayı etkileyecek şekilde.

**Sorun:** Node 22'de 1 test `object.stream is not a function` hatasıyla düşüyor. Node 20'de bu dosyadaki testler hiç koşmuyordu.

**Yapılacaklar:**
- Kök nedeni bul. Muhtemelen test ortamındaki Blob/Response polyfill'i ile Node 22'nin yerleşik Blob'u çakışıyor.
- **Testi düzelt.** Uygulama kodu ancak gerçek bir hata varsa değişebilir. Bu durumda önce gerekçeyi rapora yaz ve dur.
- `skip` veya `todo` ile susturmak **yasak**.
- Düzeltmeden sonra testi Node 22 ile tek başına koştur, ardından frontend birim testlerini sırayla koştur.

## İnceleme
`frontend-agent` ve `security-agent` (hangisi varsa) yalnızca diff'i incelesin. Bitirmeden şu komutu çalıştır:
```
git diff origin/master --stat
git diff origin/master -- frontend/src/components/site/telehealth/consultation-room.tsx backend docker-compose.yml
```
İkinci komutun çıktısı **boş** olmalı.

## Rapor
`docs/prompts/2026-10-19-I-RAPOR.md` dosyasına şunları yaz:
- commit listesi
- değişen dosyalar
- test sonuçları
- iş 2'nin kök nedeni

Canlıya alma: migration yok, yalnızca frontend yeniden derlenir. Backend ve LiveKit yeniden başlatılmaz.
