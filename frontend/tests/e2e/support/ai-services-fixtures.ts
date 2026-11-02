/**
 * qa-agent — Paket AI e2e yardımcıları: saas_e2e'deki hizmet/uzmanlık durumunu doğrular, eski fixture uzmanlıkları
 * (kardiyoloji-N vb.) yalnızca test süresince pasife alır ve geri açar. Veri silinmez.
 */
import { expect, type Page } from "@playwright/test";
import { API_BASE_URL } from "./api";

/** AI menü grupları için gereken 11 üst uzmanlık + gastroenterology alt uzmanlıkları. */
export const AI_PARENT_SLUGS = [
  "obesity-and-metabolic-surgery",
  "surgical-oncology",
  "thoracic-surgery",
  "neurosurgery",
  "gastroenterology",
  "interventional-radiology-specialist",
  "plastic-and-aesthetic-surgery",
  "dentalcare",
  "orthodontist",
  "hair-transplantation",
  "ivf-and-reproductive-health",
] as const;
export const AI_CHILD_SLUGS = ["ercp", "esd", "poem"] as const;

/** Beklenen gruplar (anahtar -> EN başlık, hizmet adları grup içi sırayla). */
export const EXPECTED_GROUPS = [
  { id: "surgery-oncology", title: /Surgery\s*&\s*Oncology/i, items: ["Obesity & Metabolic Surgery", "Surgical Oncology", "Thoracic Surgery", "Neurosurgery"] },
  { id: "digestive-interventional", title: /Digestive\s*&\s*Interventional/i, items: ["Gastroenterology", "Interventional Radiology"] },
  { id: "aesthetic-dental-hair", title: /Aesthetic,\s*Dental\s*&\s*Hair/i, items: ["Plastic & Aesthetic Surgery", "Dental Care", "Orthodontics", "Hair Transplantation"] },
  { id: "fertility", title: /Fertility/i, items: ["IVF & Reproductive Health"] },
] as const;

interface AdminSpecialty {
  id: string;
  slug: string;
  isActive: boolean;
}

function headers(token: string) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

/** saas_e2e AI durumunda mı? (rename-service-labels uygulanmış + 11 üst uzmanlık var). Değilse açık hata. */
export async function assertAiState(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/specialties?locale=en`);
  const list = ((await res.json()) as { data: Array<{ slug: string; name: string; serviceGroup: string | null; shortDescription: string | null }> }).data;
  const bySlug = new Map(list.map((s) => [s.slug, s]));
  for (const slug of AI_PARENT_SLUGS) {
    const s = bySlug.get(slug);
    if (!s || !s.serviceGroup || !s.shortDescription) {
      throw new Error(
        `saas_e2e AI durumunda değil: "${slug}" yok ya da serviceGroup/shortDescription boş. Önce 'npx prisma migrate deploy' ve 'scripts/rename-service-labels.ts --cta --confirm=rename-service-labels --operator=qa' çalıştırın (talimat: docs/prompts/2026-11-02-AI-hizmet-menusu-randevu-bulucu.md).`
      );
    }
  }
}

/** AI slug'ları dışındaki aktif uzmanlıkları pasife alır (Other grubu ve eski fixture'lar menüyü bozmasın). Geri açmak için id'leri döner. */
export async function deactivateNonAiSpecialties(token: string): Promise<string[]> {
  const keep = new Set<string>([...AI_PARENT_SLUGS, ...AI_CHILD_SLUGS]);
  const res = await fetch(`${API_BASE_URL}/admin/telehealth/specialties`, { headers: headers(token) });
  const list = ((await res.json()) as { data: AdminSpecialty[] }).data;
  const ids: string[] = [];
  for (const s of list.filter((x) => x.isActive && !keep.has(x.slug))) {
    const r = await fetch(`${API_BASE_URL}/admin/telehealth/specialties/${s.id}`, { method: "PATCH", headers: headers(token), body: JSON.stringify({ isActive: false }) });
    if (r.ok) ids.push(s.id);
  }
  return ids;
}

export async function reactivateSpecialties(token: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    await fetch(`${API_BASE_URL}/admin/telehealth/specialties/${id}`, { method: "PATCH", headers: headers(token), body: JSON.stringify({ isActive: true }) }).catch(() => undefined);
  }
}

/**
 * Masaüstü mega menüyü açar. ISR/önbellek gecikmesi (60 sn) için "Other" grubu kalkana ve 4 grup görünene dek
 * yeniden yükleyerek yoklar (toPass + reload).
 */
export async function openMegaMenu(page: Page, path = "/"): Promise<void> {
  await page.goto(path);
  await expect(async () => {
    await page.reload();
    await page.getByTestId("services-mega-trigger").click();
    await expect(page.getByTestId("services-mega-menu")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("services-group-fertility")).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId("services-group-other")).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: 120_000, intervals: [2_000, 5_000, 10_000] });
}

/** Menü yüksekliği oturana (açılış animasyonu bitene) dek bekleyip px değerini döner. */
export async function settledMenuHeight(page: Page): Promise<number> {
  const menu = page.getByTestId("services-mega-menu");
  let last = -1;
  await expect
    .poll(
      async () => {
        const box = await menu.boundingBox();
        const h = Math.round(box?.height ?? 0);
        const stable = h > 0 && h === last;
        last = h;
        return stable;
      },
      { timeout: 10_000, intervals: [200] }
    )
    .toBe(true);
  return last;
}

/** Eşleştirme sihirbazında arama kutusundan bir konu seçer (konu etiketinin bir kısmı ile). */
export async function pickTopicBySearch(page: Page, query: string, optionName: RegExp): Promise<void> {
  const search = page.getByTestId("matcher-search");
  await search.fill(query);
  const option = page.getByTestId("matcher-search-option").filter({ hasText: optionName }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

/** Adım 1'den sonuç ekranına (5) kadar anonim akış: izin kutuları işaretlenmez, kişisel veri gönderilmez. */
export async function walkWizardToResult(page: Page): Promise<void> {
  const next = page.getByTestId("matcher-continue");
  await next.click(); // adım 1 -> 2
  // Dilden bağımsız: radio'lar name/value ile seçilir.
  await page.locator('input[type="radio"][name="forWhom"][value="self"]').check();
  await page.locator('input[type="radio"][name="duration"][value="lt1w"]').check();
  await page.locator('input[type="radio"][name="prior"][value="unknown"]').check();
  await next.click(); // 2 -> 3
  await page.locator('input[type="radio"][name="preference"][value="online"]').check();
  await next.click(); // 3 -> 4
  await expect(page.locator('[data-testid="physician-matcher"][data-step="4"]')).toBeVisible();
  await next.click(); // 4 -> 5 (anonim)
  await expect(page.getByTestId("matcher-result")).toBeVisible({ timeout: 20_000 });
}

/** Türkçeye özgü harfler (ı İ ş Ş ğ Ğ ç Ç ö Ö ü Ü); "Türkiye" yazımı hariç. */
export function turkishLetterHits(text: string): string[] {
  const cleaned = text.replace(/T[üu]rkiye/gi, "");
  return cleaned.match(/[çÇğĞıİşŞöÖüÜ]/g) ?? [];
}

/** Sihirbaz konu -> yeni hizmet eşlemesi (saas_e2e'de konular yalnızca eski fixture uzmanlıklara bağlı). */
const TOPIC_TO_SERVICE: Record<string, string> = {
  obesity: "obesity-and-metabolic-surgery",
  "hair-loss": "hair-transplantation",
  "dental-implant": "dentalcare",
  "reflux-heartburn": "gastroenterology",
  ivf: "ivf-and-reproductive-health",
  "bile-duct-stones-jaundice": "gastroenterology",
};

/**
 * İdempotent, yalnızca ekleme: ilgili bakım konularına AI hizmet uzmanlığını ağırlık 100 ile ekler (var olan ağırlıklar korunur).
 * Böylece "Find your treatment" sonucu AI hizmetlerini önerir. Veri silinmez; geri alma: konuyu önceki ağırlıklarla PUT etmek.
 */
export async function ensureTopicServiceLinks(token: string): Promise<void> {
  const specs = ((await (await fetch(`${API_BASE_URL}/specialties`)).json()) as { data: Array<{ id: string; slug: string }> }).data;
  const idOf = (slug: string) => specs.find((s) => s.slug === slug)?.id;
  const topics = ((await (await fetch(`${API_BASE_URL}/admin/matcher/topics`, { headers: headers(token) })).json()) as {
    data: Array<{ id: string; slug: string; bodyArea: string; translations: unknown; isRedFlag: boolean; isActive: boolean; sortOrder: number; targetSpecialtyHint: string | null; weights: Array<{ specialtyId: string; weight: number }> }>;
  }).data;
  for (const [topicSlug, serviceSlug] of Object.entries(TOPIC_TO_SERVICE)) {
    const topic = topics.find((t) => t.slug === topicSlug);
    const specialtyId = idOf(serviceSlug);
    if (!topic || !specialtyId || topic.weights.some((w) => w.specialtyId === specialtyId)) continue;
    const weights = [...topic.weights.map((w) => ({ specialtyId: w.specialtyId, weight: w.weight })), { specialtyId, weight: 100 }];
    const res = await fetch(`${API_BASE_URL}/admin/matcher/topics/${topic.id}`, {
      method: "PUT",
      headers: headers(token),
      body: JSON.stringify({ slug: topic.slug, bodyArea: topic.bodyArea, translations: topic.translations, isRedFlag: topic.isRedFlag, isActive: topic.isActive, sortOrder: topic.sortOrder, targetSpecialtyHint: topic.targetSpecialtyHint, weights }),
    });
    if (!res.ok) throw new Error(`konu bağlanamadı (${topicSlug}): ${res.status} ${await res.text()}`);
  }
}
