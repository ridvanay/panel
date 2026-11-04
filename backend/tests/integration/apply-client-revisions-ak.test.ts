import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { resetDatabase } from "../helpers/reset-db";
import { ABOUT_TREATMENTS, FAQ3, FAQ8_ANSWER, HOW_IT_WORKS, JOURNEY3_TEXT, SERVICES_TITLE, TRUST_BAND } from "../../src/lib/ak-copy";

/**
 * Paket AK - scripts/apply-client-revisions-ak.ts (K9): kuru, gercek, tekrar (degisiklik 0), restore (birebir eski),
 * telefon parametresi, sayaca dokunmama, prod bayragi, audit, --list. Alt surecte tsx; yalnizca test DB'si.
 * Fixture, canli ana sayfaya benzer SERBEST bloklu sayfadir (ana `blocks` + `translations.<dil>.blocks` ayri listeler).
 */
const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/apply-client-revisions-ak.ts");
const TSX_CLI = path.resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");
const CONFIRM = ["--confirm=apply-client-revisions-ak", "--operator=test"];
const LANGS = ["de", "ar", "fr", "ro", "sr-latn", "es", "ru", "tr"] as const;
const ADDRESS = "Atatürk Mah. Ertuğrul Gazi Sk. Metropol İstanbul C1 Blok No: 2B İç Kapı No: 168, Ataşehir / İstanbul, Türkiye";

function runScript(args: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [TSX_CLI, SCRIPT_PATH, ...args], { cwd: path.resolve(__dirname, "../.."), env: { ...process.env, REVALIDATE_SECRET: "", ...env }, encoding: "utf8" });
}

type Node = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Eski (canli) metinlerle sablon-benzeri ana sayfa listesi. `v2=true` -> id'ler FARKLI (icerik/yapi esleme testi). */
function homeBlocks(v2: boolean): Node[] {
  const id = (a: string, b: string) => (v2 ? b : a);
  return [
    {
      id: id("th-trust-band", "band-x1"),
      type: "container",
      settings: { layout: "boxed", direction: "row" },
      children: [
        { id: id("th-trust-1", "x-a"), type: "icon-box", data: { icon: "Clock", heading: "24/7 Access", description: "Find an available doctor at any hour and book an appointment." } },
        { id: id("th-trust-2", "x-b"), type: "icon-box", data: { icon: "ShieldCheck", heading: "Encrypted Consultation", description: "Video consultations take place over an encrypted connection." } },
        { id: id("th-trust-3", "x-c"), type: "icon-box", data: { icon: "BadgeCheck", heading: "Verified Profiles", description: "All active doctor profiles are verified." } },
      ],
    },
    {
      id: id("th-specialty-grid", "grid-x2"),
      type: "container",
      settings: { layout: "boxed", direction: "column" },
      children: [
        { id: id("th-specialty-grid-heading", "head-x3"), type: "heading", data: { text: v2 ? "Specialties" : "Our Specialties", level: 2 } },
        { id: "specialty-cards", type: "specialty-cards", data: { content: { en: { title: "Our Specialties", subtitle: "" }, de: { title: "Unsere Fachgebiete", subtitle: "" } }, columns: 4, showDescription: true, imageShape: "circle" } },
      ],
    },
    {
      id: id("th-how-it-works", "how-x4"),
      type: "container",
      settings: { layout: "boxed", direction: "column" },
      children: [
        { id: id("th-how-it-works-heading", "how-h"), type: "heading", data: { text: "How It Works", level: 2 } },
        {
          id: id("th-how-it-works-row", "how-row"),
          type: "container",
          settings: { layout: "full-width", direction: "row" },
          children: [
            { id: id("th-how-1", "h1"), type: "icon-box", data: { icon: "UserSearch", heading: "1. Choose Your Doctor", description: "Find the doctor that suits you." } },
            { id: id("th-how-2", "h2"), type: "icon-box", data: { icon: "CalendarCheck", heading: "2. Pick a Time", description: "Choose a slot from the doctor's availability calendar." } },
            { id: id("th-how-3", "h3"), type: "icon-box", data: { icon: "Video", heading: "3. Join the Call", description: "Click the link and join." } },
          ],
        },
      ],
    },
    {
      id: id("th-counters", "cnt-x5"),
      type: "counter",
      data: { items: [{ id: "c1", value: 15, label: "Coordinator" }, { id: "c2", value: 6, label: "Medical Specialty" }, { id: "c3", value: 6, label: "Spoken Language" }, { id: "c4", value: 30, suffix: " min", label: "Minutes" }] },
    },
    {
      id: "home-faq-accordion",
      type: "accordion",
      data: {
        items: [
          { id: "faq-1", question: "How do I start?", answer: "Contact us." },
          { id: "faq-3", question: "Who will carry out my treatment?", answer: "Your care is planned with the physician responsible for your treatment." },
          { id: "faq-8", question: "Follow-up?", answer: "Follow-up with a physician in your home country may be needed." },
        ],
        allowMultipleOpen: false,
      },
    },
    {
      id: "journey-map-block",
      type: "journey-map",
      data: {
        eyebrow: "Journey",
        title: "From Across the World",
        body: "We coordinate each stage.",
        steps: [
          { id: "journey-step-1", icon: "Plane", title: "Pre-Travel", text: "Share your history." },
          { id: "journey-step-2", icon: "MapPin", title: "Arrival", text: "We welcome you." },
          { id: "journey-step-3", icon: "Stethoscope", title: "Examination", text: "The physician responsible for your care completes the necessary examinations." },
        ],
        countries: [],
      },
    },
  ];
}

describe("scripts/apply-client-revisions-ak.ts", () => {
  const prisma = new PrismaClient();
  let backupDir: string;
  let homeId: string;
  let aboutId: string;
  let sliderId: string;
  let slideVarId: string;
  let slideNoTextId: string;

  async function seed(v2: boolean, slideWithText: boolean) {
    await resetDatabase(prisma);
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "ak-rev-"));
    const translations: Record<string, unknown> = {};
    for (const code of LANGS) translations[code] = { title: `Home ${code}`, blocks: homeBlocks(v2) };
    const home = await prisma.page.create({ data: { title: "Home", slug: "home", status: "PUBLISHED", blocks: homeBlocks(v2) as Prisma.InputJsonValue, translations: translations as Prisma.InputJsonValue } });
    homeId = home.id;
    const aboutBlock = (eyebrow: string) => [{ id: "about-1", type: "about-page", data: { treatments: { enabled: true, eyebrow, title: eyebrow ? "Our treatment areas" : "", body: eyebrow ? "Old body" : "", items: [] } } }];
    const about = await prisma.page.create({
      data: { title: "About", slug: "about", status: "PUBLISHED", blocks: aboutBlock("What we treat") as Prisma.InputJsonValue, translations: { de: { title: "Uber", blocks: aboutBlock("Was wir behandeln") } } as Prisma.InputJsonValue },
    });
    aboutId = about.id;
    await prisma.page.create({ data: { title: "Terms", slug: "terms", status: "PUBLISHED", isLegalDocument: true, blocks: [{ id: "t", type: "heading", data: { text: "Specialties", level: 2 } }] as Prisma.InputJsonValue } });
    await prisma.siteSettings.create({ data: { id: "singleton", homePageId: homeId } });
    await prisma.contactForm.create({
      data: {
        id: "singleton",
        notifyEmail: "team@example.com",
        consentText: "x",
        pageContent: {
          locales: {
            en: { title: "Contact", phone: "+90 212 000 00 00", whatsapp: "+90 555 000 00 00", address: "Old Street 1, Istanbul", hours: [{ label: "Pazartesi - Cuma", value: "09:00-18:00" }] },
            tr: { title: "Iletisim", phone: "+90 212 000 00 00", address: "Eski Cadde 1" },
          },
          mapUrl: "https://maps.app.goo.gl/abc123",
          mapImageMediaId: null,
        },
      },
    });
    const slider = await prisma.slider.create({ data: { name: "Hero", slug: "hero" } });
    sliderId = slider.id;
    const media = await prisma.media.create({ data: { path: "/x/hero-bg.webp", url: "/uploads/hero-bg.webp", filename: "hero-bg.webp", mimeType: "image/webp", sizeBytes: 10 } });
    const base = { sliderId, bgType: "IMAGE" as const, bgMediaId: media.id };
    if (slideWithText) {
      const s = await prisma.slide.create({ data: { ...base, order: 0, layers: [{ id: "l1", type: "heading", content: { text: "OUR HEALTH SERVICE, TRUSTED BEYOND BORDERS", level: 1 } }] as Prisma.InputJsonValue } });
      slideVarId = s.id;
    } else {
      const s = await prisma.slide.create({ data: { ...base, order: 0, layers: [{ id: "l1", type: "button", content: { label: "Book now", href: "/book", variant: "solid", size: "md" } }] as Prisma.InputJsonValue, translations: { de: { bgMediaId: media.id } } } });
      slideNoTextId = s.id;
    }
  }

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function snapshot() {
    return JSON.stringify({
      pages: await prisma.page.findMany({ orderBy: { slug: "asc" }, select: { slug: true, blocks: true, translations: true } }),
      slides: await prisma.slide.findMany({ orderBy: { id: "asc" }, select: { id: true, layers: true } }),
      contact: (await prisma.contactForm.findUnique({ where: { id: "singleton" } }))?.pageContent,
      flags: await prisma.siteSettings.findUnique({ where: { id: "singleton" }, select: { findTreatmentEnabled: true, bookConsultationCtaEnabled: true } }),
    });
  }
  const page = async (id: string) => prisma.page.findUniqueOrThrow({ where: { id } });
  const listsOf = (p: { blocks: unknown; translations: unknown }): [string, Node[]][] => [
    ["en", p.blocks as Node[]],
    ...Object.entries(p.translations as Record<string, Node>).map(([code, v]) => [code, v.blocks as Node[]] as [string, Node[]]),
  ];
  const find = (nodes: Node[], pred: (n: Node) => boolean): Node | undefined => {
    for (const n of nodes) {
      if (pred(n)) return n;
      const hit = n.children ? find(n.children as Node[], pred) : undefined;
      if (hit) return hit;
    }
    return undefined;
  };
  const L = (code: string) => (code as keyof typeof SERVICES_TITLE);

  describe.each([
    ["sablon id'leri", false],
    ["FARKLI id'ler (icerik/yapi esleme)", true],
  ])("fixture: %s", (_name, v2) => {
    beforeEach(async () => {
      await seed(v2, true);
    });

    it("kuru calistirma hicbir sey yazmaz; eski -> yeni listesini, sayac notunu ve telefon notunu yazdirir", async () => {
      const before = await snapshot();
      const res = runScript([`--backup-dir=${backupDir}`]);
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toMatch(/\[hedef DB\] [^\s]+:\d+\/saas_test/);
      expect(res.stdout).toContain("KURU ÇALIŞTIRMA");
      expect(res.stdout).toContain('"24/7 Access" -> "Support in your language"');
      expect(res.stdout).toContain('"1. Choose Your Doctor" -> "1. Choose a service"');
      expect(res.stdout).toContain('"Our Specialties" -> "Our Health Tourism Services"');
      expect(res.stdout).toContain("ozellik seridi hidden");
      expect(res.stdout).toContain("nasil calisir hidden");
      expect(res.stdout).toContain("hero katman metni");
      expect(res.stdout).toContain('"OUR HEALTH SERVICE, TRUSTED BEYOND BORDERS" -> "OUR HEALTH TOURISM SERVICES, TRUSTED BEYOND BORDERS"');
      expect(res.stdout).toContain("--call-center-phone parametresi yok, telefon degismedi.");
      expect(res.stdout).toContain("sayac seridi");
      expect(res.stdout).toContain("DOKUNULMADI");
      expect(res.stdout).toContain("[kuru] hiçbir şey yazılmadı.");
      expect(await snapshot()).toBe(before);
      expect(fs.readdirSync(backupDir)).toHaveLength(0);
      expect(await prisma.auditLog.count({ where: { action: "site.client_revisions_ak_apply" } })).toBe(0);
    });

    it("gercek calistirma: tum hedefler guncellenir (tum dil listeleri), sayaca dokunulmaz, telefon degismez, audit 1; tekrar = degisiklik 0; restore = birebir eski", async () => {
      const before = await snapshot();
      const counterBefore = JSON.stringify(find(homeBlocks(v2), (n) => n.type === "counter"));

      const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
      expect(res.status, res.stderr).toBe(0);

      const home = await page(homeId);
      for (const [code, blocks] of listsOf(home)) {
        const lang = L(code);
        const trust = find(blocks, (n) => n.type === "container" && n.children?.[0]?.data?.icon === "Clock")!;
        expect(trust.hidden, `${code} trust hidden`).toBe(true);
        TRUST_BAND[lang].forEach((p, i) => {
          expect(trust.children[i].data.heading).toBe(p.title);
          expect(trust.children[i].data.description).toBe(p.text);
        });
        const how = find(blocks, (n) => n.type === "container" && n.children?.some((c: Node) => c.type === "heading" && c.data?.text === "How It Works"))!;
        expect(how.hidden, `${code} how hidden`).toBe(true);
        const steps = how.children[1].children as Node[];
        HOW_IT_WORKS[lang].forEach((p, i) => {
          expect(steps[i]!.data.heading).toBe(`${i + 1}. ${p.title}`);
          expect(steps[i]!.data.description).toBe(p.text);
        });
        expect(how.children[0].data.text).toBe("How It Works"); // baslik kalir
        expect(find(blocks, (n) => n.type === "heading" && /health tourism|Leistungen|услуги|services|Hizmetlerimiz|خدمات|servicios|usluge|servicii|services de/i.test(n.data?.text ?? ""))!.data.text).toBe(SERVICES_TITLE[lang]);
        const cards = find(blocks, (n) => n.type === "specialty-cards")!;
        expect(cards.data.content.en.title).toBe(SERVICES_TITLE.en);
        expect(cards.data.content.de.title).toBe(SERVICES_TITLE.de);
        const faq = find(blocks, (n) => n.type === "accordion")!;
        expect(faq.data.items[1]).toMatchObject({ id: "faq-3", question: FAQ3[lang].question, answer: FAQ3[lang].answer });
        expect(faq.data.items[2].answer).toBe(FAQ8_ANSWER[lang]);
        expect(faq.data.items[0].answer).toBe("Contact us.");
        const journey = find(blocks, (n) => n.type === "journey-map")!;
        expect(journey.data.steps[2].text).toBe(JOURNEY3_TEXT[lang]);
        expect(journey.data.steps[0].text).toBe("Share your history.");
        // sayac seridine dokunulmadi
        expect(find(blocks, (n) => n.type === "counter")).toEqual(JSON.parse(counterBefore));
        expect(find(blocks, (n) => n.type === "counter")!.hidden).toBeUndefined();
      }

      // Hakkimizda CMS
      const about = await page(aboutId);
      const aboutEn = find(about.blocks as Node[], (n) => n.type === "about-page")!;
      expect(aboutEn.data.treatments).toMatchObject(ABOUT_TREATMENTS.en);
      const aboutDe = find((about.translations as Record<string, Node>).de!.blocks as Node[], (n) => n.type === "about-page")!;
      expect(aboutDe.data.treatments).toMatchObject(ABOUT_TREATMENTS.de);

      // Yasal sayfa dokunulmaz
      const terms = await prisma.page.findFirstOrThrow({ where: { slug: "terms" } });
      expect(JSON.stringify(terms.blocks)).toContain('"Specialties"');

      // Slayt hero katmani
      const slide = await prisma.slide.findUniqueOrThrow({ where: { id: slideVarId } });
      expect(JSON.stringify(slide.layers)).toContain("OUR HEALTH TOURISM SERVICES, TRUSTED BEYOND BORDERS");

      // Iletisim
      const contact = (await prisma.contactForm.findUniqueOrThrow({ where: { id: "singleton" } })).pageContent as Node;
      expect(contact.locales.en.address).toBe(ADDRESS);
      expect(contact.locales.tr.address).toBe(ADDRESS);
      expect(contact.mapUrl).toBe("");
      expect(contact.hoursVisible).toBe(false);
      expect(contact.locales.en.phone).toBe("+90 212 000 00 00"); // parametre yok -> telefon degismez
      expect(contact.locales.tr.phone).toBe("+90 212 000 00 00");
      expect(contact.locales.en.whatsapp).toBe("+90 555 000 00 00");
      expect(contact.locales.en.hours).toHaveLength(1); // kayit silinmez, yalniz gizlenir

      // Ayarlar + audit
      expect(await prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { findTreatmentEnabled: true, bookConsultationCtaEnabled: true } })).toEqual({ findTreatmentEnabled: false, bookConsultationCtaEnabled: false });
      const audit = await prisma.auditLog.findMany({ where: { action: "site.client_revisions_ak_apply" } });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.actorEmail).toBe("script:test");
      expect(await prisma.page.count()).toBe(3); // hicbir sayfa silinmedi

      // Tekrar: degisiklik 0
      const after = await snapshot();
      const again = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
      expect(again.status, again.stderr).toBe(0);
      expect(again.stdout).toContain("değişiklik 0");
      expect(await snapshot()).toBe(after);
      expect(await prisma.auditLog.count({ where: { action: "site.client_revisions_ak_apply" } })).toBe(1);
      const dry = runScript([`--backup-dir=${backupDir}`]);
      expect(dry.stdout).toContain("değişiklik 0");

      // Restore: birebir eski
      const backups = fs.readdirSync(backupDir).filter((f) => f.startsWith("client-revisions-ak-"));
      expect(backups).toHaveLength(1);
      const restore = runScript([`--restore=${path.join(backupDir, backups[0]!)}`, ...CONFIRM, `--backup-dir=${backupDir}`]);
      expect(restore.status, restore.stderr).toBe(0);
      expect(await snapshot()).toBe(before);
      expect(await prisma.auditLog.count({ where: { action: "site.client_revisions_ak_restore" } })).toBe(1);
    });
  });

  describe("tek fixture", () => {
    beforeEach(async () => {
      await seed(false, true);
    });

    it("--call-center-phone verilirse telefon en+tr icin degisir; WhatsApp ve diger alanlar korunur; gecersiz telefon reddedilir", async () => {
      const bad = runScript([...CONFIRM, "--call-center-phone=abc<script>", `--backup-dir=${backupDir}`]);
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain("--call-center-phone geçersiz");

      const dry = runScript(["--call-center-phone=+90 216 111 22 33", `--backup-dir=${backupDir}`]);
      expect(dry.stdout).toContain('"+90 212 000 00 00" -> "+90 216 111 22 33"');
      expect(dry.stdout).not.toContain("telefon degismedi");

      const res = runScript([...CONFIRM, "--call-center-phone=+90 216 111 22 33", `--backup-dir=${backupDir}`]);
      expect(res.status, res.stderr).toBe(0);
      const contact = (await prisma.contactForm.findUniqueOrThrow({ where: { id: "singleton" } })).pageContent as Node;
      expect(contact.locales.en.phone).toBe("+90 216 111 22 33");
      expect(contact.locales.tr.phone).toBe("+90 216 111 22 33");
      expect(contact.locales.en.whatsapp).toBe("+90 555 000 00 00");
    });

    it("--address ile adres degistirilebilir", async () => {
      const res = runScript([...CONFIRM, "--address=Test Cad. 5, Istanbul", `--backup-dir=${backupDir}`]);
      expect(res.status, res.stderr).toBe(0);
      const contact = (await prisma.contactForm.findUniqueOrThrow({ where: { id: "singleton" } })).pageContent as Node;
      expect(contact.locales.en.address).toBe("Test Cad. 5, Istanbul");
    });

    it("--address panel semasiyla dogrulanir: HTML, 300+ karakter ve cok satirli adres reddedilir (yazmadan cikar)", async () => {
      const before = await snapshot();
      for (const bad of ["<b>x</b> Cad. 1", "A".repeat(301), "Satir 1\nSatir 2"]) {
        const res = runScript([...CONFIRM, `--address=${bad}`, `--backup-dir=${backupDir}`]);
        expect(res.status, bad.slice(0, 20)).not.toBe(0);
        expect(res.stderr).toContain("--address geçersiz");
      }
      expect(runScript([`--address=<script>`, `--backup-dir=${backupDir}`]).status).not.toBe(0);
      expect(await snapshot()).toBe(before);
      expect(fs.readdirSync(backupDir)).toHaveLength(0);
    });

    it("restore: yazmadan once ayri on-yedek alinir; yedekten sonra degismis kayitlar uyarilir (kuru ve gercek); silinmis sayfa atlanir, restore dusmez", async () => {
      expect(runScript([...CONFIRM, `--backup-dir=${backupDir}`]).status).toBe(0);
      const backupFile = path.join(backupDir, fs.readdirSync(backupDir).find((f) => f.startsWith("client-revisions-ak-2"))!);

      // Yedekten sonra: ana sayfa elle duzenlendi, iletisim degisti, ayar acildi, hakkimizda sayfasi silindi.
      const home = await prisma.page.findUniqueOrThrow({ where: { id: homeId } });
      const blocks = home.blocks as Node[];
      blocks.push({ id: "manual-1", type: "text", data: { html: "<p>manuel</p>" } });
      await prisma.page.update({ where: { id: homeId }, data: { blocks: blocks as Prisma.InputJsonValue } });
      const form = await prisma.contactForm.findUniqueOrThrow({ where: { id: "singleton" } });
      await prisma.contactForm.update({ where: { id: "singleton" }, data: { pageContent: { ...(form.pageContent as Node), mapImageMediaId: null, title: "elle" } as Prisma.InputJsonValue } });
      await prisma.siteSettings.update({ where: { id: "singleton" }, data: { findTreatmentEnabled: true } });
      await prisma.page.delete({ where: { id: aboutId } });

      const dry = runScript([`--restore=${backupFile}`, `--backup-dir=${backupDir}`]);
      expect(dry.status, dry.stderr).toBe(0);
      expect(dry.stdout).toContain("sayfa /home: yedekten sonra değişmiş — restore bu düzenlemeleri ezer");
      expect(dry.stdout).toContain("iletişim sayfası: yedekten sonra değişmiş — restore bu düzenlemeleri ezer");
      expect(dry.stdout).toContain("ayarlar: yedekten sonra değişmiş");
      expect(dry.stdout).toContain("yedekteki sayfa artık yok, atlanacak: /about");
      expect(dry.stdout).toContain("[kuru]");
      expect(fs.readdirSync(backupDir).filter((f) => f.includes("pre-restore"))).toHaveLength(0);

      const afterEdit = await snapshot();
      const real = runScript([`--restore=${backupFile}`, ...CONFIRM, `--backup-dir=${backupDir}`]);
      expect(real.status, real.stderr).toBe(0);
      expect(real.stdout).toContain("yedekten sonra değişmiş — restore bu düzenlemeleri ezer");
      expect(real.stdout).toContain("[yedek] restore öncesi güncel durum:");
      expect(real.stdout).toContain("atlanan sayfa=1");
      const pre = fs.readdirSync(backupDir).filter((f) => f.startsWith("client-revisions-ak-pre-restore-"));
      expect(pre).toHaveLength(1);
      const preSnap = JSON.parse(fs.readFileSync(path.join(backupDir, pre[0]!), "utf8")) as { pages: { id: string; blocks: Node[] }[]; settings: { findTreatmentEnabled: boolean } };
      expect(preSnap.pages.find((p) => p.id === homeId)!.blocks.some((b) => b.id === "manual-1")).toBe(true);
      expect(preSnap.settings.findTreatmentEnabled).toBe(true);
      expect(await snapshot()).not.toBe(afterEdit);
      const restoredHome = await page(homeId);
      expect((restoredHome.blocks as Node[]).some((b) => b.id === "manual-1")).toBe(false);
      expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "site.client_revisions_ak_restore" } })).metadata).toMatchObject({ skippedPages: 1 });
    });

    it("NODE_ENV=production iken yazma --i-know-this-is-prod ister; bayrakla gecer", async () => {
      const blocked = runScript([...CONFIRM, `--backup-dir=${backupDir}`], { NODE_ENV: "production" });
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toContain("--i-know-this-is-prod");
      expect(await prisma.auditLog.count({ where: { action: "site.client_revisions_ak_apply" } })).toBe(0);
      const allowed = runScript([...CONFIRM, "--i-know-this-is-prod", `--backup-dir=${backupDir}`], { NODE_ENV: "production" });
      expect(allowed.status, allowed.stderr).toBe(0);
    });

    it("--operator olmadan ve yanlis --confirm ile yazma reddedilir", async () => {
      expect(runScript(["--confirm=apply-client-revisions-ak"]).status).not.toBe(0);
      const wrong = runScript(["--confirm=yes", "--operator=x"]);
      expect(wrong.status).not.toBe(0);
      expect(wrong.stderr).toContain("Geçersiz --confirm");
    });

    it("--list: ana sayfa bloklari (id, tip, ilk metin, hidden), dil listeleri, slaytlar ve ayarlar; hicbir sey yazmaz", async () => {
      const before = await snapshot();
      const res = runScript(["--list"]);
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toContain("[ana sayfa] /home");
      expect(res.stdout).toContain("container id=th-trust-band");
      expect(res.stdout).toContain('icon-box id=th-trust-1 "24/7 Access"');
      expect(res.stdout).toContain("translations.de.blocks:");
      expect(res.stdout).toContain("[slaytlar] 1");
      expect(res.stdout).toContain("findTreatmentEnabled=true");
      expect(await snapshot()).toBe(before);
      runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
      const after = runScript(["--list"]);
      expect(after.stdout).toContain("[HIDDEN]");
      expect(after.stdout).toContain("findTreatmentEnabled=false");
    });
  });

  describe("slayt: katmanda metin YOK (yazi gorselin icinde)", () => {
    beforeEach(async () => {
      await seed(false, false);
    });

    it("hero metni degistirilmez; 'gorsel yeniden uretilmeli' + media adlari raporlanir; slayt degismez", async () => {
      const layersBefore = JSON.stringify((await prisma.slide.findUniqueOrThrow({ where: { id: slideNoTextId } })).layers);
      const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toContain("gorsel yeniden uretilmeli");
      expect(res.stdout).toContain("hero-bg.webp");
      expect(res.stdout).toContain("de=hero-bg.webp");
      expect(JSON.stringify((await prisma.slide.findUniqueOrThrow({ where: { id: slideNoTextId } })).layers)).toBe(layersBefore);
    });
  });

  describe("bulunamayan bloklar", () => {
    it("ana sayfada ilgili bloklar yoksa 'bulunamadi (elle panelden)' listelenir; iletisim ve ayarlar yine uygulanir", async () => {
      await seed(false, false);
      await prisma.page.update({ where: { id: homeId }, data: { blocks: [{ id: "t1", type: "text", data: { html: "<p>x</p>" } }], translations: {} } });
      const res = runScript([...CONFIRM, `--backup-dir=${backupDir}`]);
      expect(res.status, res.stderr).toBe(0);
      expect(res.stdout).toContain("Ozellik seridi (trust band): bulunamadi (elle panelden)");
      expect(res.stdout).toContain("Nasil calisir bolumu: bulunamadi (elle panelden)");
      expect((await prisma.siteSettings.findUniqueOrThrow({ where: { id: "singleton" } })).findTreatmentEnabled).toBe(false);
    });
  });
});
