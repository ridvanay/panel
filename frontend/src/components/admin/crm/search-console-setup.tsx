/**
 * Paket N4 — Search Console bağlı değilken gösterilen kurulum adımları (Anahtar Kelimeler ve Ayarlar).
 */
export function SearchConsoleSetupSteps() {
  return (
    <ol className="list-decimal space-y-1.5 ps-5 text-sm text-foreground/80">
      <li>Google Cloud Console&apos;da bir proje açın ve “Google Search Console API”yi etkinleştirin.</li>
      <li>IAM → Servis hesapları → yeni servis hesabı oluşturun; “Anahtarlar” sekmesinden JSON anahtarı indirin.</li>
      <li>
        Search Console → Ayarlar → Kullanıcılar ve izinler → servis hesabının e-posta adresini <strong>Kısıtlı</strong> (salt
        okunur) kullanıcı olarak ekleyin.
      </li>
      <li>
        CRM → Ayarlar → “Google Search Console” bölümünde mülk adresini (<code dir="ltr">sc-domain:alanadi.com</code> ya da{" "}
        <code dir="ltr">https://alanadi.com/</code>) ve JSON dosyasını yükleyin. Anahtar şifreli saklanır, ekranda yalnızca maskeli
        e-posta görünür.
      </li>
      <li>İlk senkron son 90 günü çeker; sonra her gün son 3 gün güncellenir. “Şimdi güncelle” ile elle de tetiklenebilir.</li>
    </ol>
  );
}
