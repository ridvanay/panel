import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { getCachedAdminSession, getNavigationConfig, updateNavigationConfig } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — `.claude/architect-scope-navigation-deep-nesting.md` §5 (çok seviyeli/4 katman
 * navigasyon menüsü). Bu dosya `admin-navigation-editor.spec.ts`teki (2 seviyeye kadar geçerli
 * olan, sıralama/sürükleme odaklı) mevcut kapsamı GENİŞLETİR — burada ÖZELLİKLE derinlik
 * (`NAVIGATION_MAX_DEPTH = 3`, 0-tabanlı ata sayısı → 4 görünür seviye) sınırının admin ağaç
 * editöründe (`NavTreeEditor`/`nav-tree-row.tsx`/`nav-tree-utils.ts`) doğru uygulandığını kapsar:
 *   1) 4 seviyeli bir dalı GİRİNTİ ARTIR butonlarıyla kurup kaydetme + sayfa yenileme sonrası
 *      hiyerarşinin (DOM'daki iç-içe geçme derinliği + backend `parentId` zinciri) KALICI olması.
 *   2) 4 seviyeli bir dalın en derin (yaprak) öğesinde "Girinti artır" butonunun 5. seviyeye
 *      İZİN VERMEYECEK şekilde disabled olması.
 *   3) 2 seviyelik bir alt-ağacı (kendi çocuğu olan bir düğüm) zaten derin bir kardeş grubuna
 *      taşımaya çalışınca — toplam derinlik `NAVIGATION_MAX_DEPTH`'i AŞACAKSA — engellenmesi
 *      (`canIndent`'in `currentDepth + 1 + subtreeHeight(id) <= NAVIGATION_MAX_DEPTH` formülü).
 *   4) Bir ata öğeyi silmenin TÜM alt ağacı (torunları dahil) kaskad olarak kaldırması ve bunun
 *      kaydettikten sonra backend'e de yansıması (`removeItemCascade`).
 *
 * `[[project_revalidate_60s_staleness]]`: bu dosyadaki TÜM assertion'lar `/admin/navigation`
 * (kimlik doğrulamalı admin API, `next: revalidate` ÖNBELLEĞİ YOK) üzerinden çalışır — storefront
 * revalidation gecikmesi bu dosyayı ETKİLEMEZ (bkz. ayrı dosya `site-navigation-nested-flyout.spec.ts`).
 */
test.describe.configure({ timeout: 120_000, retries: 0 });

interface NavItemDto {
  id: string;
  label: string;
  href: string;
  order: number;
  parentId: string | null;
}
interface SocialLinkDto {
  id: string;
  platform: string;
  url: string;
  order: number;
}
interface FooterLinkDto {
  id: string;
  label: string;
  href: string;
  order: number;
}
interface FooterColumnDto {
  id: string;
  title: string;
  order: number;
  links: FooterLinkDto[];
}
interface NavConfigDto {
  headerCtaLabel: string | null;
  headerCtaHref: string | null;
  footerCopyrightText: string | null;
  navigationItems: NavItemDto[];
  socialLinks: SocialLinkDto[];
  footerColumns: FooterColumnDto[];
}

let adminPage: Page;
let closeAdminSession: () => Promise<void>;
let adminToken: string;
let originalConfig: NavConfigDto;

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(60_000);
  const session = await getCachedAdminSession();
  adminToken = session.accessToken;
  originalConfig = (await getNavigationConfig(adminToken)) as unknown as NavConfigDto;
  ({ page: adminPage, close: closeAdminSession } = await createAuthenticatedPage(browser));
  await adminPage.setViewportSize({ width: 1280, height: 960 });
});

test.afterAll(async () => {
  // `admin-navigation-editor.spec.ts` başlığındaki AYNI gerekçe — `PUT` tam-değiştirme
  // (replace) semantiğine sahip, orijinal state AYNEN geri yüklenir.
  if (adminToken && originalConfig) {
    await updateNavigationConfig(adminToken, buildNavPutPayload(originalConfig.navigationItems, originalConfig));
  }
  if (closeAdminSession) await closeAdminSession();
});

function buildNavPutPayload(items: NavItemDto[], base: NavConfigDto) {
  return {
    headerCtaLabel: base.headerCtaLabel,
    headerCtaHref: base.headerCtaHref,
    footerCopyrightText: base.footerCopyrightText,
    navigationItems: items.map((item) => ({
      id: item.id,
      label: item.label,
      href: item.href,
      order: item.order,
      parentId: item.parentId,
    })),
    socialLinks: base.socialLinks.map((link) => ({ platform: link.platform, url: link.url, order: link.order })),
    footerColumns: base.footerColumns.map((column) => ({
      title: column.title,
      order: column.order,
      links: column.links.map((link) => ({ label: link.label, href: link.href, order: link.order })),
    })),
  };
}

/** `admin-navigation-editor.spec.ts::setFixtureNavItems`'ın AYNISI — N adet kök-seviye kardeş
 *  kurar (parentId hepsi null). İndent butonlarıyla iç-içe geçirmenin BAŞLANGIÇ noktası. */
async function setFixtureRootItems(labels: string[]): Promise<string[]> {
  const ids = labels.map(() => crypto.randomUUID());
  const items: NavItemDto[] = labels.map((label, index) => ({
    id: ids[index]!,
    label,
    href: `/qa-nav-deep-root-${index}-${Date.now().toString(36)}`,
    order: index,
    parentId: null,
  }));
  await updateNavigationConfig(adminToken, buildNavPutPayload(items, originalConfig));
  return ids;
}

interface HierarchyNode {
  label: string;
  parentLabel: string | null;
}

/**
 * `{label, parentLabel}` düğüm listesinden `parentId` zinciri kurulmuş bir navigasyon fixture'ı
 * DOĞRUDAN API üzerinden (UI adımlarını atlayarak) kurar — Test 2/3 (5. seviye engeli, alt-ağaç
 * taşıma engeli) senaryolarının HAZIR bir hiyerarşiyle başlaması gerekir (kurulumun kendisi test
 * edilen davranış DEĞİL). Kardeş-kapsamlı `order`, her `parentId` grubu için ayrı sayılır (backend
 * kuralı — bkz. `navigation.schemas.ts` `NavigationItemInputSchema.order` açıklaması).
 */
async function setFixtureNavHierarchy(nodes: HierarchyNode[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const node of nodes) ids[node.label] = crypto.randomUUID();

  const orderCounters = new Map<string, number>();
  const items: NavItemDto[] = nodes.map((node) => {
    const parentId = node.parentLabel ? ids[node.parentLabel]! : null;
    const key = parentId ?? "__root__";
    const order = orderCounters.get(key) ?? 0;
    orderCounters.set(key, order + 1);
    return {
      id: ids[node.label]!,
      label: node.label,
      href: `/qa-nav-deep-hier-${node.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${Date.now().toString(36)}`,
      order,
      parentId,
    };
  });
  await updateNavigationConfig(adminToken, buildNavPutPayload(items, originalConfig));
  return ids;
}

async function domOrderLabels(page: Page): Promise<string[]> {
  return page.locator("span.flex-1.truncate.text-sm.font-medium.text-foreground").allTextContents();
}

async function waitForMenuLoaded(page: Page, firstLabel: string) {
  await expect(page.locator("span.flex-1.truncate.text-sm.font-medium.text-foreground").filter({ hasText: firstLabel })).toBeVisible({
    timeout: 15_000,
  });
}

async function saveNavigation(page: Page) {
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Navigasyon kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
}

/** Bir satırın grip ("Sürükle: {label}") tutamacından, o satırın KENDİ satır konteynerine
 *  (`admin-navigation-editor.spec.ts` test "5"teki AYNI xpath deseni) çıkar — indent/outdent/
 *  Kaldır butonlarının aria-label'ı satıra ÖZGÜ DEĞİL (tüm satırlarda AYNI statik metin), bu
 *  yüzden doğru satırı hedeflemek için satır konteynerine kadar yukarı çıkmak GEREKİR. */
function rowFor(page: Page, label: string) {
  const grip = page.getByRole("button", { name: `Sürükle: ${label}` });
  return grip.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
}

function indentButtonFor(page: Page, label: string) {
  return rowFor(page, label).getByRole("button", { name: "Girinti artır (alt öğe yap)" });
}

function outdentButtonFor(page: Page, label: string) {
  return rowFor(page, label).getByRole("button", { name: "Girinti azalt (üst seviyeye taşı)" });
}

/**
 * Bir satırın GÖRSEL iç-içe geçme derinliğini DOM'dan sayar — `nav-tree-editor.tsx::NavTreeBranch`
 * her bir alt seviyeyi `border-l border-dashed` sınıflı BİR sarmalayıcı `div` içine alır (Karar 4).
 * Bu, `nav-tree-utils.ts::getDepth`in (veri modeli derinliği) DOM'daki GERÇEK karşılığıdır —
 * "girinti korunuyor mu" iddiasını yalnızca API'ye değil, kullanıcının GÖRDÜĞÜ ağaca da dayandırır.
 */
async function domDepth(page: Page, label: string): Promise<number> {
  const grip = page.getByRole("button", { name: `Sürükle: ${label}` });
  return grip.locator("xpath=ancestor::div[contains(@class,'border-l') and contains(@class,'border-dashed')]").count();
}

test.describe("Navigasyon Yönetimi — çok seviyeli (4 katman) derinlik", () => {
  test("1) 4 seviyeli bir dal İndent butonlarıyla kurulur → kaydet → sayfa yenile → hiyerarşi (DOM + backend) KALICI", async () => {
    const suffix = Date.now().toString(36);
    const [labelA, labelB, labelC, labelD] = [
      `QA Derinlik Ürünler ${suffix}`,
      `QA Derinlik Aydınlatma ${suffix}`,
      `QA Derinlik Masa Lambaları ${suffix}`,
      `QA Derinlik Metal Lambalar ${suffix}`,
    ];
    await setFixtureRootItems([labelA, labelB, labelC, labelD]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelA);
    await expect(await domOrderLabels(adminPage)).toEqual([labelA, labelB, labelC, labelD]);
    // Başlangıçta hepsi kök seviye (derinlik 0).
    for (const label of [labelA, labelB, labelC, labelD]) {
      expect(await domDepth(adminPage, label)).toBe(0);
    }

    // B'yi bir kez indent et → A'nın çocuğu (derinlik 1).
    await indentButtonFor(adminPage, labelB).click();
    await expect.poll(() => domDepth(adminPage, labelB)).toBe(1);

    // C'yi İKİ kez indent et → önce A'nın çocuğu (B ile kardeş, derinlik 1), sonra B'nin çocuğu (derinlik 2).
    await indentButtonFor(adminPage, labelC).click();
    await expect.poll(() => domDepth(adminPage, labelC)).toBe(1);
    await indentButtonFor(adminPage, labelC).click();
    await expect.poll(() => domDepth(adminPage, labelC)).toBe(2);

    // D'yi ÜÇ kez indent et → sırasıyla derinlik 1, 2, 3 (C'nin çocuğu).
    await indentButtonFor(adminPage, labelD).click();
    await expect.poll(() => domDepth(adminPage, labelD)).toBe(1);
    await indentButtonFor(adminPage, labelD).click();
    await expect.poll(() => domDepth(adminPage, labelD)).toBe(2);
    await indentButtonFor(adminPage, labelD).click();
    await expect.poll(() => domDepth(adminPage, labelD)).toBe(3);

    // Zincir kuruldu: A(0) -> B(1) -> C(2) -> D(3). A hâlâ kök, B/C/D artık tek bir dal.
    expect(await domDepth(adminPage, labelA)).toBe(0);
    expect(await domDepth(adminPage, labelB)).toBe(1);
    expect(await domDepth(adminPage, labelC)).toBe(2);
    expect(await domDepth(adminPage, labelD)).toBe(3);

    await saveNavigation(adminPage);
    await adminPage.reload();
    await waitForMenuLoaded(adminPage, labelA);

    // Sayfa yenilendikten SONRA DOM derinliği (görsel girinti) AYNEN korunmalı.
    expect(await domDepth(adminPage, labelA)).toBe(0);
    expect(await domDepth(adminPage, labelB)).toBe(1);
    expect(await domDepth(adminPage, labelC)).toBe(2);
    expect(await domDepth(adminPage, labelD)).toBe(3);

    // Backend'de `parentId` zinciri de AYNEN kalıcı olmalı (DOM tek başına güvenilmez).
    const persisted = (await getNavigationConfig(adminToken)) as unknown as NavConfigDto;
    const byLabel = new Map(persisted.navigationItems.map((item) => [item.label, item] as const));
    const a = byLabel.get(labelA)!;
    const b = byLabel.get(labelB)!;
    const c = byLabel.get(labelC)!;
    const d = byLabel.get(labelD)!;
    expect(a.parentId).toBeNull();
    expect(b.parentId).toBe(a.id);
    expect(c.parentId).toBe(b.id);
    expect(d.parentId).toBe(c.id);
  });

  test("2) 4 seviyeli bir dalın en derin (yaprak) öğesinde 'Girinti artır' 5. seviyeye izin vermez (disabled)", async () => {
    const suffix = Date.now().toString(36);
    const [labelL0, labelL1, labelL2, labelL3] = [
      `QA Derinlik L0 ${suffix}`,
      `QA Derinlik L1 ${suffix}`,
      `QA Derinlik L2 ${suffix}`,
      `QA Derinlik L3 ${suffix}`,
    ];
    await setFixtureNavHierarchy([
      { label: labelL0, parentLabel: null },
      { label: labelL1, parentLabel: labelL0 },
      { label: labelL2, parentLabel: labelL1 },
      { label: labelL3, parentLabel: labelL2 },
    ]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelL0);
    expect(await domDepth(adminPage, labelL3)).toBe(3); // NAVIGATION_MAX_DEPTH = 3, zaten en derin seviyede.

    // En derin (yaprak, çocuksuz) öğenin indent butonu — bir seviye daha (5. görünür seviye,
    // ata sayısı 4) NAVIGATION_MAX_DEPTH'i (3) aşar, bu yüzden disabled OLMALI.
    await expect(indentButtonFor(adminPage, labelL3)).toBeDisabled();

    // Sağlık kontrolü: L3'ün OUTDENT'i (üst seviyeye çıkarma) hâlâ ENABLED — disabled olan
    // yalnızca indent, editör genel olarak bozulmamış.
    await expect(outdentButtonFor(adminPage, labelL3)).toBeEnabled();
  });

  test("3) 2 seviyelik bir alt-ağacı (çocuğu olan bir düğüm) zaten derin bir kardeş grubuna indent etmek NAVIGATION_MAX_DEPTH'i aşınca engellenir", async () => {
    const suffix = Date.now().toString(36);
    // A -> B -> C: 3 seviyelik bir zincir (C derinlik 2, C'nin kendi çocuğu YOK).
    // P -> Q: P kök seviyede (A'dan SONRA), Q P'nin tek çocuğu — yani P kendi başına 2 seviyelik
    // bir alt-ağaç (subtreeHeight(P) = 1).
    const [labelA, labelB, labelC, labelP, labelQ] = [
      `QA Derinlik Taşıma A ${suffix}`,
      `QA Derinlik Taşıma B ${suffix}`,
      `QA Derinlik Taşıma C ${suffix}`,
      `QA Derinlik Taşıma P ${suffix}`,
      `QA Derinlik Taşıma Q ${suffix}`,
    ];
    await setFixtureNavHierarchy([
      { label: labelA, parentLabel: null },
      { label: labelB, parentLabel: labelA },
      { label: labelC, parentLabel: labelB },
      { label: labelP, parentLabel: null },
      { label: labelQ, parentLabel: labelP },
    ]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelA);
    expect(await domDepth(adminPage, labelC)).toBe(2);
    expect(await domDepth(adminPage, labelP)).toBe(0);
    expect(await domDepth(adminPage, labelQ)).toBe(1);

    // 1. indent: P (+ alt ağacı Q) A'nın çocuğu olur (derinlik 1) — B ile kardeş.
    // Toplam derinlik (P=1, Q=2) hâlâ NAVIGATION_MAX_DEPTH(3) içinde — İZİN VERİLİR.
    await indentButtonFor(adminPage, labelP).click();
    await expect.poll(() => domDepth(adminPage, labelP)).toBe(1);
    expect(await domDepth(adminPage, labelQ)).toBe(2);

    // 2. indent: P, B'nin çocuğu olur (derinlik 2) — C ile kardeş. Toplam derinlik (P=2, Q=3)
    // TAM SINIRDA (3) — hâlâ İZİN VERİLİR (aşmıyor, eşitliği aşmıyor).
    await indentButtonFor(adminPage, labelP).click();
    await expect.poll(() => domDepth(adminPage, labelP)).toBe(2);
    expect(await domDepth(adminPage, labelQ)).toBe(3);

    // 3. indent DENEMESİ: P, C'nin çocuğu olsaydı derinlik 3 olurdu VE Q (P'nin çocuğu) derinlik
    // 4'e (NAVIGATION_MAX_DEPTH=3'ü AŞAR) çıkardı — bu yüzden buton artık DISABLED olmalı. Bu,
    // "2 seviyelik bir alt-ağacı zaten derin bir noktaya taşımak" senaryosunun TAM karşılığıdır:
    // C (hedef kardeş grubunun mevcut en derin üyesi) burada `hasPrecedingSibling` koşulunu
    // SAĞLAR (yani engelin nedeni "önceki kardeş yok" DEĞİL, GERÇEKTEN derinlik tavanıdır).
    await expect(indentButtonFor(adminPage, labelP)).toBeDisabled();

    // Editörün mevcut (GEÇERLİ, sınırda) durumu sorunsuz kaydedilebilmeli — UI'ın engellemesi
    // yalnızca GÖRSEL bir kısıtlama değil, altındaki state de HER ZAMAN geçerli kalıyor.
    await saveNavigation(adminPage);
    const persisted = (await getNavigationConfig(adminToken)) as unknown as NavConfigDto;
    const byLabel = new Map(persisted.navigationItems.map((item) => [item.label, item] as const));
    expect(byLabel.get(labelP)!.parentId).toBe(byLabel.get(labelB)!.id);
    expect(byLabel.get(labelQ)!.parentId).toBe(byLabel.get(labelP)!.id);
  });

  test("4) Ata öğeyi silmek TÜM alt ağacı (torunları dahil) kaskad kaldırır — kaydedince backend'e de yansır", async () => {
    const suffix = Date.now().toString(36);
    const [labelA, labelB, labelC] = [
      `QA Derinlik Sil A ${suffix}`,
      `QA Derinlik Sil B ${suffix}`,
      `QA Derinlik Sil C ${suffix}`,
    ];
    await setFixtureNavHierarchy([
      { label: labelA, parentLabel: null },
      { label: labelB, parentLabel: labelA },
      { label: labelC, parentLabel: labelB },
    ]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelA);
    await expect(await domOrderLabels(adminPage)).toEqual([labelA, labelB, labelC]);

    // A'nın (Level 1 — en üstteki ata) satırını genişlet ("Düzenle") — "Kaldır" butonu yalnızca
    // genişletilmiş satır-içi accordion'da görünür (bkz. nav-tree-row.tsx). NOT: bu accordion
    // paneli, satır (`rounded-lg`) `div`inin bir ÇOCUĞU DEĞİL, KARDEŞİDİR (ikisi de aynı
    // sınıfsız dış `div`in altında) — bu yüzden `rowFor()` (en yakın `rounded-lg` atası) "Kaldır"
    // butonunu KAPSAMAZ. Bu adımda yalnızca TEK bir satırın accordion'u açık olduğundan
    // (senaryo diğer satırları genişletmiyor) global bir `getByRole` GÜVENLİDİR/tekildir.
    await rowFor(adminPage, labelA).getByRole("button", { name: "Düzenle" }).click();
    await adminPage.getByRole("button", { name: "Kaldır" }).click();

    // A + TÜM alt ağacı (B, C) DOM'dan kaybolmalı — yalnızca B/C değil, A'nın kendisi de gitti
    // (silinen ATA, torunları DEĞİL).
    await expect(adminPage.getByText("Menü öğesi yok")).toBeVisible();
    expect(await domOrderLabels(adminPage)).toEqual([]);

    await saveNavigation(adminPage);
    await adminPage.reload();
    await expect(adminPage.getByText("Menü öğesi yok")).toBeVisible({ timeout: 15_000 });

    // Backend'de de üçü de (A, B, C) TAMAMEN silinmiş olmalı.
    const persisted = (await getNavigationConfig(adminToken)) as unknown as NavConfigDto;
    const remainingLabels = persisted.navigationItems.map((item) => item.label);
    expect(remainingLabels).not.toContain(labelA);
    expect(remainingLabels).not.toContain(labelB);
    expect(remainingLabels).not.toContain(labelC);
  });
});
