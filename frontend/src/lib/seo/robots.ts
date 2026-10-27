import type { Locale } from "@/lib/api/types";
import { LOCALIZED_PRIVATE_PATHS, ROOT_PRIVATE_PATHS, robotsPatterns } from "./private-paths";

/**
 * Paket S — robots.txt metni. Herkese açık sayfalar (ana sayfa, doktorlar, uzmanlıklar, blog, yasal
 * sayfalar) engellenmez; yalnızca giriş gerektiren özel alanlar `Disallow` olur. Dil önekli hâller
 * tek tek yazılmaz: Google ve Bing `*` desenini destekler (`/*\/patient/` = herhangi bir dil öneki +
 * `/patient/`). Yorumda yalnızca AÇIK dillerin önekleri listelenir.
 */
export function buildRobotsTxt(siteUrl: string, locales: Locale[]): string {
  const enabled = locales.filter((l) => l.enabled);
  const defaultCode = (enabled.find((l) => l.isDefault) ?? enabled[0])?.code;
  const prefixes = enabled.filter((l) => l.code !== defaultCode).map((l) => `/${l.code}`);
  const lines = [
    "# robots.txt",
    "# Public pages are open to search engines. Only private, login-required areas are listed below.",
    "# robots.txt is not a security measure: these private pages also send \"noindex\" (X-Robots-Tag) and require sign-in.",
    "# \"$\" means an exact match (\"/cart$\" blocks /cart but not public pages such as /cartilage-...).",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    "# Admin panel, dashboard, backend API, invitations and sign-in pages.",
    ...ROOT_PRIVATE_PATHS.flatMap(robotsPatterns).map((p) => `Disallow: ${p}`),
    "",
    "# Patient and doctor portals, video consultation, checkout/payment result, cart and account pages.",
    "# \"/doctor/\" ends with a slash on purpose: it never matches public doctor profiles under \"/doctors/\".",
    ...LOCALIZED_PRIVATE_PATHS.flatMap(robotsPatterns).map((p) => `Disallow: ${p}`),
    "",
    ...(prefixes.length
      ? [
          `# Same areas with a language prefix. "*" matches any characters, so "/*/patient/" covers ${prefixes.map((p) => `${p}/patient/`).join(", ")}`,
          `# (enabled languages: ${prefixes.map((p) => p.slice(1)).join(", ")}).`,
          ...LOCALIZED_PRIVATE_PATHS.flatMap(robotsPatterns).map((p) => `Disallow: /*${p}`),
          "",
        ]
      : []),
    `Sitemap: ${siteUrl}/sitemap.xml`,
    `# LLM summary: ${siteUrl}/llms.txt`,
    "",
  ];
  return lines.join("\n");
}
