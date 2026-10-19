# Paket C — KVKK/GDPR uyumluluk notu (compliance-agent, 2026-10-19)

Kapsam: ADMIN kalite kontrol dinleyicisi. İncelenen dosyalar: `backend/src/modules/telehealth/telehealth.qa-listener.routes.ts`, `lib/livekit.ts` (createQaListenerToken, removeRoomParticipant), `lib/livekit-egress.ts`, `frontend/src/components/site/telehealth/qa-listener-notice.tsx`, `frontend/src/components/admin/telehealth/qa-listener-join-dialog.tsx`, `frontend/src/lib/legal-pages.ts`, `docs/architecture/ARCHITECTURE.md` (audit saklama maddesi).

Uyarı: Bu not hukuki tavsiye değildir; genel KVKK/GDPR ilkelerinin teknik gereksinime çevrilmesidir. Metinler ve hukuki dayanak, yayımdan önce bir hukuk danışmanınca onaylanmalıdır.

## Özet karar

- Kritik bulgu yok.
- Commit'i bloklayan yüksek bulgu yok (kod tarafı: şeffaflık, yetki, minimizasyon sağlam).
- Canlıya alma (prod aktivasyonu) kapısı olan 1 YÜKSEK bulgu var: Y1 (aydınlatma metni yayımlanmadan özellik canlıda kullanılmamalı).

## Bulgular

| # | Seviye | Bulgu | Gerekli aksiyon |
|---|---|---|---|
| Y1 | YÜKSEK (canlı kapısı, commit kapısı DEĞİL) | Sağlık verisi (özel nitelikli, KVKK m.6) içeren canlı görüşmenin üçüncü bir personelce dinlenmesi, şu an yalnızca oturum içi banner ile duyuruluyor. Önceden bilgilendirme (aydınlatma, KVKK m.10) metni CMS'e girilmeden özellik kullanılırsa hasta, görüşmeye girmeden önce bilgilendirilmemiş olur. Banner şeffaflığı tamamlar ama aydınlatmanın yerine geçmez. | Aşağıdaki §2 metni kullanıcı onaylayıp CMS'e girene kadar admin'ler özelliği prod'da kullanmamalı (operasyonel kural; rapora "açık iş" olarak yaz). Kod değişikliği gerekmez. |
| O1 | ORTA | Hasta için itiraz/ret yolu yok (bkz. §3). Dinleme, yalnızca bildirimle gerçekleşiyor; hasta "dinlenmesin" diyemiyor. | Commit'i bloklamaz. Sonraki iterasyonda en azından "dinleme sırasında odadan çıkma / dinleyiciyi reddet" önerisi (§3). İlk adım olarak aydınlatma metnindeki "itiraz için iletişim" satırı ve operasyonel süreç yeterli. |
| O2 | ORTA | `AuditLog` için proje genelinde saklama süresi YOK. ARCHITECTURE.md (~satır 1363-1366) bunu "architect backlog maddesi" olarak açıkça kaydetmiş; `backend/src` içinde `auditLog` üzerinde silme/anonimleştirme işi yok (yalnızca `create`/`findMany`). Dinleyici kayıtları (admin e-postası, IP, serbest metin gerekçe) süresiz kalır. | Politika kararı: dinleyici audit satırları için saklama süresi tanımla (öneri: 2 yıl; KESİN rakam hukuki onay gerektirir) ve bu süre dolunca silen/anonimleştiren günlük iş (emsal: `recording-retention.ts`, `support-retention.ts`). Genel `AuditLog` retention backlog'una "telehealth.qa_listener.*" notuyla ekle. Commit'i bloklamaz. |
| O3 | ORTA | Gerekçe alanı (10–500 karakter, serbest metin) PII/sağlık verisi riski taşır: yalnızca arayüzdeki ipucu ("hasta bilgisi yazmayın") korumasıdır; sunucu tarafında kısıtlama yok. Serbest metin `AuditLog.metadata.reason`'a ve "Dinleyici geçmişi"ne (ADMIN) yazılır; saklama süresi O2 nedeniyle belirsiz. | (a) Diyalogda hazır gerekçe seçenekleri (örn. "Rutin kalite örneklemesi", "Hasta/doktor şikayeti incelemesi", "Teknik sorun incelemesi", "Eğitim/denetim") + isteğe bağlı kısa not önerilir; (b) ipucu metnine "ad, TC, telefon, tanı yazmayın; randevu numarası yeterlidir" eklenmesi; (c) gerekçenin audit dışına (log aggregator'a) kopyalanmadığını observability ile teyit et (pino istek gövdesi loglaması redaksiyonu). Bloklayıcı değil. |
| D1 | DÜŞÜK | Egress (kayıt) açıkken "speaker" layout'ta dinleyici yayın yapmadığı için normalde kayıtta görünmez; ihtimal dahilinde kutucuk görünse bile kayda dinleyicinin sesi/görüntüsü girmez (yayın yok). Kayıt rızası, hasta ve doktorun sesi/görüntüsü için ayrıdır ve değişmedi. | Aydınlatma metninde "dinleyici görüşmeyi kaydetmez; kayıt yalnızca hastanın ayrı onayıyla yapılır" ifadesi yeterli. Egress'e `hidden`/özel filtre eklenmesine gerek yok. |
| D2 | DÜŞÜK | Dinleme, banner'ın gösterilmesinden hemen önce bağlantı kurma anında teknik olarak birkaç yüz ms ses akışı alabilir (katılımcı olayının istemciye ulaşma gecikmesi). Gizli katılım değil; ihmal edilebilir. | Aksiyon yok; isteğe bağlı olarak banner ayrıca `aria-live` ile okunur (zaten `role="status"`). |
| D3 | DÜŞÜK | Dinleme geçmişi hastaya/doktora gösterilmiyor (yalnızca ADMIN). Hasta KVKK m.11 kapsamında "kimlere aktarıldı/kim eriştiği" bilgisini talep edebilir. | Operasyonel süreç: talep gelirse ADMIN `listener-history` çıktısından rol bazlı (kişi adı vermeden "yetkili WM Health personeli, tarih/süre") yanıt üretir. Kod gerekmez. |

## 1. Hukuki dayanak, ölçülülük, minimizasyon, saklama

- Amaç: hizmet kalitesi denetimi ve şikayet/teknik inceleme. Amaç, banner ve metinde açıkça adlandırılıyor ("kalite kontrol"); amaç dışı kullanım için tek teknik engel rol sınırı (yalnızca ADMIN + 2FA) ve gerekçe zorunluluğudur.
- Hukuki dayanak: Görüşme içeriği sağlık verisidir (özel nitelikli). Kalite denetimi için dayanak (açık rıza mı, m.6/3 kapsamında sır saklama yükümlüsü kişilerce sağlık hizmetinin yürütülmesi/planlanması mı, meşru menfaat mi) hukuk danışmanı kararıdır. Teknik önerim: dayanak açık rıza seçilmese bile, hasta aydınlatma metni ile bilgilendirilmeli ve itiraz imkânı tanınmalıdır (O1). Bu nedenle Y1 kapısı konuldu.
- Veri minimizasyonu: İYİ. Dinleyici `canPublish=false`, `canPublishData=false`; admin arayüzü yalnızca ses çalıyor, uzak video render edilmiyor; hiçbir kayıt/transkript üretilmiyor; yeni tablo yok. Yalnızca ses yeterli kararı doğru ve ölçülü. Not: LiveKit sunucusu video track'lerini de dinleyiciye iletebilir (subscribe açık); minimizasyonu istemci katmanı sağlıyor, sunucu tarafında değil. Daha sıkı olması için ileride `canSubscribe` yerine yalnızca ses track'ine izin veren `canSubscribeMetrics`/track bazlı kısıt veya `autoSubscribe` kapalı + yalnızca audio abone olma önerilir (düşük öncelik, güvenlik/integration ajanları değerlendirsin). Bu bir hukuki açıdan "ağ seviyesinde video verisi hâlâ alınabilir" notudur.
- Ölçülülük: Token 10 dk TTL, hız sınırı 5/dk, yalnızca `IN_PROGRESS`, oturumu başlatamaz, `canUpdateOwnMetadata=false` (banner kapatılamaz), ayrılışta sunucu tarafı çıkarma. Yeterli.
- Audit içeriği (kişisel veri): admin e-postası (`actorEmail`), IP (`ipAddress`), randevu kimliği, serbest metin gerekçe, `identity` (userId içerir), oda adı. Hastaya ait ad/e-posta yazılmıyor (iyi); randevu kimliği üzerinden dolaylı ilişkilendirilebilir (kabul edilebilir). Token/URL yazılmıyor (audit.ts kuralına uygun).
- Saklama: Mevcut politika yok (O2). Öneri: 2 yıl (hukuk onayına bağlı), süre sonunda satır silinir veya `reason` + `actorEmail` + `ipAddress` anonimleştirilir (sessionId/zaman/süre istatistik için kalabilir). Hasta tarafından unutulma talebi: audit kaydı hastaya ait kişisel veri içermediğinden (randevu kimliği hariç) anonimleştirme akışına randevu kimliği bağlanmalı; mevcut hasta silme akışı bu action ailesini kapsadığını doğrulamalı.

## 2. Metin önerileri (KODA EKLENMEYECEK — kullanıcı onaylayıp CMS'e girecek)

Architect kararı doğrulandı: Aydınlatma ve açık rıza metinleri koda gömülü değil; CMS legal sayfalarından çözülüyor (`frontend/src/lib/legal-pages.ts`: `resolveKvkkConsentPage` randevu kimlik adımı onay kutusunun bağlandığı KVKK Aydınlatma sayfası; `resolveExplicitConsentPage` randevu tıbbi belge adımındaki Sağlık Verisi Açık Rıza sayfası; `resolveKvkkNoticePage` site geneli gizlilik/KVKK sayfası). Kullanılan yerler: `booking-intake-step.tsx` (açık rıza), `doctors/[slug]/page.tsx` (KVKK + açık rıza), `missing-legal-pages-alert.tsx` (admin uyarısı). Girilecek yerler:

1. CMS legal sayfası: "KVKK Aydınlatma Metni" (`isLegalDocument=true`, başlık/slug'da kvkk/aydınlatma geçmeli) — yeni paragraf (aşağıda A).
2. Aynı sayfaya veya ayrı "Sağlık Verisi Açık Rıza Metni" sayfasına, kayıt (recording) ile karışmaması için ayrı bir not (B).
3. Randevu onay ekranı: kullanıcının verdiği cümle, hasta onay adımında (rıza kutusunun yanındaki bilgi metni) CMS'ten; ayrı bir kod alanı açılırsa architect/frontend ile netleştirilecek (şu an böyle bir CMS alanı yoksa cümleyi KVKK aydınlatma sayfasının ilk paragrafına koymak ve onay kutusunun bağlandığı sayfa olarak göstermek yeterli).

Onay ekranı cümlesi (kullanıcının metni, değişmedi):
> Görüşmeler, kalite kontrol amacıyla yetkili personel tarafından dinlenebilir; bu durumda ekranda bildirim gösterilir.

A. Aydınlatma metnine eklenecek kısa paragraf (taslak):
> **Görüşmelerin kalite kontrolü.** Hizmet kalitesini ve güvenliğini denetlemek, şikayetleri ve teknik sorunları incelemek amacıyla, WM Health'in yetkili ve gizlilik yükümlülüğü altındaki bir personeli devam eden görüntülü görüşmeyi yalnızca dinleyici olarak izleyebilir. Dinleyici görüşmeye konuşmaz, görüntü veya ses yayınlamaz; böyle bir durumda hem sizin hem de doktorunuzun ekranında "Kalite kontrol amacıyla yetkili bir WM Health personeli bu görüşmeyi dinliyor." uyarısı, dinleme sona erene kadar görünür. Dinleme sırasında görüşme ayrıca kaydedilmez; görüşmenin kaydı yalnızca sizin ayrıca vereceğiniz onayla yapılır. Dinleme olayının tarihi, süresi, dinleyen personel ve gerekçesi güvenlik ve denetim amacıyla [X yıl] süreyle saklanır; görüşme içeriği bu kayıtlarda yer almaz. Bu işleme ile ilgili bilgi talep etme, itiraz etme ve KVKK m.11 kapsamındaki diğer haklarınızı kullanma başvurularınız için [iletişim adresi/e-posta] üzerinden bize ulaşabilirsiniz.

B. Açık rıza metni notu (hukuk onayı): Dinleme için ayrı açık rıza mı istenecek yoksa aydınlatma + itiraz hakkı mı yeterli, bu karar hukuk danışmanındadır. Ayrı rıza istenirse onay kutusu rıza metnine bağlanmalı, `consentAt/consentVersion` deseni (AppointmentIntake) yeniden kullanılmalı; bu yeni DB alanı gerektirir ve db-agent'a devredilir (bu pakette YAPILMADI, gerek yok).

Yer tutucular ([X yıl], [iletişim]) kullanıcı/hukuk tarafından doldurulmalı. Saklama süresi O2 kararıyla tutarlı olmalı. Yurt dışı aktarım: LiveKit kendi barındırılıyorsa (self-hosted) ek aktarım yok; LiveKit Cloud kullanılsaydı ayrı değerlendirme gerekirdi (mevcut kurulum compose ile kendi sunucusunda görünüyor; teyit edilmeli).

## 3. Hasta itiraz/ret hakkı (öneri)

- Gereksinim: Dinlemeye "hayır" demenin pratik yolu olmalı. Şu an banner kapatılamıyor ve hasta dinlemeyi reddedemiyor.
- Öneri (aşamalı):
  1. Şimdi (kod yok): Aydınlatma metninde itiraz iletişimi (A paragrafı), ve operasyonel kural: hasta itirazı destek kanalına gelirse o hastanın görüşmeleri dinlenmez; ADMIN'lere iç talimat.
  2. Sonraki iterasyon (backend + frontend, bu pakette değil): Hastaya banner üzerinde "Dinlenmesini istemiyorum" düğmesi; basınca sunucu `qa_listener` katılımcısını `removeParticipant` ile odadan çıkarır, o randevu için `qaListenerBlocked` bayrağı kaydedilir ve yeni listener-token isteği 409 döner; olay audit'e (`telehealth.qa_listener.objected`) düşer; hasta aleyhine kullanılmaz (kayıt reddi deseniyle aynı ilke). Bu db-agent (bayrak) + backend + frontend + notification kapsamı gerektirir; mevcut recording `consent_denied` deseni emsaldir.
  3. Doktor için aynı düğme düşünülmeyebilir (kurumsal denetim); karar kullanıcı/hukuk.
- Alternatif: Dinlemeyi yalnızca randevu oluştururken verilen onay (opt-in) olan görüşmelerle sınırlamak; bu, itirazı baştan çözer ama kapsamı düşürür.

## Commit öncesi gerekenler

Hiçbiri (kritik/yüksek kod bulgusu yok). Canlı kullanımdan önce: Y1 (CMS metni onaylanıp girilmeli, hukuk onayı), O2 ve O3 backlog'a kaydedilmeli.

## Teyit edilen olumlu noktalar

- Gizli katılım yok (`hidden` yok), banner kapatılamaz, kimlik/metadata istemci tarafından değiştirilemez.
- Katılım ve ayrılış audit'e yazılıyor; token/URL yazılmıyor; geçmiş yalnızca ADMIN'e açık (route hook `ROLES_ADMIN`).
- Yeni tablo/kolon yok; yeni kişisel veri toplanmıyor (yalnızca mevcut `AuditLog`). `DATA_INVENTORY.md` bu repoda bulunmuyor; envanter güncellemesi ayrı iş olarak: AuditLog satırlarına "telehealth.qa_listener.*" (actorEmail, ipAddress, reason) eklenmeli.
