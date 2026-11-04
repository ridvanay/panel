/**
 * Paket AK - musteri revizelerinin CANLI VERI kismi (KOD DEGISIKLIGI DEGIL). Kapsam (kontrat K9):
 *   Is 1  Hero basligi: yalniz slayt KATMAN metninde "our health service" gecerse "our health tourism services" yapilir;
 *         gecmiyorsa metin gorselin icindedir -> kod/script dokunmaz, "gorsel yeniden uretilmeli" olarak raporlanir (media adlariyla).
 *   Is 2  Ozellik seridi (trust band): 3 madde araci kurulus diliyle (8 dil + tr) yeniden yazilir ve `hidden=true` yapilir.
 *   Is 3  "Our Specialties"/"Specialties" basliklari -> "Our Health Tourism Services" (heading bloklari + specialty-cards.content.<dil>.title).
 *   Is 4  "How it works": 3 adim araci kurulus akisiyla yazilir ve `hidden=true` yapilir. SAYAC SERIDINE DOKUNULMAZ (yalniz raporlanir).
 *   Is 5  SSS (faq-3, faq-8), yolculuk adim 3 (journey-step-3) ve Hakkimizda CMS `treatments` metinleri (CMS override varsa).
 *   Is 6  SiteSettings.findTreatmentEnabled=false ve bookConsultationCtaEnabled=false.
 *   Is 7  Iletisim (ContactForm.pageContent): adres (en+tr, --address ile degistirilebilir), mapUrl bosaltilir (arama adresle yapilir),
 *         hoursVisible=false; --call-center-phone="+90 ..." VERILIRSE telefon (en+tr), yoksa telefona DOKUNULMAZ.
 *
 * Bloklar once id ile, yoksa icerik/yapi imzasiyla (ikon dizisi, baslik metni) bulunur; bulunamayanlar "bulunamadi (elle panelden)" olarak listelenir.
 * `hidden=true` TUM dil listelerinde (ana `blocks` + `translations.<dil>.blocks`) uygulanir. Hicbir blok/sayfa/kayit SILINMEZ.
 *
 * Guvenlik: varsayilan KURU (her degisiklik "eski -> yeni" listelenir); yazmak icin --confirm=apply-client-revisions-ak --operator=<ad>;
 * NODE_ENV=production iken ek --i-know-this-is-prod; yazmadan once yedek (storage/backups/client-revisions-ak-<ISO>.json); --restore=<yedek>
 * ile birebir eski hale doner; audit log degisiklikle AYNI transaction'da; idempotent (ikinci calisma "degisiklik 0").
 *
 * Calistirma (backend/ dizininden; DATABASE_URL'i ACIKCA export edin):
 *   npx tsx scripts/apply-client-revisions-ak.ts --list
 *   npx tsx scripts/apply-client-revisions-ak.ts
 *   npx tsx scripts/apply-client-revisions-ak.ts --confirm=apply-client-revisions-ak --operator=ridvan [--call-center-phone="+90 ..."] [--address="..."] [--no-revalidate]
 *   npx tsx scripts/apply-client-revisions-ak.ts --restore=storage/backups/client-revisions-ak-<ISO>.json --confirm=apply-client-revisions-ak --operator=ridvan
 *   (istege bagli: --backup-dir=<yol>)
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertProdWriteAllowed, printTargetDb } from "./_script-guard";
import { PageBlockListSchema } from "../src/modules/pages/pages.schemas";
import { ABOUT_TREATMENTS, DEFAULT_ADDRESS, FAQ3, FAQ8_ANSWER, HERO_NEW_EN, HERO_OLD_PATTERN, HOW_IT_WORKS, JOURNEY3_TEXT, SERVICES_TITLE, TRUST_BAND, akLocaleOf } from "../src/lib/ak-copy";

const prisma = new PrismaClient();
const CONFIRM_TOKEN = "apply-client-revisions-ak";
const SETTINGS_ID = "singleton";
const CONTACT_FORM_ID = "singleton";
const DISPLAY_PHONE_PATTERN = /^\+?[0-9 ()-]{4,30}$/;

// ---------------------------------------------------------------------------------------------
// Tipler / yardimcilar
// ---------------------------------------------------------------------------------------------

type Node = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Change {
  where: string;
  field: string;
  from: string;
  to: string;
}
interface NotFound {
  what: string;
  where: string;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const short = (v: string, n = 90) => (v.length > n ? `${v.slice(0, n)}…` : v);
const asArray = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);
const children = (n: Node): Node[] => asArray(n.children);

function walk(nodes: Node[], visit: (node: Node, siblings: Node[], index: number) => void) {
  nodes.forEach((node, index) => {
    visit(node, nodes, index);
    if (node && Array.isArray(node.children)) walk(node.children as Node[], visit);
  });
}

function descendants(node: Node): Node[] {
  const out: Node[] = [];
  walk(children(node), (n) => out.push(n));
  return out;
}

function firstText(node: Node): string {
  const d = (node.data ?? {}) as Node;
  const t = d.text ?? d.title ?? d.heading ?? d.eyebrow ?? d.html ?? "";
  return typeof t === "string" ? t.replace(/<[^>]+>/g, "").trim() : "";
}

// ---------------------------------------------------------------------------------------------
// Blok bulma imzalari
// ---------------------------------------------------------------------------------------------

const TRUST_ICONS = ["clock", "shieldcheck", "badgecheck"];
const HOW_ICONS = ["usersearch", "calendarcheck", "video"];
const TRUST_MARKER = /24\/7|7\/24|encrypted consultation|verified profiles|secure video consultation|authorized facilities|support in your language|available doctor|doctor profiles/i;
const SPECIALTY_TITLE = /^\s*(?:our\s+|unsere\s+|nuestras?\s+|nos\s+)?(?:medical\s+)?(?:specialt(?:y|ies)|bran[sş]lar|uzmanl[ıi]klar(?:ımız)?|uzmanl[ıi]k alanlar[ıi]m[ıi]z|fachgebiete|especialidades|spécialités|specialități|specijalnosti|специальности|التخصصات)\s*$/i;
const SPECIALTY_WORD = /specialt|bran[sş]|uzmanl|fachgebiet|especialidad|spécialit|specialit|specijaln|специальн|تخصص/i;

const iconKey = (n: Node) => str(n.data?.icon).toLowerCase();
const iconBoxes = (nodes: Node[]) => nodes.filter((c) => c.type === "icon-box");

function isTrustBand(n: Node): boolean {
  if (n.type !== "container") return false;
  if (n.id === "th-trust-band") return true;
  const boxes = iconBoxes(children(n));
  if (boxes.length < 3) return false;
  if (TRUST_ICONS.every((icon, i) => iconKey(boxes[i]!) === icon)) return true;
  return boxes.slice(0, 3).some((b) => TRUST_MARKER.test(`${str(b.data?.heading)} ${str(b.data?.description)}`));
}

function howBoxes(n: Node): Node[] {
  return iconBoxes(descendants(n)).filter((b) => !str(b.data?.href));
}

function isHowItWorks(n: Node): boolean {
  if (n.type !== "container") return false;
  if (n.id === "th-how-it-works") return true;
  const boxes = howBoxes(n);
  if (boxes.length < 3) return false;
  if (HOW_ICONS.every((icon, i) => iconKey(boxes[i]!) === icon)) return true;
  const heading = descendants(n).find((d) => d.type === "heading");
  return !!heading && /how it works|nas[ıi]l [cç]al[ıi][sş][ıi]r/i.test(str(heading.data?.text)) && !isTrustBand(n);
}

function isSpecialtyListing(n: Node | undefined): boolean {
  if (!n) return false;
  if (n.type === "specialty-cards") return true;
  if (n.type !== "container") return false;
  return iconBoxes(descendants(n)).some((b) => /\/specialties\//.test(str(b.data?.href)) || /specialty-slug/.test(str(b.data?.href)));
}

// ---------------------------------------------------------------------------------------------
// Liste isleme (saf: klonlanmis listeyi degistirir, Change kaydeder)
// ---------------------------------------------------------------------------------------------

interface ListCtx {
  where: string; // "<sayfa> · <liste>"
  lang: string; // BCP-47 kod
  changes: Change[];
  notFound: Set<string>;
  found: Set<string>;
  info: string[];
}

function setField(ctx: ListCtx, obj: Node, key: string, value: unknown, label: string) {
  const old = obj[key];
  if (JSON.stringify(old) === JSON.stringify(value)) return;
  obj[key] = value;
  ctx.changes.push({ where: ctx.where, field: label, from: typeof old === "string" ? old : String(old ?? "(yok)"), to: typeof value === "string" ? value : String(value) });
}

function applyList(blocks: Node[], ctx: ListCtx, isHomeScope: boolean) {
  const L = akLocaleOf(ctx.lang);
  const claimed = new WeakSet<Node>();

  walk(blocks, (node, siblings, index) => {
    // --- Is 2: ozellik seridi ---
    if (isHomeScope && !claimed.has(node) && isTrustBand(node)) {
      descendants(node).forEach((d) => claimed.add(d));
      ctx.found.add("trust");
      iconBoxes(children(node)).slice(0, 3).forEach((box, i) => {
        box.data ??= {};
        setField(ctx, box.data, "heading", TRUST_BAND[L][i]!.title, `ozellik seridi ${i + 1} baslik`);
        setField(ctx, box.data, "description", TRUST_BAND[L][i]!.text, `ozellik seridi ${i + 1} aciklama`);
      });
      setField(ctx, node, "hidden", true, "ozellik seridi hidden");
    }

    // --- Is 4: nasil calisir ---
    if (isHomeScope && !claimed.has(node) && isHowItWorks(node)) {
      descendants(node).forEach((d) => claimed.add(d));
      ctx.found.add("how");
      howBoxes(node).slice(0, 3).forEach((box, i) => {
        box.data ??= {};
        const prefix = /^\s*(\d+\s*[.)]\s*)/.exec(str(box.data.heading))?.[1] ?? "";
        setField(ctx, box.data, "heading", `${prefix}${HOW_IT_WORKS[L][i]!.title}`, `nasil calisir ${i + 1} baslik`);
        setField(ctx, box.data, "description", HOW_IT_WORKS[L][i]!.text, `nasil calisir ${i + 1} aciklama`);
      });
      setField(ctx, node, "hidden", true, "nasil calisir hidden");
    }

    // --- Is 4: sayac seridi (YALNIZ rapor) ---
    if (node.type === "counter") {
      const items = asArray(node.data?.items).map((it) => `${it.value}${str(it.suffix)} ${str(it.label)}${it.metric ? ` [metric=${it.metric}]` : ""}`);
      ctx.info.push(`sayac seridi (${ctx.where}): ${items.join(" | ")} - DOKUNULMADI (panelden karar)`);
    }

    // --- Is 3: baslik bloklari ---
    if (node.type === "heading") {
      const text = str(node.data?.text);
      const next = siblings[index + 1];
      if (node.id === "th-specialty-grid-heading" || SPECIALTY_TITLE.test(text) || (isSpecialtyListing(next) && SPECIALTY_WORD.test(text))) {
        ctx.found.add("services-heading");
        setField(ctx, node.data, "text", SERVICES_TITLE[L], "hizmetler basligi");
      }
    }
    if (node.type === "specialty-cards") {
      ctx.found.add("services-heading");
      const content = node.data?.content as Record<string, Node> | undefined;
      if (content && typeof content === "object") {
        for (const [code, entry] of Object.entries(content)) {
          const title = str(entry?.title);
          if (title && SPECIALTY_WORD.test(title)) setField(ctx, entry, "title", SERVICES_TITLE[akLocaleOf(code)], `specialty-cards.content.${code}.title`);
        }
      }
    }

    // --- Is 5: SSS ---
    if (node.type === "accordion") {
      for (const item of asArray(node.data?.items)) {
        if (item.id === "faq-3") {
          ctx.found.add("faq");
          setField(ctx, item, "question", FAQ3[L].question, "SSS faq-3 soru");
          setField(ctx, item, "answer", FAQ3[L].answer, "SSS faq-3 cevap");
        } else if (item.id === "faq-8") {
          ctx.found.add("faq");
          setField(ctx, item, "answer", FAQ8_ANSWER[L], "SSS faq-8 cevap");
        }
      }
    }

    // --- Is 5: yolculuk ---
    if (node.type === "journey-map") {
      for (const step of asArray(node.data?.steps)) {
        if (step.id === "journey-step-3") {
          ctx.found.add("journey");
          setField(ctx, step, "text", JOURNEY3_TEXT[L], "yolculuk adim 3 metin");
        }
      }
    }

    // --- Is 5: Hakkimizda CMS ---
    if (node.type === "about-page") {
      const t = node.data?.treatments as Node | undefined;
      if (t) {
        ctx.found.add("about");
        for (const key of ["eyebrow", "title", "body"] as const) {
          if (str(t[key]).trim()) setField(ctx, t, key, ABOUT_TREATMENTS[L][key], `Hakkimizda treatments.${key}`);
        }
      }
    }
  });
}

/** Yalniz rapor: "we treat / our treatment / ..." gibi tedavi eden taraf ifadeleri. */
const TREATING_PATTERN = /\bwe treat\b|\bour treatment\b|\bour patients['’] treatment|\btreatment areas\b|\bour (?:doctors?|physicians?)\b|choose your doctor|verified profiles|doctor profiles|find an available doctor/i;
function scanTreating(blocks: Node[], where: string, out: string[]) {
  const visit = (v: unknown, p: string) => {
    if (typeof v === "string") {
      const plain = v.replace(/<[^>]+>/g, "");
      if (TREATING_PATTERN.test(plain)) out.push(`${where} ${p}: "${short(plain)}"`);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${p}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "translations") visit(x, p ? `${p}.${k}` : k);
  };
  visit(blocks, "");
}

// ---------------------------------------------------------------------------------------------
// Hero (slayt katmanlari)
// ---------------------------------------------------------------------------------------------

function caseLike(source: string, target: string): string {
  if (source === source.toUpperCase()) return target.toUpperCase();
  if (source.split(/\s+/).every((w) => w[0] === w[0]!.toUpperCase())) return target.replace(/\b\w/g, (c) => c.toUpperCase());
  if (source[0] === source[0]!.toUpperCase()) return target[0]!.toUpperCase() + target.slice(1);
  return target;
}
const heroReplace = (text: string) => text.replace(new RegExp(HERO_OLD_PATTERN.source, "gi"), (m) => caseLike(m, HERO_NEW_EN));

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

interface PagePlan {
  id: string;
  slug: string;
  oldBlocks: unknown;
  oldTranslations: unknown;
  blocks: Node[];
  translations: Record<string, Node>;
  changed: boolean;
  invalid: string | null;
}
interface SlidePlan {
  id: string;
  oldLayers: unknown;
  layers: Node[];
  changed: boolean;
}
interface Plan {
  changes: Change[];
  notFound: NotFound[];
  info: string[];
  imageTextSlides: string[];
  pages: PagePlan[];
  slides: SlidePlan[];
  contact: { oldContent: unknown; content: Node } | null;
  contactChanged: boolean;
  settings: { exists: boolean; old: { findTreatmentEnabled: boolean; bookConsultationCtaEnabled: boolean } } | null;
  settingsChanged: boolean;
  treating: string[];
}

interface Args {
  list: boolean;
  confirm?: string;
  operator?: string;
  restore?: string;
  backupDir?: string;
  address: string;
  phone?: string;
  noRevalidate: boolean;
}

function parseArgs(argv: string[]): Args {
  const value = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    list: argv.includes("--list"),
    confirm: value("confirm"),
    operator: value("operator"),
    restore: value("restore"),
    backupDir: value("backup-dir"),
    address: value("address")?.trim() || DEFAULT_ADDRESS,
    phone: value("call-center-phone")?.trim(),
    noRevalidate: argv.includes("--no-revalidate"),
  };
}

async function buildPlan(args: Args): Promise<Plan> {
  const plan: Plan = { changes: [], notFound: [], info: [], imageTextSlides: [], pages: [], slides: [], contact: null, contactChanged: false, settings: null, settingsChanged: false, treating: [] };
  // Ana `blocks` listesi KANONIK (EN) iceriktir - varsayilan dil kodu ne olursa olsun (Paket O); `translations.<kod>` ayri listelerdir.
  const defaultCode = "en";
  const settingsRow = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { homePageId: true, findTreatmentEnabled: true, bookConsultationCtaEnabled: true } });
  const homePageId = settingsRow?.homePageId ?? null;

  // --- Sayfalar ---
  const pages = await prisma.page.findMany({ where: { deletedAt: null, isLegalDocument: false }, orderBy: { createdAt: "asc" } });
  const found = new Set<string>();
  for (const page of pages) {
    const isHome = page.id === homePageId;
    const oldBlocks = page.blocks;
    const oldTranslations = page.translations;
    const blocks = clone(asArray(page.blocks));
    const translations = clone((page.translations && typeof page.translations === "object" && !Array.isArray(page.translations) ? page.translations : {}) as Record<string, Node>);
    const mk = (listName: string, lang: string): ListCtx => ({ where: `sayfa /${page.slug} · ${listName}`, lang, changes: plan.changes, notFound: new Set(), found, info: plan.info });
    applyList(blocks, mk(`blocks (${defaultCode})`, defaultCode), isHome);
    scanTreating(blocks, `sayfa /${page.slug} · blocks (${defaultCode})`, plan.treating);
    for (const [code, entry] of Object.entries(translations)) {
      if (entry && Array.isArray(entry.blocks)) {
        applyList(entry.blocks as Node[], mk(`translations.${code}.blocks`, code), isHome);
        scanTreating(entry.blocks as Node[], `sayfa /${page.slug} · translations.${code}`, plan.treating);
      }
    }
    const changed = JSON.stringify(blocks) !== JSON.stringify(oldBlocks) || JSON.stringify(translations) !== JSON.stringify(oldTranslations);
    let invalid: string | null = null;
    if (changed) {
      const parsed = PageBlockListSchema.safeParse(blocks);
      if (!parsed.success) invalid = `ana blok listesi dogrulanamadi: ${parsed.error.issues[0]?.message ?? "bilinmeyen"} (${parsed.error.issues[0]?.path.join(".")})`;
      for (const [code, entry] of Object.entries(translations)) {
        if (!invalid && entry && Array.isArray(entry.blocks)) {
          const p = PageBlockListSchema.safeParse(entry.blocks);
          if (!p.success) invalid = `translations.${code}.blocks dogrulanamadi: ${p.error.issues[0]?.message ?? "bilinmeyen"} (${p.error.issues[0]?.path.join(".")})`;
        }
      }
    }
    plan.pages.push({ id: page.id, slug: page.slug, oldBlocks, oldTranslations, blocks, translations, changed, invalid });
  }
  const labels: Record<string, string> = {
    trust: "Ozellik seridi (trust band)",
    how: "Nasil calisir bolumu",
    "services-heading": "Hizmetler basligi / specialty-cards",
    faq: "SSS accordion (faq-3 / faq-8)",
    journey: "Yolculuk adim 3",
    about: "Hakkimizda CMS treatments",
  };
  for (const [key, label] of Object.entries(labels)) {
    if (!found.has(key)) plan.notFound.push({ what: label, where: key === "about" ? "Hakkimizda CMS override yok (metin sozlukten gelir; kod degisikligi)" : "bulunamadi (elle panelden)" });
  }

  // --- Slaytlar (Is 1) ---
  const slides = await prisma.slide.findMany({
    where: { slider: { deletedAt: null } },
    orderBy: [{ sliderId: "asc" }, { order: "asc" }],
    include: { bgMedia: { select: { filename: true } }, slider: { select: { name: true } } },
  });
  const mediaIds = new Set<string>();
  for (const s of slides) {
    const tr = (s.translations ?? {}) as Record<string, Node>;
    for (const v of Object.values(tr)) for (const k of ["bgMediaId", "bgTabletMediaId", "bgMobileMediaId"]) if (typeof v?.[k] === "string") mediaIds.add(v[k] as string);
  }
  const mediaRows = mediaIds.size ? await prisma.media.findMany({ where: { id: { in: [...mediaIds] } }, select: { id: true, filename: true } }) : [];
  const mediaName = new Map(mediaRows.map((m) => [m.id, m.filename]));
  let heroFound = false;
  for (const s of slides) {
    const layers = clone(asArray(s.layers));
    const ctx: ListCtx = { where: `slayt ${s.id} (${s.slider.name}${s.label ? ` / ${s.label}` : ""})`, lang: "en", changes: plan.changes, notFound: new Set(), found, info: plan.info };
    for (const layer of layers) {
      const content = (layer.content ?? {}) as Node;
      for (const key of ["text", "accentText"]) {
        if (typeof content[key] === "string" && new RegExp(HERO_OLD_PATTERN.source, "i").test(content[key])) {
          heroFound = true;
          setField(ctx, content, key, heroReplace(content[key] as string), `hero katman metni (${layer.type}.${key})`);
        }
      }
    }
    const changed = JSON.stringify(layers) !== JSON.stringify(s.layers);
    plan.slides.push({ id: s.id, oldLayers: s.layers, layers, changed });
    const tr = (s.translations ?? {}) as Record<string, Node>;
    const perLang = Object.entries(tr)
      .map(([code, v]) => `${code}=${mediaName.get(str(v?.bgMediaId)) ?? "-"}`)
      .join(", ");
    plan.imageTextSlides.push(`slayt ${s.id} (${s.slider.name}${s.label ? ` / ${s.label}` : ""}) arka plan: ${s.bgMedia?.filename ?? "(gradient/yok)"}${perLang ? `; dil gorselleri: ${perLang}` : ""}`);
  }
  if (!heroFound) plan.notFound.push({ what: "Hero basligi (OUR HEALTH SERVICE)", where: "katman metninde yok -> metin GORSELIN ICINDE: gorsel yeniden uretilmeli (asagidaki slayt/gorsel listesi)" });
  else plan.imageTextSlides.length = 0;

  // --- Iletisim (Is 7) ---
  const form = await prisma.contactForm.findUnique({ where: { id: CONTACT_FORM_ID }, select: { pageContent: true } });
  if (form) {
    const old = (form.pageContent && typeof form.pageContent === "object" && !Array.isArray(form.pageContent) ? form.pageContent : {}) as Node;
    const content = clone(old);
    content.locales ??= {};
    const ctx: ListCtx = { where: "iletisim sayfasi (ContactForm.pageContent)", lang: "en", changes: plan.changes, notFound: new Set(), found, info: plan.info };
    for (const code of ["en", "tr"]) {
      content.locales[code] ??= {};
      setField(ctx, content.locales[code], "address", args.address, `adres (${code})`);
      if (args.phone) setField(ctx, content.locales[code], "phone", args.phone, `cagri merkezi telefonu (${code})`);
    }
    setField(ctx, content, "mapUrl", "", "harita baglantisi (adres aranacak)");
    setField(ctx, content, "hoursVisible", false, "calisma saatleri karti gorunur");
    if (!args.phone) plan.info.push("--call-center-phone parametresi yok, telefon degismedi.");
    plan.contact = { oldContent: old, content };
    plan.contactChanged = JSON.stringify(content) !== JSON.stringify(old);
  } else {
    plan.notFound.push({ what: "Iletisim sayfasi icerigi", where: "ContactForm kaydi yok (elle panelden /admin/contact)" });
  }

  // --- Site ayarlari (Is 6) ---
  const sctx: ListCtx = { where: "SiteSettings", lang: "en", changes: plan.changes, notFound: new Set(), found, info: plan.info };
  const oldFlags = { findTreatmentEnabled: settingsRow?.findTreatmentEnabled ?? true, bookConsultationCtaEnabled: settingsRow?.bookConsultationCtaEnabled ?? true };
  const newFlags = { findTreatmentEnabled: false, bookConsultationCtaEnabled: false };
  plan.settings = { exists: !!settingsRow, old: oldFlags };
  for (const key of ["findTreatmentEnabled", "bookConsultationCtaEnabled"] as const) setField(sctx, { [key]: oldFlags[key] }, key, newFlags[key], key);
  plan.settingsChanged = oldFlags.findTreatmentEnabled !== false || oldFlags.bookConsultationCtaEnabled !== false || !settingsRow;
  if (!settingsRow) plan.info.push("SiteSettings satiri yok; yazma modunda olusturulur (varsayilanlarla + iki bayrak kapali).");
  return plan;
}

function printPlan(plan: Plan, label: string) {
  console.log(`[plan] ${label}`);
  if (plan.changes.length === 0) console.log("  (degisiklik yok)");
  for (const c of plan.changes) console.log(`  ~ ${c.where} | ${c.field}: "${short(c.from)}" -> "${short(c.to)}"`);
  for (const p of plan.pages) if (p.invalid) console.log(`  ! YAPILAMADI sayfa /${p.slug}: ${p.invalid}`);
  for (const nf of plan.notFound) console.log(`  ? ${nf.what}: ${nf.where}`);
  if (plan.imageTextSlides.length) {
    console.log("  [gorsel yeniden uretilmeli] hero yazisi katmanda degil, slayt gorselinin icinde olabilir:");
    for (const l of plan.imageTextSlides) console.log(`    - ${l}`);
  }
  for (const i of [...new Set(plan.info)]) console.log(`  i ${i}`);
  if (plan.treating.length) {
    console.log("  [tarama] tedavi eden taraf gibi gorunen ifadeler (rapor amacli, script DEGISTIRMEZ):");
    for (const t of plan.treating) console.log(`    - ${t}`);
  }
}

const planChangedAnything = (plan: Plan) =>
  plan.pages.some((p) => p.changed && !p.invalid) || plan.slides.some((s) => s.changed) || plan.contactChanged || plan.settingsChanged;

// ---------------------------------------------------------------------------------------------
// --list
// ---------------------------------------------------------------------------------------------

function printTree(nodes: Node[], indent: string) {
  for (const n of nodes) {
    console.log(`${indent}- ${n.type} id=${n.id}${n.hidden ? " [HIDDEN]" : ""}${firstText(n) ? ` "${short(firstText(n), 50)}"` : ""}`);
    if (Array.isArray(n.children)) printTree(n.children as Node[], `${indent}    `);
  }
}

async function listMode() {
  const defaultCode = "en";
  const settings = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID } });
  console.log(`[ayarlar] homePageId=${settings?.homePageId ?? "(yok)"} findTreatmentEnabled=${settings?.findTreatmentEnabled ?? "(satir yok)"} bookConsultationCtaEnabled=${settings?.bookConsultationCtaEnabled ?? "(satir yok)"}`);
  const home = settings?.homePageId ? await prisma.page.findUnique({ where: { id: settings.homePageId } }) : null;
  if (!home) console.log("[ana sayfa] bulunamadi");
  else {
    console.log(`[ana sayfa] /${home.slug} (${home.id})`);
    console.log(`  blocks (${defaultCode}):`);
    printTree(asArray(home.blocks), "    ");
    const tr = (home.translations ?? {}) as Record<string, Node>;
    for (const [code, entry] of Object.entries(tr)) {
      if (entry && Array.isArray(entry.blocks)) {
        console.log(`  translations.${code}.blocks:`);
        printTree(entry.blocks as Node[], "    ");
      }
    }
  }
  const slides = await prisma.slide.findMany({ where: { slider: { deletedAt: null } }, orderBy: [{ sliderId: "asc" }, { order: "asc" }], include: { bgMedia: { select: { filename: true, url: true } }, slider: { select: { name: true } } } });
  console.log(`[slaytlar] ${slides.length}`);
  for (const s of slides) {
    const texts = asArray(s.layers).map((l) => str(l.content?.text) || str(l.content?.label)).filter(Boolean);
    console.log(`  - ${s.id} slider="${s.slider.name}" label="${s.label ?? ""}" gorsel=${s.bgMedia?.filename ?? "(yok)"} katman metinleri=${texts.length ? texts.map((t) => `"${short(t, 40)}"`).join(", ") : "(YOK - yazi gorselin icinde olabilir)"}`);
  }
  const form = await prisma.contactForm.findUnique({ where: { id: CONTACT_FORM_ID }, select: { pageContent: true } });
  const pc = (form?.pageContent ?? {}) as Node;
  console.log(`[iletisim] en.phone="${str(pc.locales?.en?.phone)}" en.address="${short(str(pc.locales?.en?.address))}" mapUrl="${str(pc.mapUrl)}" hoursVisible=${pc.hoursVisible ?? "(yok=gorunur)"}`);
}

// ---------------------------------------------------------------------------------------------
// Yedek / yazma / geri yukleme
// ---------------------------------------------------------------------------------------------

interface Backup {
  version: 1;
  createdAt: string;
  pages: { id: string; slug: string; blocks: unknown; translations: unknown }[];
  slides: { id: string; layers: unknown }[];
  contact: { pageContent: unknown } | null;
  settings: { exists: boolean; findTreatmentEnabled: boolean; bookConsultationCtaEnabled: boolean } | null;
  /** Uygulamadan SONRAKI beklenen durumun ozetleri (restore, yedekten sonra yapilan duzenlemeleri bununla tespit eder). */
  after?: { pages: Record<string, string>; contact: string | null; settings: { findTreatmentEnabled: boolean; bookConsultationCtaEnabled: boolean } | null };
}

/** Anahtar sirasindan bagimsiz kararli ozet (Postgres jsonb anahtar sirasini degistirir). */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

function buildBackup(plan: Plan): Backup {
  return JSON.parse(
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      pages: plan.pages.filter((p) => p.changed && !p.invalid).map((p) => ({ id: p.id, slug: p.slug, blocks: p.oldBlocks, translations: p.oldTranslations })),
      slides: plan.slides.filter((s) => s.changed).map((s) => ({ id: s.id, layers: s.oldLayers })),
      contact: plan.contact ? { pageContent: plan.contact.oldContent } : null,
      settings: plan.settings ? { exists: plan.settings.exists, ...plan.settings.old } : null,
      after: {
        pages: Object.fromEntries(plan.pages.filter((p) => p.changed && !p.invalid).map((p) => [p.id, stable({ blocks: p.blocks, translations: p.translations })])),
        contact: plan.contact ? stable(plan.contact.content) : null,
        settings: plan.settings ? { findTreatmentEnabled: false, bookConsultationCtaEnabled: false } : null,
      },
    })
  ) as Backup;
}

async function applyPlan(plan: Plan, audit: { operator: string; backup: string }) {
  const stats = { pages: 0, slides: 0, contact: 0, settings: 0, changes: plan.changes.length };
  await prisma.$transaction(
    async (tx) => {
      for (const p of plan.pages) {
        if (!p.changed || p.invalid) continue;
        await tx.page.update({ where: { id: p.id }, data: { blocks: p.blocks as Prisma.InputJsonValue, translations: p.translations as Prisma.InputJsonValue } });
        stats.pages++;
      }
      for (const s of plan.slides) {
        if (!s.changed) continue;
        await tx.slide.update({ where: { id: s.id }, data: { layers: s.layers as Prisma.InputJsonValue } });
        stats.slides++;
      }
      if (plan.contact && plan.contactChanged) {
        await tx.contactForm.update({ where: { id: CONTACT_FORM_ID }, data: { pageContent: plan.contact.content as Prisma.InputJsonValue } });
        stats.contact++;
      }
      if (plan.settingsChanged) {
        await tx.siteSettings.upsert({
          where: { id: SETTINGS_ID },
          create: { id: SETTINGS_ID, findTreatmentEnabled: false, bookConsultationCtaEnabled: false },
          update: { findTreatmentEnabled: false, bookConsultationCtaEnabled: false },
        });
        stats.settings++;
      }
      await tx.auditLog.create({
        data: {
          actorEmail: `script:${audit.operator}`,
          action: "site.client_revisions_ak_apply",
          targetType: "Script",
          metadata: { script: "apply-client-revisions-ak", ...stats, backup: audit.backup },
        },
      });
    },
    { timeout: 60_000 }
  );
  return stats;
}

interface RestoreAssessment {
  missingPages: string[];
  missingSlides: string[];
  warnings: string[];
  pages: Backup["pages"];
  slides: Backup["slides"];
}

/** Yedekteki kayitlari guncel DB ile karsilastirir: yedekten sonra degismis kayitlari ve artik var olmayanlari tespit eder. */
async function assessRestore(snap: Backup): Promise<RestoreAssessment> {
  const warnings: string[] = [];
  const pageRows = await prisma.page.findMany({ where: { id: { in: snap.pages.map((p) => p.id) } }, select: { id: true, slug: true, blocks: true, translations: true, updatedAt: true, deletedAt: true } });
  const present = new Map(pageRows.map((p) => [p.id, p]));
  const missingPages: string[] = [];
  const pages: Backup["pages"] = [];
  for (const p of snap.pages) {
    const row = present.get(p.id);
    if (!row) {
      missingPages.push(`/${p.slug} (${p.id})`);
      continue;
    }
    pages.push(p);
    const expected = snap.after?.pages?.[p.id];
    const current = stable({ blocks: row.blocks, translations: row.translations });
    if (expected === undefined) warnings.push(`sayfa /${row.slug}: bu yedekte karşılaştırma özeti yok (eski sürüm); güncel updatedAt=${row.updatedAt.toISOString()} — restore bu sayfadaki sonraki düzenlemeleri ezebilir`);
    else if (expected !== current) warnings.push(`sayfa /${row.slug}: yedekten sonra değişmiş — restore bu düzenlemeleri ezer (updatedAt=${row.updatedAt.toISOString()})`);
    if (row.deletedAt) warnings.push(`sayfa /${row.slug}: çöp kutusunda (restore içeriği yazar, çöpten çıkarmaz)`);
  }
  const slideRows = await prisma.slide.findMany({ where: { id: { in: snap.slides.map((x) => x.id) } }, select: { id: true } });
  const slidePresent = new Set(slideRows.map((x) => x.id));
  const missingSlides = snap.slides.filter((x) => !slidePresent.has(x.id)).map((x) => x.id);
  const slides = snap.slides.filter((x) => slidePresent.has(x.id));
  if (snap.contact) {
    const form = await prisma.contactForm.findUnique({ where: { id: CONTACT_FORM_ID }, select: { pageContent: true, updatedAt: true } });
    if (form && snap.after?.contact !== undefined && snap.after.contact !== null && stable(form.pageContent) !== snap.after.contact) {
      warnings.push(`iletişim sayfası: yedekten sonra değişmiş — restore bu düzenlemeleri ezer (updatedAt=${form.updatedAt.toISOString()})`);
    }
  }
  if (snap.settings && snap.after?.settings) {
    const row = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { findTreatmentEnabled: true, bookConsultationCtaEnabled: true, updatedAt: true } });
    if (row && (row.findTreatmentEnabled !== snap.after.settings.findTreatmentEnabled || row.bookConsultationCtaEnabled !== snap.after.settings.bookConsultationCtaEnabled)) {
      warnings.push(`ayarlar: yedekten sonra değişmiş (find=${row.findTreatmentEnabled}, book=${row.bookConsultationCtaEnabled}) — restore bu düzenlemeleri ezer (updatedAt=${row.updatedAt.toISOString()})`);
    }
  }
  return { missingPages, missingSlides, warnings, pages, slides };
}

function printAssessment(a: RestoreAssessment) {
  for (const w of a.warnings) console.log(`[uyarı] ${w}`);
  for (const m of a.missingPages) console.log(`[atla] yedekteki sayfa artık yok, atlanacak: ${m}`);
  for (const m of a.missingSlides) console.log(`[atla] yedekteki slayt artık yok, atlanacak: ${m}`);
}

/** Restore yazmadan ONCE guncel durumun ayri bir yedegi (ayni biçim; gerekirse o da --restore ile geri yuklenebilir). */
async function writePreRestoreBackup(a: RestoreAssessment, dir: string): Promise<string> {
  const pages = await prisma.page.findMany({ where: { id: { in: a.pages.map((p) => p.id) } }, select: { id: true, slug: true, blocks: true, translations: true } });
  const slides = await prisma.slide.findMany({ where: { id: { in: a.slides.map((x) => x.id) } }, select: { id: true, layers: true } });
  const form = await prisma.contactForm.findUnique({ where: { id: CONTACT_FORM_ID }, select: { pageContent: true } });
  const settings = await prisma.siteSettings.findUnique({ where: { id: SETTINGS_ID }, select: { findTreatmentEnabled: true, bookConsultationCtaEnabled: true } });
  const snap: Backup = JSON.parse(
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      pages,
      slides,
      contact: form ? { pageContent: form.pageContent } : null,
      settings: settings ? { exists: true, ...settings } : null,
    })
  ) as Backup;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `client-revisions-ak-pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(snap, null, 2), "utf8");
  return file;
}

function readBackupFile(file: string): Backup {
  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Backup;
  if (snap.version !== 1 || !Array.isArray(snap.pages) || !Array.isArray(snap.slides)) throw new Error("Geçersiz yedek dosyası biçimi.");
  return snap;
}

async function restoreBackup(file: string, operator: string, backupDir: string) {
  const snap = readBackupFile(file);
  const a = await assessRestore(snap);
  printAssessment(a);
  const pre = await writePreRestoreBackup(a, backupDir);
  console.log(`[yedek] restore öncesi güncel durum: ${pre}`);
  await prisma.$transaction(
    async (tx) => {
      for (const p of a.pages) await tx.page.update({ where: { id: p.id }, data: { blocks: p.blocks as Prisma.InputJsonValue, translations: p.translations as Prisma.InputJsonValue } });
      for (const s of a.slides) await tx.slide.update({ where: { id: s.id }, data: { layers: s.layers as Prisma.InputJsonValue } });
      if (snap.contact) await tx.contactForm.update({ where: { id: CONTACT_FORM_ID }, data: { pageContent: snap.contact.pageContent as Prisma.InputJsonValue } });
      if (snap.settings) {
        await tx.siteSettings.upsert({
          where: { id: SETTINGS_ID },
          create: { id: SETTINGS_ID, findTreatmentEnabled: snap.settings.findTreatmentEnabled, bookConsultationCtaEnabled: snap.settings.bookConsultationCtaEnabled },
          update: { findTreatmentEnabled: snap.settings.findTreatmentEnabled, bookConsultationCtaEnabled: snap.settings.bookConsultationCtaEnabled },
        });
      }
      await tx.auditLog.create({
        data: {
          actorEmail: `script:${operator}`,
          action: "site.client_revisions_ak_restore",
          targetType: "Script",
          metadata: { script: "apply-client-revisions-ak", backup: path.basename(file), preRestoreBackup: path.basename(pre), pages: a.pages.length, slides: a.slides.length, skippedPages: a.missingPages.length, skippedSlides: a.missingSlides.length, overwrittenEdits: a.warnings.length },
        },
      });
    },
    { timeout: 60_000 }
  );
  console.log(`[fix] yedekten geri yüklendi (sayfa=${a.pages.length}, slayt=${a.slides.length}, iletişim=${snap.contact ? 1 : 0}, ayar=${snap.settings ? 1 : 0}; atlanan sayfa=${a.missingPages.length}, slayt=${a.missingSlides.length}).`);
}

async function revalidate(plan: Plan | null) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    console.log("[bilgi] REVALIDATE_SECRET yok: onbellek elle yenilenmedi (revalidate 60 sn içinde kendiliğinden yansır).");
    return;
  }
  void plan;
  const tags = ["settings", "contact-page", "pages"];
  try {
    const res = await fetch(`${process.env.INTERNAL_FRONTEND_URL ?? process.env.FRONTEND_URL ?? "http://localhost:3000"}/api/revalidate`, {
      method: "POST",
      headers: { "x-revalidate-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ tags: [...new Set(tags)] }),
    });
    console.log(res.ok ? `[revalidate] etiketler yenilendi: ${[...new Set(tags)].join(", ")}` : `[uyarı] revalidate yanıtı ${res.status}`);
  } catch (err) {
    console.log(`[uyarı] revalidate gönderilemedi: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const write = args.confirm === CONFIRM_TOKEN;
  if (args.confirm !== undefined && !write) throw new Error(`Geçersiz --confirm değeri. Beklenen: --confirm=${CONFIRM_TOKEN}`);
  if (write && !args.operator?.trim()) throw new Error("--operator=<ad> zorunludur (audit log için).");
  if (args.phone !== undefined && !DISPLAY_PHONE_PATTERN.test(args.phone)) throw new Error('--call-center-phone geçersiz (ör. "+90 212 000 00 00": rakam, boşluk, ( ) - ve baştaki +).');
  if (!args.list && !args.restore) {
    // Panel PUT semasi (contact-page.ts::plain(300)) ile AYNI kurallar: trim, en cok 300 karakter, HTML yok; ek olarak tek satir.
    // (contact-page.ts dogrudan import EDILMEZ: env/anahtar dogrulamasini tetikler; kurallar burada aynalanir.)
    const address = args.address.trim();
    const problem = !address ? "boş olamaz" : address.length > 300 ? "en çok 300 karakter" : /<\s*[a-z!/?]/i.test(address) ? "HTML kullanılamaz; düz metin girin" : /[\r\n]/.test(address) ? "tek satır olmalı" : null;
    if (problem) throw new Error(`--address geçersiz: ${problem} (en çok 300 karakter, HTML yok, tek satır).`);
    args.address = address;
  }
  console.log(`[apply-client-revisions-ak] mod=${args.list ? "LİSTE" : args.restore ? (write ? "GERİ YÜKLE" : "KURU (restore)") : write ? "YAZ" : "KURU ÇALIŞTIRMA"}`);
  printTargetDb();
  assertProdWriteAllowed(write, process.argv.slice(2));

  if (args.list) {
    await listMode();
    return;
  }
  if (args.restore) {
    const file = path.resolve(args.restore);
    if (!fs.existsSync(file)) throw new Error(`Yedek dosyası bulunamadı: ${file}`);
    if (!write) {
      printAssessment(await assessRestore(readBackupFile(file)));
      console.log(`[kuru] ${file} yedeğinden geri yüklenecekti (hiçbir şey yazılmadı).`);
      return;
    }
    await restoreBackup(file, args.operator!.trim(), path.resolve(args.backupDir ?? "storage/backups"));
    if (!args.noRevalidate) await revalidate(null);
    return;
  }

  const plan = await buildPlan(args);
  printPlan(plan, write ? "uygulanacak değişiklikler (eski -> yeni)" : "KURU ÇALIŞTIRMA - değişiklikler (eski -> yeni)");
  if (!planChangedAnything(plan)) {
    console.log("[bilgi] Yapılacak değişiklik yok (idempotent): değişiklik 0.");
    return;
  }
  console.log(`[özet] toplam alan değişikliği=${plan.changes.length}, sayfa=${plan.pages.filter((p) => p.changed && !p.invalid).length}, slayt=${plan.slides.filter((s) => s.changed).length}, iletişim=${plan.contactChanged ? 1 : 0}, ayar=${plan.settingsChanged ? 1 : 0}`);
  if (!write) {
    console.log("[kuru] hiçbir şey yazılmadı.");
    return;
  }
  const dir = path.resolve(args.backupDir ?? "storage/backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `client-revisions-ak-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(buildBackup(plan), null, 2), "utf8");
  console.log(`[yedek] ${file}`);
  const stats = await applyPlan(plan, { operator: args.operator!.trim(), backup: path.basename(file) });
  console.log(`[fix] uygulandı (sayfa=${stats.pages}, slayt=${stats.slides}, iletişim=${stats.contact}, ayar=${stats.settings}, alan değişikliği=${stats.changes}).`);
  console.log(`[geri al] npx tsx scripts/apply-client-revisions-ak.ts --restore=${file} --confirm=${CONFIRM_TOKEN} --operator=<ad>`);
  if (!args.noRevalidate) await revalidate(plan);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
