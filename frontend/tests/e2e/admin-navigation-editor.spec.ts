import { test, expect, type Page } from "@playwright/test";
import crypto from "node:crypto";
import { getCachedAdminSession, getNavigationConfig, updateNavigationConfig } from "./support/api";
import { createAuthenticatedPage } from "./support/admin-session";

/**
 * qa-agent — Navigasyon Yönetimi panelinin (`/admin/navigation`, `NavTreeEditor`/`NavTreeRow`)
 * İLK e2e kapsamı. Bu turda eklenen fail-safe Yukarı/Aşağı taşı düğmeleri (Karar 5.6 —
 * `nav-tree-row.tsx::NavTreeRow`) VE `DndContext`'e eklenen `restrictToVerticalAxis`/
 * `restrictToWindowEdges` modifier'larını (bkz. görev bağlamı) doğrular.
 *
 * qa-agent BULGUSU (frontend-agent'a yönlendirilecek — bu dosyada TEKRARLANMAZ/kodlanmaz, bkz.
 * görev özeti): `restrictToVerticalAxis`, dnd-kit'in `DndContext` seviyesinde `onDragMove`/
 * `onDragEnd` event'lerinin `delta.x`'ini KAYNAKTA sıfırlar (`applyModifiers` render transform'una
 * DEĞİL, `scrollAdjustedTranslate`'e — yani event payload'ına — uygulanır; bkz.
 * `node_modules/@dnd-kit/core/dist/core.esm.js`, `onDragMove`/`createHandler(Action.DragEnd)`).
 * `nav-tree-editor.tsx::handleDragMove` tam olarak bu `event.delta.x`'i `offsetLeft`'e yazıp
 * `previewProjection`/`moveItem`'ın yatay-sürükleme-ile-girinti (Karar 5.3, "sağa sürükleyerek alt
 * öğe yap") mantığına besliyor — modifier eklendiğinden beri `offsetLeft` HER ZAMAN 0, yani
 * SÜRÜKLEYEREK girintileme artık SESSİZCE çalışmıyor (yalnızca aynı derinlikte yeniden sıralama
 * çalışıyor). Girinti artır/azalt düğmeleri (`ChevronRight`/`ChevronLeft`) fail-safe olarak hâlâ
 * çalıştığından kullanıcı tamamen kilitli KALMIYOR, ama bu YİNE DE gerçek bir regresyon — sayfadaki
 * "sağa sürükleyerek ... bir üst öğenin altına taşıyın" ipucu artık YANLIŞ. Bu dosyadaki testler
 * SADECE aynı derinlikte (root-seviye kardeşler arası) sürükleme/buton akışlarını kapsar — bunlar
 * bu regresyondan ETKİLENMEZ, bu yüzden aşağıda "PASS" olmaları modifier'ın güvenli olduğu
 * anlamına GELMEZ.
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
});
