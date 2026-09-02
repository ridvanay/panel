import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { getCachedAdminSession, getNavigationConfig, updateNavigationConfig } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — Navigasyon Yönetimi panelinin (`/admin/navigation`, `NavTreeEditor`/`NavTreeRow`)
 * e2e kapsamı. Fail-safe Yukarı/Aşağı taşı düğmelerini (Karar 5.6 — `nav-tree-row.tsx::NavTreeRow`),
 * `DndContext`'e eklenen `restrictToWindowEdges` modifier'ını VE `DragOverlay`'in koordinat
 * sapması düzeltmesini (`createPortal(..., document.body)` + `DragOverlay`'e ÖZEL
 * `modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}`) doğrular.
 *
 * qa-agent GEÇMİŞ BULGUSU — GÜNCEL DURUM İÇİN DÜZELTİLDİ (bkz. test "5"): önceki bir turda
 * `restrictToVerticalAxis` `DndContext` SEVİYESİNDE eklenmişti; bu, `onDragMove`/`onDragEnd`
 * event'lerinin `delta.x`'ini KAYNAKTA sıfırlıyordu (`applyModifiers`'ın `scrollAdjustedTranslate`
 * hesabına uygulanması — bkz. `node_modules/@dnd-kit/core/dist/core.esm.js` ~satır 2957-2976) ve
 * `nav-tree-editor.tsx::handleDragMove`'daki `offsetLeft`'i (dolayısıyla sağa-sürükleyerek-girintileme,
 * Karar 5.3) SESSİZCE bozuyordu. Bu regresyon `DndContext`'ten `restrictToVerticalAxis`'ı çıkarıp
 * SADECE `restrictToWindowEdges` bırakarak düzeltildi. Bu turdaki koordinat-sapması fix'i
 * `restrictToVerticalAxis`'ı GERİ getiriyor ama BU SEFER yalnızca `DragOverlay` bileşeninin KENDİ
 * `modifiers` prop'unda — bu, dnd-kit'te AYRI bir kod yolu (`DragOverlay` kendi `applyModifiers`
 * çağrısını SADECE render edilen overlay'in GÖRSEL `transform`'u için yapar, bkz. aynı dosya ~satır
 * 3897-3937/3925) ve `DndContext`'in `translate`/`delta` hesabına (dolayısıyla `event.delta.x`'e)
 * HİÇ katkı vermez — `nav-tree-editor.tsx`'teki `<DndContext modifiers={[restrictToWindowEdges]}>`
 * (yalnızca) DEĞİŞMEDİ. Yani sağa-sürükleyerek-girintileme YENİDEN ÇALIŞIYOR OLMALI — test "5" bunu
 * GERÇEK bir sürükleme ile doğrular (yalnızca varsayımla bırakılmaz).
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
  // Orijinal state'i AYNEN geri yükle — `admin-appearance-*.spec.ts`teki `original` + restore
  // deseniyle AYNI. `PUT /admin/navigation` tam-değiştirme (replace) semantiğine sahip olduğundan
  // (bkz. `support/api.ts::updateNavigationConfig` başlığı) HER alan geri yazılmalı.
  if (adminToken && originalConfig) {
    await updateNavigationConfig(adminToken, buildNavPutPayload(originalConfig.navigationItems, originalConfig));
  }
  if (closeAdminSession) await closeAdminSession();
});

/** `originalConfig`'ten (veya herhangi bir `NavConfigDto`'dan) `headerCta*`/social/footer alanlarını
 *  KORUYARAK, YALNIZCA `navigationItems`'ı değiştiren bir `PUT` gövdesi üretir. */
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

/** Test başına benzersiz (çakışmayı önleyen), 3 kök-seviye kardeş içeren bir menü fixture'ı
 *  `PUT /admin/navigation` ile doğrudan API'den kurar — UI adımlarını atlayan hızlı kurulum
 *  (`admin-slider-studio.spec.ts`teki `createSlider`/`createSlide` fixture desenleriyle AYNI amaç). */
async function setFixtureNavItems(labels: [string, string, string]): Promise<string[]> {
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const items: NavItemDto[] = labels.map((label, index) => ({
    id: ids[index]!,
    label,
    href: `/qa-nav-fixture-${index + 1}-${Date.now().toString(36)}`,
    order: index,
    parentId: null,
  }));
  await updateNavigationConfig(adminToken, buildNavPutPayload(items, originalConfig));
  return ids;
}

/** Menü ağacındaki TÜM satırların etiketlerini, DOM'daki (render) sırasıyla döner —
 *  `nav-tree-row.tsx::NavTreeRow` satır etiketine ÖZGÜ sınıf kombinasyonu (grep ile doğrulandı:
 *  projede yalnızca `NavTreeRow` ve sürükleme sırasında mount olan `NavTreeRowOverlay`de
 *  kullanılıyor — sürükleme aktif DEĞİLKEN sayfada tek kaynak budur). */
async function domOrderLabels(page: Page): Promise<string[]> {
  return page.locator("span.flex-1.truncate.text-sm.font-medium.text-foreground").allTextContents();
}

/** Sağ panel "Menü Yapısı" kartındaki ilk satırın görünür olmasını bekler — sayfa/veri yüklendi
 *  kanıtı (`load()` async, `Spinner` yerine gerçek içerik render edildi). */
async function waitForMenuLoaded(page: Page, firstLabel: string) {
  await expect(page.locator("span.flex-1.truncate.text-sm.font-medium.text-foreground").filter({ hasText: firstLabel })).toBeVisible({
    timeout: 15_000,
  });
}

async function saveNavigation(page: Page) {
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page.getByText("Navigasyon kaydedildi.").last()).toBeVisible({ timeout: 10_000 });
}

test.describe("Navigasyon Yönetimi — menü ağacı", () => {
  test("1) Aşağı taşı butonu sırayı değiştirir → kaydet → sayfa yenile → sıra backend'de KALICI", async () => {
    const [labelA, labelB, labelC] = [
      `QA Nav Buton A ${Date.now().toString(36)}`,
      `QA Nav Buton B ${Date.now().toString(36)}`,
      `QA Nav Buton C ${Date.now().toString(36)}`,
    ];
    await setFixtureNavItems([labelA, labelB, labelC]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelA);
    await expect(await domOrderLabels(adminPage)).toEqual([labelA, labelB, labelC]);

    // A'yı bir kere aşağı taşı — kardeş grubu içinde (Karar 5.6, `moveSibling`) B ile yer değiştirir.
    await adminPage.getByRole("button", { name: `Aşağı taşı: ${labelA}` }).click();
    await expect(await domOrderLabels(adminPage)).toEqual([labelB, labelA, labelC]);

    await saveNavigation(adminPage);
    await adminPage.reload();
    await waitForMenuLoaded(adminPage, labelB);
    await expect(await domOrderLabels(adminPage)).toEqual([labelB, labelA, labelC]);

    // Backend seviyesinde de doğrula — DOM tek başına güvenilmez (`admin-slider-studio.spec.ts`
    // test "5"teki AYNI gerekçe).
    const persisted = (await getNavigationConfig(adminToken)) as unknown as NavConfigDto;
    const persistedOrder = persisted.navigationItems
      .filter((item) => item.parentId === null && [labelA, labelB, labelC].includes(item.label))
      .sort((a, b) => a.order - b.order)
      .map((item) => item.label);
    expect(persistedOrder).toEqual([labelB, labelA, labelC]);
  });

  test("2) İlk öğede 'Yukarı taşı', son öğede 'Aşağı taşı' disabled — orta öğenin HİÇBİRİ disabled değil", async () => {
    const [labelG, labelH, labelI] = [
      `QA Nav Disabled G ${Date.now().toString(36)}`,
      `QA Nav Disabled H ${Date.now().toString(36)}`,
      `QA Nav Disabled I ${Date.now().toString(36)}`,
    ];
    await setFixtureNavItems([labelG, labelH, labelI]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelG);

    await expect(adminPage.getByRole("button", { name: `Yukarı taşı: ${labelG}` })).toBeDisabled();
    await expect(adminPage.getByRole("button", { name: `Aşağı taşı: ${labelG}` })).toBeEnabled();

    await expect(adminPage.getByRole("button", { name: `Yukarı taşı: ${labelH}` })).toBeEnabled();
    await expect(adminPage.getByRole("button", { name: `Aşağı taşı: ${labelH}` })).toBeEnabled();

    await expect(adminPage.getByRole("button", { name: `Yukarı taşı: ${labelI}` })).toBeEnabled();
    await expect(adminPage.getByRole("button", { name: `Aşağı taşı: ${labelI}` })).toBeDisabled();
  });

  test("3) Menü öğesini sürükle-bırakla yeniden sırala → sıra değişir → kaydet → sayfa yenile → KALICI", async () => {
    const [labelD, labelE, labelF] = [
      `QA Nav Surukle D ${Date.now().toString(36)}`,
      `QA Nav Surukle E ${Date.now().toString(36)}`,
      `QA Nav Surukle F ${Date.now().toString(36)}`,
    ];
    await setFixtureNavItems([labelD, labelE, labelF]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelD);
    await expect(await domOrderLabels(adminPage)).toEqual([labelD, labelE, labelF]);

    // dnd-kit `PointerSensor` (`activationConstraint: distance 6`) — `admin-slider-studio.spec.ts`
    // test "5"teki AYNI kanıtlanmış manuel `mouse.move` sekansı deseni, birkaç deneme ile tekrarlanır
    // (bu ortamda sentetik imleç olaylarının ara sıra kaçırılması bilinen bir kategori, uygulama
    // kodu DEĞİL). D'nin tutamacını F'nin biraz altına bırakır — D en sona gitmeli.
    const gripD = adminPage.getByRole("button", { name: `Sürükle: ${labelD}` });
    const gripF = adminPage.getByRole("button", { name: `Sürükle: ${labelF}` });

    let reordered = false;
    for (let attempt = 1; attempt <= 4 && !reordered; attempt++) {
      const src = await gripD.boundingBox();
      const dst = await gripF.boundingBox();
      if (!src || !dst) throw new Error("Sürükleme tutamacı bounding box'ı bulunamadı.");
      const startX = src.x + src.width / 2;
      const startY = src.y + src.height / 2;
      const endX = dst.x + dst.width / 2;
      const endY = dst.y + dst.height + 10; // F'nin biraz altına bırak — D en sona gitsin

      await adminPage.mouse.move(startX, startY);
      await adminPage.mouse.down();
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await adminPage.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
        await adminPage.waitForTimeout(35);
      }
      await adminPage.mouse.up();
      await adminPage.waitForTimeout(300);

      const order = await domOrderLabels(adminPage);
      reordered = order.join(",") !== [labelD, labelE, labelF].join(",");
    }

    const orderAfterDrag = await domOrderLabels(adminPage);
    expect(orderAfterDrag).not.toEqual([labelD, labelE, labelF]);
    expect(orderAfterDrag.slice().sort()).toEqual([labelD, labelE, labelF].slice().sort());

    await saveNavigation(adminPage);
    await adminPage.reload();
    await waitForMenuLoaded(adminPage, orderAfterDrag[0]!);
    await expect(await domOrderLabels(adminPage)).toEqual(orderAfterDrag);

    const persisted = (await getNavigationConfig(adminToken)) as unknown as NavConfigDto;
    const persistedOrder = persisted.navigationItems
      .filter((item) => item.parentId === null && [labelD, labelE, labelF].includes(item.label))
      .sort((a, b) => a.order - b.order)
      .map((item) => item.label);
    expect(persistedOrder).toEqual(orderAfterDrag);
  });

  test("4) Sürükleme sırasında DragOverlay document.body'nin DOĞRUDAN altına portal edilir (koordinat sapması düzeltmesi)", async () => {
    // Kaynak: `nav-tree-editor.tsx` — `createPortal(<DragOverlay ...>, document.body)`. dnd-kit'in
    // `DragOverlay` implementasyonu (`PositionedOverlay`, bkz. `core.esm.js` ~satır 3640-3676) TEK
    // bir `position: fixed` `div` render eder, ara sarmalayıcı YOKTUR (`NullifiedContextProvider`/
    // `AnimationManager` yalnızca React context/Fragment, DOM düğümü EKLEMEZ) — bu yüzden bu div'in
    // `parentElement`'i `document.body`'nin TA KENDİSİ olmalı. Piksel-hassasiyetinde offset ölçmek
    // yerine (kırılgan) DOM'un GERÇEKTEN portal edildiğini doğrulamak, düzeltmenin amacını (üst
    // kapsayıcıların `transform`/`relative`/`overflow`'undan etkilenmemesi) doğrudan kanıtlar.
    const [labelJ, labelK, labelL] = [
      `QA Nav Portal J ${Date.now().toString(36)}`,
      `QA Nav Portal K ${Date.now().toString(36)}`,
      `QA Nav Portal L ${Date.now().toString(36)}`,
    ];
    await setFixtureNavItems([labelJ, labelK, labelL]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelJ);

    const gripJ = adminPage.getByRole("button", { name: `Sürükle: ${labelJ}` });
    const box = await gripJ.boundingBox();
    if (!box) throw new Error("Sürükleme tutamacı bounding box'ı bulunamadı.");
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await adminPage.mouse.move(startX, startY);
    await adminPage.mouse.down();
    // `PointerSensor` aktivasyon eşiğini (`activationConstraint: { distance: 6 }`) aşacak kadar hareket.
    await adminPage.mouse.move(startX + 15, startY + 25);

    const overlay = adminPage.locator('[class*="ring-primary/40"]').first();
    await expect(overlay).toBeVisible({ timeout: 5_000 });
    await expect(overlay).toContainText(labelJ);

    const portaledDirectlyUnderBody = await overlay.evaluate((el) => {
      // `[class*="ring-primary/40"]` `NavTreeRowOverlay`'in KENDİ iç div'ini eşleştirir —
      // dnd-kit'in `position: fixed` uyguladığı ASIL sarmalayıcı (`PositionedOverlay`) bunun
      // BİR ÜSTÜNDEKİ ebeveyndir. En yakın `position: fixed` atayı bulup ONUN `document.body`'nin
      // DOĞRUDAN çocuğu olduğunu doğrula — iç içerik yapısından (kaç seviye `div` sardığından)
      // BAĞIMSIZ, sağlam bir kontrol.
      let node: HTMLElement | null = el as HTMLElement;
      while (node && node !== document.body) {
        if (getComputedStyle(node).position === "fixed") {
          return node.parentElement === document.body;
        }
        node = node.parentElement;
      }
      return false;
    });
    expect(portaledDirectlyUnderBody).toBe(true);

    await adminPage.mouse.up();
  });

  test("5) Menü öğesini sağa sürüklemek bir önceki kök öğenin ALTINA iç içe geçirir (drag-to-indent, offsetLeft/delta.x KORUNUYOR)", async () => {
    // Bu test, dosya başlığındaki "geçmiş bulgu" notunun GÜNCEL kodda artık geçerli olmadığını
    // kanıtlar: `DragOverlay`'e özel `modifiers` prop'u `DndContext`'in `delta.x`'ini SIFIRLAMAZ
    // (bkz. başlık yorumu) — bu yüzden sağa-sürükleyerek-girintileme (Karar 5.3) hâlâ çalışmalı.
    const [labelP, labelQ, labelR] = [
      `QA Nav Indent P ${Date.now().toString(36)}`,
      `QA Nav Indent Q ${Date.now().toString(36)}`,
      `QA Nav Indent R ${Date.now().toString(36)}`,
    ];
    await setFixtureNavItems([labelP, labelQ, labelR]);

    await adminPage.goto("/admin/navigation");
    await waitForMenuLoaded(adminPage, labelP);

    // Q'nun (orta kök öğe) "Girinti azalt" düğmesi — `canOutdent` SADECE `depth === 1`'de aktif
    // olur (bkz. `nav-tree-utils.ts::canOutdent`), bu yüzden başlangıçta (kök seviye) disabled
    // olması beklenir; sürükleme sonrası ENABLED olması Q'nun artık bir üst öğenin ÇOCUĞU olduğunun
    // (yani sürükleyerek-girintilemenin GERÇEKTEN çalıştığının) DOM kanıtıdır.
    const gripQ = adminPage.getByRole("button", { name: `Sürükle: ${labelQ}` });
    const gripR = adminPage.getByRole("button", { name: `Sürükle: ${labelR}` });
    const rowQ = gripQ.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    const outdentQ = rowQ.getByRole("button", { name: "Girinti azalt (üst seviyeye taşı)" });
    await expect(outdentQ).toBeDisabled();

    // Q'yu R'nin biraz altına VE sağa (INDENTATION_WIDTH=32px'i aşacak kadar) sürükle — `over` R'ye
    // düşünce, Q'dan önceki kök öğe (P) `previousItem` olur ve `computeProjection` Q'yu P'nin
    // ÇOCUĞU yapar (bkz. `nav-tree-utils.ts::computeProjection`/`moveItem`).
    let indented = false;
    for (let attempt = 1; attempt <= 4 && !indented; attempt++) {
      const src = await gripQ.boundingBox();
      const dst = await gripR.boundingBox();
      if (!src || !dst) throw new Error("Sürükleme tutamacı bounding box'ı bulunamadı.");
      const startX = src.x + src.width / 2;
      const startY = src.y + src.height / 2;
      const endX = startX + 80; // sağa >32px
      const endY = dst.y + dst.height + 10; // R'nin biraz altına

      await adminPage.mouse.move(startX, startY);
      await adminPage.mouse.down();
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await adminPage.mouse.move(startX + (endX - startX) * t, startY + (endY - startY) * t);
        await adminPage.waitForTimeout(35);
      }
      await adminPage.mouse.up();
      await adminPage.waitForTimeout(300);

      indented = await outdentQ.isDisabled().then((disabled) => !disabled);
    }

    await expect(outdentQ).toBeEnabled();

    await saveNavigation(adminPage);
    await adminPage.reload();
    await waitForMenuLoaded(adminPage, labelP);
    await expect(outdentQ).toBeEnabled();

    const persisted = (await getNavigationConfig(adminToken)) as unknown as NavConfigDto;
    const p = persisted.navigationItems.find((item) => item.label === labelP);
    const q = persisted.navigationItems.find((item) => item.label === labelQ);
    const r = persisted.navigationItems.find((item) => item.label === labelR);
    expect(p && q && r).toBeTruthy();
    expect(q!.parentId).toBe(p!.id); // Q artık P'nin çocuğu — sunucuda KALICI
    expect(r!.parentId).toBeNull(); // R hâlâ kök seviyede
  });
});
