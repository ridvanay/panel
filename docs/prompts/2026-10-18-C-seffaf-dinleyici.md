# Paket C: Admin kalite kontrol dinleyicisi — AÇIK ve BİLDİRİMLİ (2026-10-18)

## Çalışma şekli (ajanlar)
- **Uygulamayı ana oturum yapar.** Alt ajanlar uygulayıcı değil, **inceleyici** olarak kullanılır. Kod yazıldıktan sonra aşağıdaki ajanlar sırayla çağrılır; bulguları ana oturumda düzeltilir.
- **Testleri ana oturum KENDİSİ çalıştırır.** "qa-agent sonra test eder" diyerek test ERTELENEMEZ. Her ajan incelemesinin sonucu (bulgu / düzeltme / "sorun yok") rapora yazılır.
- Bu pakette çağrılacak ajanlar: **architect** (plan; LiveKit istisnasının sınırları), **integration-agent** (yalnızca yeni listener token ucu; mevcut token ucuna dokunulmadığını teyit), **security-agent** (ZORUNLU), **compliance-agent** (ZORUNLU; KVKK, aydınlatma metni önerisi), **qa-agent**, **code-quality-agent**.
- security-agent ya da compliance-agent "kritik" veya "yüksek" seviyede bir bulgu verirse bulgu düzeltilmeden commit YAPILMAZ.

**Mod: Tam akış.** **KIRMIZI ÇİZGİ İSTİSNASI:** Bu paket, kullanıcı onayıyla LiveKit token üretimine dokunuyor. Mevcut hasta ve doktor akışı DAVRANIŞ olarak değişmeyecek. `security-agent` ve `compliance-agent` (KVKK) incelemesi zorunlu.

**Branch:** `git fetch origin && git switch -c feature/admin-qa-listener origin/master` — başlangıç `e25b4d2` olmalı (A, A2, B, D canlıda); doğrula. Yalnızca kendi dosyalarını commit'le, push etme.

**Not:** Paket A raporuna göre backend'de saat bazlı katılım penceresi YOK (2026-09-15'te kaldırılmış). Dinleyici token'ı için `IN_PROGRESS` şartı yeterli. Hasta ve doktor token kuralını bu pakette DEĞİŞTİRME.

## İstek
ADMIN rolündeki bir kullanıcı, devam eden bir görüşmeye kalite kontrol amacıyla **dinleyici** olarak katılabilsin. Katılım **her iki tarafa da açıkça bildirilecek**. Gizli veya görünmez katılım YAPILMAYACAK; `hidden` gibi seçenekler KULLANILMAYACAK.

## Kurallar
- **Katılım yetkisi:** Yalnızca ADMIN rolü ve 2FA'sı etkin hesaplar katılabilir. Admin → Randevular ekranında, yalnızca `IN_PROGRESS` durumundaki görüşmelerde "Dinleyici olarak katıl" butonu görünsün. Katılmadan önce bir onay penceresi çıksın ve admin bir katılım gerekçesi yazsın (zorunlu).
- **Token:** Ayrı bir uç olsun (ör. `POST /admin/appointments/:id/listener-token`). Token yetkileri `canSubscribe: true`, `canPublish: false`, `canPublishData: false`. Identity `qa-listener-<userId>`; participant metadata'sında `role: "qa_listener"` olsun. Token süresi kısa tutulsun. Mevcut hasta ve doktor token ucuna DOKUNULMAYACAK.
- **Görünürlük (zorunlu):** Dinleyici odaya girdiğinde hasta ve doktorun ekranında kalıcı ve göze çarpan bir uyarı çıksın: "Kalite kontrol amacıyla yetkili bir WM Health personeli bu görüşmeyi dinliyor." Uyarı, dinleyici ayrılana kadar ekranda kalsın. Katılımcı listesinde dinleyici "WM Health – Kalite Kontrol" olarak görünsün. Bu iş `consultation-room.tsx` içinde küçük ve izole bir ekleme olarak yapılsın: `qa_listener` metadata'lı katılımcıyı algılayıp banner gösterir. Bunun dışında bu dosyada hiçbir değişiklik yapılmayacak.
- **Görüşme mantığı bozulmayacak:** Katılımcı sayısına bağlı mantıklar (iki taraf da katıldı mı, otomatik tamamlama, kayıt/egress, süre ölçümü vb.) `qa_listener`'ı YOK SAYSIN. Bunu testle kanıtla.
- **Kayıt:** Her katılım ve ayrılış audit log'a yazılsın: admin, randevu, gerekçe, giriş ve çıkış zamanı. Admin panelinde randevu detayında "Dinleyici geçmişi" görünsün.
- **Aydınlatma ve onay:** Randevu onay ekranındaki ve aydınlatma metnindeki ilgili alana şu bilgi eklensin: "Görüşmeler, kalite kontrol amacıyla yetkili personel tarafından dinlenebilir; bu durumda ekranda bildirim gösterilir." Metin önerisini compliance notuna yaz; nihai metni kullanıcı onaylayacak.

## Test ve rapor
- **Entegrasyon testleri:**
  - Manager veya doktor dinleyici token'ı alamaz.
  - `IN_PROGRESS` dışındaki bir görüşme için 409 döner.
  - Token yetkileri doğrudur (yayın yok).
  - Audit log yazılır.
- **Unit testler:** Banner `qa_listener` katılımcısı varken görünür, yokken görünmez; katılımcı sayısı mantığı dinleyiciyi saymaz.
- Ayrıca KIRMIZI ÇİZGİ testlerinin tamamı çalıştırılsın.
- Rapor: `docs/prompts/2026-10-18-C-RAPOR.md`. Security ve compliance notlarını ayrı dosyalara yaz.
