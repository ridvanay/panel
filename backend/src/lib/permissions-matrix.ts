/**
 * Statik/salt-okunur belge: hangi SiteRole'ün hangi admin modülünde hangi aksiyona
 * izinli olduğunun insan/UI tarafından okunabilir özeti. Gerçek yetki uygulaması her
 * zaman `requireSiteRole` guard'larında yapılır — bu matris yalnızca frontend'in
 * "Yetkiler" ekranında göstermesi için bir referanstır, kendisi bir guard DEĞİLDİR.
 *
 * `.claude/architect-scope-rbac-5-tier.md` §5.3 tablosuyla BİREBİR TUTARLI tutulmalıdır
 * (DoD maddesi). CUSTOMER/USER hiçbir modülde YER ALMAZ — panelin tamamında 403 alırlar
 * (§4), bu yüzden "izinli roller" listelerine hiçbir zaman eklenmezler.
 */
export const PERMISSIONS_MATRIX = {
  roles: ["ADMIN", "MANAGER", "EDITOR", "CUSTOMER", "USER"] as const,
  modules: [
    {
      // §6 — sayfa modülü üç katmanlıdır; bu matris en yaygın aksiyonların EŞİĞİNİ özetler
      // (Katman 1 — blok yapısı — yalnızca ADMIN'dir, `edit` burada Katman 3 — içerik — eşiğini
      // yansıtır; `create` §6.1 istisnası gereği MANAGER'ı BİLEREK dışarıda bırakır).
      module: "pages",
      label: "Sayfalar",
      actions: {
        view: ["ADMIN", "MANAGER", "EDITOR"],
        create: ["ADMIN"],
        edit: ["ADMIN", "MANAGER", "EDITOR"],
        delete: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "blog",
      label: "Blog",
      actions: {
        view: ["ADMIN", "MANAGER", "EDITOR"],
        create: ["ADMIN", "MANAGER", "EDITOR"],
        edit: ["ADMIN", "MANAGER", "EDITOR"],
        delete: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "media",
      label: "Medya",
      actions: {
        view: ["ADMIN", "MANAGER", "EDITOR"],
        create: ["ADMIN", "MANAGER", "EDITOR"],
        edit: ["ADMIN", "MANAGER", "EDITOR"],
        delete: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "products",
      label: "Ürünler",
      actions: {
        view: ["ADMIN", "MANAGER"],
        create: ["ADMIN", "MANAGER"],
        edit: ["ADMIN", "MANAGER"],
        delete: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "portfolio",
      label: "Portföy",
      actions: {
        view: ["ADMIN", "MANAGER"],
        create: ["ADMIN", "MANAGER"],
        edit: ["ADMIN", "MANAGER"],
        delete: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "orders",
      label: "Siparişler",
      actions: {
        view: ["ADMIN", "MANAGER"],
        edit: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "contact",
      label: "İletişim Formu",
      actions: {
        view: ["ADMIN", "MANAGER"],
        edit: ["ADMIN", "MANAGER"],
        delete: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "navigation",
      label: "Navigasyon",
      actions: {
        view: ["ADMIN", "MANAGER", "EDITOR"],
        edit: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "appearance",
      label: "Görünüm",
      actions: {
        view: ["ADMIN", "MANAGER", "EDITOR"],
        edit: ["ADMIN", "MANAGER"],
        // Özel CSS/JS — (c) keyfi kod yürütme, MANAGER'a AÇILMAZ.
        editCustomCode: ["ADMIN"],
      },
    },
    {
      module: "localization",
      label: "Diller",
      actions: {
        view: ["ADMIN", "MANAGER", "EDITOR"],
        create: ["ADMIN", "MANAGER"],
        edit: ["ADMIN", "MANAGER"],
        delete: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "email-templates",
      label: "Bildirim Şablonları",
      actions: {
        view: ["ADMIN", "MANAGER"],
        create: ["ADMIN", "MANAGER"],
        edit: ["ADMIN", "MANAGER"],
        delete: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "stats",
      label: "İstatistikler",
      actions: {
        view: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "reports",
      label: "Raporlar",
      actions: {
        view: ["ADMIN", "MANAGER"],
        create: ["ADMIN", "MANAGER"],
      },
    },
    {
      module: "modules",
      label: "Modüller",
      actions: {
        view: ["ADMIN", "MANAGER", "EDITOR"],
        // (d) — modül kapatmak public siteyi 404'e düşürür (site-geneli kill switch).
        edit: ["ADMIN"],
      },
    },
    {
      module: "settings",
      label: "Ayarlar",
      actions: {
        view: ["ADMIN", "MANAGER", "EDITOR"],
        // (d) — site-geneli kill switch.
        edit: ["ADMIN"],
      },
    },
    {
      module: "users",
      label: "Kullanıcılar",
      actions: {
        // (a) — ayrıcalık yükseltme yüzeyi; MANAGER GET'te DAHİL 403 alır (kullanıcı listesi = PII).
        view: ["ADMIN"],
        create: ["ADMIN"],
        edit: ["ADMIN"],
      },
    },
    {
      module: "import",
      label: "İçe Aktarma",
      actions: {
        // (a) — kullanıcı içe aktarma hesap oluşturup rol atayabiliyor.
        view: ["ADMIN"],
        create: ["ADMIN"],
      },
    },
    {
      module: "api-keys",
      label: "API Anahtarları",
      actions: {
        // (b) — kimlik bilgisi yüzeyi, okuma dahil.
        view: ["ADMIN"],
        create: ["ADMIN"],
        edit: ["ADMIN"],
        delete: ["ADMIN"],
      },
    },
    {
      module: "outbound-webhooks",
      label: "Giden Webhook'lar",
      actions: {
        // (b) — kimlik bilgisi yüzeyi (webhook secret'ları), okuma dahil.
        view: ["ADMIN"],
        create: ["ADMIN"],
        edit: ["ADMIN"],
        delete: ["ADMIN"],
      },
    },
    {
      module: "logs",
      label: "Loglar",
      actions: {
        // (f) — denetim izi; denetleyen ile denetlenenin ayrılığı ilkesi.
        view: ["ADMIN"],
      },
    },
    {
      module: "system",
      label: "Sistem Sağlığı",
      actions: {
        // (d) — site-geneli kill switch kapsamına giren hassas sistem verisi.
        view: ["ADMIN"],
      },
    },
  ],
  /**
   * `.claude/architect-scope-rbac-5-tier.md` §3.3 — ROLDEN TÜRETİLMEYEN, kullanıcı BAŞINA
   * verilen yetenekler bölümü ŞEKİL OLARAK korunur (frontend "Yetkiler" ekranı bozulmaz),
   * yalnızca VERİ değişir: `advancedBuilder` artık saf rol türevidir
   * (`role === "ADMIN"`, bkz. lib/builder-capability.ts) — `grantableTo` BOŞTUR, kullanıcı
   * başına açılıp kapatılabilen bir bayrak ARTIK YOKTUR. `capabilities` dizisi bilerek
   * korunuyor: ilerideki gerçek bir `Permission` tablosu için sözleşme yeri hazır kalır
   * (`architect-scope-page-editor-roles.md` §1.7 hâlâ geçerli — ikinci bir `User.canX`
   * bayrağı eklenmeden ÖNCE architect'e eskale edilir).
   */
  capabilities: [
    {
      key: "advancedBuilder",
      label: "Gelişmiş Düzenleyici",
      // Rolden BAĞIMSIZ depolanan bir izinden değil, doğrudan rolün kendisinden her zaman
      // etkin olan roller (kilitlenme güvenliği DEĞİL — artık saf türetme).
      alwaysGrantedTo: ["ADMIN"],
      // Yöneticinin kullanıcı başına açıp kapatabildiği roller — ARTIK BOŞ (§3.1).
      grantableTo: [],
    },
  ],
} as const;
