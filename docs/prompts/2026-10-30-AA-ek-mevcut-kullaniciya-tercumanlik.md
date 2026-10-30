# Paket AA-ek: Var olan kullanıcıya tercümanlık yetkisi (2026-10-30)

**Bütün cevaplarını ve raporunu Türkçe yaz.** Testler sıralı koşar.

## Başlangıç
- W paketi üzerinde çalışıyorsan W'yi bırakma. Bu işi **ayrı bir worktree'de** yap: `origin/master` (`9807bfd`) üzerinden `fix/interpreter-existing-users-oct30` dalı. Push etme. Bitince W'ye dön.
- Kırmızı çizgiler Paket AA ile aynı. **Bu işte `consultation-room.tsx`, `livekit.ts` ve egress değişmez.**
- Migration gerekirse yalnızca ekleme yapar. Büyük ihtimalle gerekmez.

## Sorun
Şu an tercüman yalnızca yeni bir e-postayla, `INTERPRETER` rollü ayrı bir hesap olarak açılabiliyor. Sitede kayıtlı biri (personel, admin ya da hasta) tercüman yapılamıyor; "Bu e-posta adresi zaten kayıtlı" hatası çıkıyor.

## İstenen
**Tercümanlık bir rol olmaktan çıkıp yetki (capability) olacak.**
1. **Yetki kaynağı `InterpreterProfile` olacak:**
   - Kişi şu üç koşul birlikte sağlanırsa tercüman sayılır:
     - kendisine ait `InterpreterProfile.isActive=true` kaydı var,
     - `confidentialityAcceptedAt` dolu,
     - hesabında 2FA açık.
   - Kullanıcının mevcut rolü (`ADMIN`, personel, `PATIENT`, `DOCTOR` vb.) **değişmez.** O rolün bütün mevcut yetkileri aynen kalır.
   - `INTERPRETER` rolü yalnızca "sadece tercüman" olan yeni hesaplar için kullanılmaya devam eder.
   - Tercüman token'ı, tercüman paneli, katılım ve ayrılış uçlarındaki yetki kontrolleri rol yerine bu koşula bakmalı.
   - Mevcut "yeni hesap + davet" akışı aynen çalışmalı.
2. **Admin → Tercümanlar ekranı:**
   - **"Var olan kullanıcıdan ekle"** sekmesi: e-posta veya adla arama yapılır. Sonuçta kullanıcının adı, e-postası ve **mevcut rolü** görünür.
   - Seçilen kullanıcı için profil formu açılır: görünen ad, diller, saat dilimi, not.
   - Onay penceresinde şu metin yer alır: "Bu kullanıcı mevcut yetkilerini koruyarak tercüman olarak görüşmelere atanabilecek."
   - Audit kaydı: `interpreter.profile_created_for_existing_user` (kullanıcı ID'si ve rolü; e-posta yok).
   - Yeni hesap formunda e-posta zaten kayıtlıysa hata yerine şu yönlendirme çıkar: "Bu e-posta kayıtlı. Var olan kullanıcıdan ekle sekmesinden tercümanlık verebilirsiniz."
   - Kullanıcı daha önce INTERPRETER olarak açılmışsa ya da zaten profili varsa yeni profil oluşturulmaz; mevcut profil gösterilir.
3. **Kullanıcıya bildirim:** Profil oluşturulunca kişiye e-posta gider: "Tercümanlık yetkisi verildi". E-postada tercüman paneli bağlantısı, 2FA kurulumu ve gizlilik taahhüdü adımları yer alır.
4. **Tercümanlığı kaldırma:** "Tercümanlığı kapat" düğmesi profili pasif yapar. Kullanıcının rolüne ve hesabına dokunulmaz. Aktif ve gelecekteki atamalar `cancelled` olur. Odadaysa mevcut temizleyici onu çıkarır.
5. **Erişim:**
   - Tercüman paneli `/[lang]/interpreter` adresinde. Profili aktif olan herkes görür.
   - Hesap menüsünde, profili olan kullanıcılar için "Tercüman paneli" bağlantısı gösterilir.
   - Hasta portalı, admin ve doktor paneli bu değişiklikten etkilenmez.
6. **Çıkar çatışması kuralı:** Bir kullanıcı, kendisinin **hastası olduğu** ya da **doktoru olduğu** randevuya tercüman olarak atanamaz. Bu hem backend doğrulamasıyla hem de atama listesinden çıkarılarak uygulanır.
7. **Güvenlik:**
   - Tercüman olarak katılımda her zaman **tercüman token'ı** kullanılır.
   - Admin bir kullanıcı tercüman paneli üzerinden katıldığında dinleyici (Paket C) ya da doktor yetkisi kullanılmaz.
   - Tercüman panelinde, kişinin başka rolünden gelen veriler (hasta randevuları, admin listeleri) gösterilmez.

## Testler
- PATIENT, ADMIN ve DOCTOR rollü var olan kullanıcıya profil verilmesi: rol değişmiyor, eski yetkileri çalışıyor, tercüman token'ı yalnızca atanmış görüşme için alınabiliyor.
- 2FA veya taahhüt eksikken token alınamıyor.
- Çıkar çatışması: kendi hasta ya da doktor randevusuna atanamıyor.
- Tercümanlığı kapatma: atamalar iptal oluyor, rol aynı kalıyor.
- Yeni hesap formunda kayıtlı e-postada yönlendirme mesajı çıkıyor.
- Paket AA'nın mevcut tercüman testlerinin tamamı geçiyor.
- 9 dil sözlük eşitliği (yeni metinler varsa).

## İnceleme
- `security-agent` incelesin: yetki yükseltme, IDOR, çıkar çatışması, rol/yetki karışması.
- Kırmızı çizgi kontrolü: `consultation-room.tsx`, `livekit.ts`, egress, billing, checkout, `package.json` ve compose için diff **boş** olmalı.

## Rapor
`docs/prompts/2026-10-30-AA-ek-RAPOR.md` dosyasına şunları yaz: commit listesi, değişen yetki kontrolleri listesi, testler, canlıya alma sırası.
