/**
 * Statik/salt-okunur belge: hangi SiteRole'ün hangi admin modülünde hangi aksiyona
 * izinli olduğunun insan/UI tarafından okunabilir özeti. Gerçek yetki uygulaması her
 * zaman `requireSiteRole` guard'larında yapılır — bu matris yalnızca frontend'in
 * "Yetkiler" ekranında göstermesi için bir referanstır, kendisi bir guard DEĞİLDİR.
 */
export const PERMISSIONS_MATRIX = {
  roles: ["ADMIN", "EDITOR", "VIEWER"] as const,
  modules: [
    {
      module: "pages",
      label: "Sayfalar",
      actions: {
        view: ["ADMIN", "EDITOR", "VIEWER"],
        create: ["ADMIN", "EDITOR"],
        edit: ["ADMIN", "EDITOR"],
        delete: ["ADMIN"],
      },
    },
    {
      module: "blog",
      label: "Blog",
      actions: {
        view: ["ADMIN", "EDITOR", "VIEWER"],
        create: ["ADMIN", "EDITOR"],
        edit: ["ADMIN", "EDITOR"],
        delete: ["ADMIN"],
      },
    },
    {
      module: "media",
      label: "Medya",
      actions: {
        view: ["ADMIN", "EDITOR", "VIEWER"],
        create: ["ADMIN", "EDITOR"],
        edit: [],
        delete: ["ADMIN"],
      },
    },
    {
      module: "settings",
      label: "Ayarlar",
      actions: {
        view: ["ADMIN", "EDITOR", "VIEWER"],
        edit: ["ADMIN"],
      },
    },
    {
      module: "navigation",
      label: "Navigasyon",
      actions: {
        view: ["ADMIN", "EDITOR", "VIEWER"],
        edit: ["ADMIN"],
      },
    },
    {
      module: "users",
      label: "Kullanıcılar",
      actions: {
        view: ["ADMIN"],
        create: ["ADMIN"],
        edit: ["ADMIN"],
      },
    },
    {
      module: "logs",
      label: "Loglar",
      actions: {
        view: ["ADMIN"],
      },
    },
  ],
  /**
   * §10.20 — ROLDEN TÜRETİLMEYEN, kullanıcı BAŞINA verilen yetenekler (bkz.
   * `.claude/architect-scope-page-editor-roles.md` §1, openapi.yaml `PermissionsMatrix.capabilities`
   * ile BİREBİR eşleşmesi gereken şekil). `modules` yalnızca rol × aksiyon eksenini anlatır; bu
   * eksen olmasaydı "Yetkiler" ekranı eksik/yanıltıcı bilgi gösterirdi (aynı roldeki iki
   * kullanıcının sayfa düzenleme kapsamı FARKLI olabilir). Bugün TEK yetenek vardır — ikinci bir
   * bayrak eklemeden ÖNCE architect'e eskale edilir (§1.7).
   */
  capabilities: [
    {
      key: "advancedBuilder",
      label: "Gelişmiş Düzenleyici",
      // Depolanan izinden BAĞIMSIZ olarak her zaman etkin olduğu roller (§1.5, kilitlenme güvenliği).
      alwaysGrantedTo: ["ADMIN"],
      // Yöneticinin bu yeteneği kullanıcı başına açıp kapatabildiği roller.
      grantableTo: ["EDITOR", "VIEWER"],
    },
  ],
} as const;
