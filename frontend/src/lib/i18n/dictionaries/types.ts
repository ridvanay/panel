/**
 * Admin panel "chrome" (sidebar/topbar/breadcrumb/komut menüsü...) dili — içerik çevirisiyle
 * (`ContentTranslations`, `Locale.code`) KARIŞTIRILMAMALI. Bkz. `.claude/architect-scope-i18n.md`
 * §7.4 — "panel arayüz dili" (`adminLocale`, `localStorage`'da) ile "içerik dili" (`locale`,
 * URL/`?locale=`) İKİ AYRI KAVRAMDIR; biri asla diğerine geçirilmez.
 *
 * Faz 1 kapsamı KASITLI olarak sabit `tr`/`en` iledir (bkz. görev kapsamı, §7.3) — bu, içerik
 * dillerinin `GET /admin/locales`'ten DİNAMİK geldiği `LocaleTabs`'tan FARKLI bir sistemdir.
 */
export type AdminLocale = "tr" | "en";

export type Dictionary = Record<string, string>;

export type NamespaceDictionary = Record<AdminLocale, Dictionary>;
