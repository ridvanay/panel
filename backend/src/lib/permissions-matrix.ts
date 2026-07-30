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
} as const;
