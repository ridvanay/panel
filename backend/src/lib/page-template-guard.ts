/**
 * §10.20 — Şablon modu (`Page.editMode === "TEMPLATE"`) yapısal koruması (bkz.
 * `.claude/architect-scope-page-editor-roles.md` §3.4, BAĞLAYICI algoritma).
 *
 * Bu kural Zod'da UYGULANAMAZ: kural kayıtlı duruma GÖRELİDİR ("kayıtlı ağaca göre neyi
 * değiştirdin?"), Zod ise gövdeyi İZOLE doğrular ve DB'deki mevcut ağaca erişimi yoktur.
 * `assertTemplateEditAllowed`, şema parse'ından SONRA, `existing` kayıt yüklendikten sonra,
 * DB yazımından ÖNCE route katmanında (`pages.routes.ts`) çağrılır.
 *
 * GÜVENLİK — İTERATİF (explicit stack), ÖZYİNELEME YOK: `lib/page-blocks.ts` başlığındaki
 * stack-overflow analizinin AYNISI geçerlidir (`flattenPageBlocks`/`scanPageNodeStructure` ile
 * AYNI desen, oradaki `MAX_TOTAL_PAGE_NODES`/`ABSOLUTE_VISIT_CAP` mertebeleri referans alınır)
 * — iki ağaç EŞ ZAMANLI, doküman sırasında, explicit bir stack ile dolaşılır; hiçbir yardımcı
 * kendini çağırmaz.
 */
import { TEMPLATE_EDITABLE_FIELDS } from "./page-template-fields";
import { ForbiddenError } from "./errors";

/** Fail-closed: haritada olmayan tip için düzenlenebilir alan kümesi BOŞTUR. */
function allowedDataFieldsFor(type: string): ReadonlySet<string> {
  const fields = TEMPLATE_EDITABLE_FIELDS[type] ?? [];
  return new Set(fields.map((path) => (path.startsWith("data.") ? path.slice("data.".length) : path)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nodeId(node: unknown): string {
  if (isPlainObject(node) && typeof node.id === "string" && node.id.length > 0) return node.id;
  return "(bilinmeyen)";
}

function nodeType(node: unknown): string {
  if (isPlainObject(node) && typeof node.type === "string") return node.type;
  return "(bilinmeyen)";
}

/**
 * İTERATİF derin eşitlik (explicit stack, ÖZYİNELEME YOK) — `settings`/`reveal`/`data` alan
 * değerlerini karşılaştırmak için kullanılır. Bu değerler (bloğun İÇİNDEKİ ayarlar) `blocks`
 * ağacının KENDİSİ gibi kullanıcı-kontrollü keyfi derinlikte OLABİLECEĞİ için (ör. `data.items`
 * dizisi içinde iç içe nesneler) burada da özyineleme kullanılmaz — `page-blocks.ts` ile AYNI
 * ilke, farklı bir veri yüzeyine uygulanır.
 */
function deepEqual(a: unknown, b: unknown, visitBudget: { remaining: number }): boolean {
  const stack: [unknown, unknown][] = [[a, b]];

  while (stack.length > 0) {
    if (visitBudget.remaining-- <= 0) return false;
    const [x, y] = stack.pop()!;
    if (x === y) continue;
    if (typeof x !== typeof y) return false;
    if (x === null || y === null) return false;
    if (typeof x !== "object") return false; // primitives (x !== y zaten elendi)

    const xArr = Array.isArray(x);
    const yArr = Array.isArray(y);
    if (xArr !== yArr) return false;

    if (xArr && yArr) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);
      continue;
    }

    const xo = x as Record<string, unknown>;
    const yo = y as Record<string, unknown>;
    const xKeys = Object.keys(xo);
    const yKeys = Object.keys(yo);
    if (xKeys.length !== yKeys.length) return false;
    for (const key of xKeys) {
      if (!Object.prototype.hasOwnProperty.call(yo, key)) return false;
      stack.push([xo[key], yo[key]]);
    }
  }

  return true;
}

interface GuardFrame {
  existingItems: unknown[];
  incomingItems: unknown[];
  index: number;
}

/** İki ağaç birden dolaşılıyor (maliyet ~2x) — `lib/page-blocks.ts::ABSOLUTE_VISIT_CAP`
 *  (100_000) ile AYNI mertebede, iki katı bir tavan (bkz. tasarım notu §3.4 son madde). */
const TEMPLATE_GUARD_VISIT_CAP = 200_000;
/** Yalnızca ilk N ihlal `error.details.blocks`'a yazılır, gerisi SAYILIR (rapor ETMEZ). */
const MAX_REPORTED_VIOLATIONS = 10;

/**
 * `existingBlocks`/`incomingBlocks` — sırasıyla DB'deki kayıtlı ağaç ve istekle gelen (Zod'dan
 * ZATEN geçmiş, normalize edilmiş) ağaç. İkisi de en fazla `MAX_TOTAL_PAGE_NODES` düğüm
 * taşıdığı GARANTİLİDİR (PageBlockListSchema önceden doğrulamıştır) — bu fonksiyon o garantiye
 * GÜVENİR, kendi başına bir üst sınır DAHA uygulamaz (yalnızca patolojik/beklenmeyen bir
 * durumda takılıp kalmamak için `TEMPLATE_GUARD_VISIT_CAP` savunma-derinliği tavanı vardır).
 */
export function assertTemplateEditAllowed(existingBlocks: unknown[], incomingBlocks: unknown[]): void {
  const violations: string[] = [];
  let violationCount = 0;
  let truncated = false;

  function report(message: string): void {
    violationCount += 1;
    if (violations.length < MAX_REPORTED_VIOLATIONS) violations.push(message);
  }

  const visitBudget = { remaining: TEMPLATE_GUARD_VISIT_CAP };
  const stack: GuardFrame[] = [{ existingItems: existingBlocks, incomingItems: incomingBlocks, index: 0 }];

  while (stack.length > 0 && !truncated) {
    const frame = stack[stack.length - 1]!;
    const maxLen = Math.max(frame.existingItems.length, frame.incomingItems.length);
    if (frame.index >= maxLen) {
      stack.pop();
      continue;
    }

    if (visitBudget.remaining-- <= 0) {
      truncated = true;
      break;
    }

    const i = frame.index;
    frame.index += 1;

    const hasExisting = i < frame.existingItems.length;
    const hasIncoming = i < frame.incomingItems.length;
    const existingNode = hasExisting ? frame.existingItems[i] : undefined;
    const incomingNode = hasIncoming ? frame.incomingItems[i] : undefined;

    if (!hasExisting && hasIncoming) {
      // Yeni bir düğüm EKLENMİŞ.
      report(`${nodeId(incomingNode)}: yapı değiştirilemez`);
      continue;
    }
    if (hasExisting && !hasIncoming) {
      // Var olan bir düğüm SİLİNMİŞ.
      report(`${nodeId(existingNode)}: yapı değiştirilemez`);
      continue;
    }

    const existingId = nodeId(existingNode);
    const incomingId = nodeId(incomingNode);
    const existingType = nodeType(existingNode);
    const incomingType = nodeType(incomingNode);

    if (existingId !== incomingId || existingType !== incomingType) {
      // Sıralama değişikliği / taşıma / bir düğümün başka biriyle değiştirilmesi.
      report(`${existingId}: yapı değiştirilemez`);
      continue;
    }

    const existingObj = isPlainObject(existingNode) ? existingNode : {};
    const incomingObj = isPlainObject(incomingNode) ? incomingNode : {};
    const isContainer = existingType === "container";
    const allowedDataFields = allowedDataFieldsFor(existingType);

    const skipKeys = new Set(["id", "type", ...(isContainer ? ["children"] : [])]);
    const otherKeys = new Set([...Object.keys(existingObj), ...Object.keys(incomingObj)].filter((k) => !skipKeys.has(k)));

    for (const key of otherKeys) {
      if (key === "data") {
        const existingData = isPlainObject(existingObj.data) ? existingObj.data : {};
        const incomingData = isPlainObject(incomingObj.data) ? incomingObj.data : {};
        const dataKeys = new Set([...Object.keys(existingData), ...Object.keys(incomingData)]);

        for (const dataKey of dataKeys) {
          if (allowedDataFields.has(dataKey)) continue; // içerik alanı — serbest.

          const existsInExisting = Object.prototype.hasOwnProperty.call(existingData, dataKey);
          const existsInIncoming = Object.prototype.hasOwnProperty.call(incomingData, dataKey);
          const equal =
            existsInExisting === existsInIncoming && deepEqual(existingData[dataKey], incomingData[dataKey], visitBudget);
          if (!equal) report(`${existingId}: data.${dataKey} değiştirilemez`);
        }
        continue;
      }

      // `settings`/`reveal` (container) veya şemasız bir tipin `data` dışındaki her alanı —
      // hepsi KİLİTLİDİR (fail-closed).
      const existsInExisting = Object.prototype.hasOwnProperty.call(existingObj, key);
      const existsInIncoming = Object.prototype.hasOwnProperty.call(incomingObj, key);
      const equal =
        existsInExisting === existsInIncoming && deepEqual(existingObj[key], incomingObj[key], visitBudget);
      if (!equal) report(`${existingId}: ${key} değiştirilemez`);
    }

    if (isContainer) {
      const existingChildren = Array.isArray(existingObj.children) ? (existingObj.children as unknown[]) : [];
      const incomingChildren = Array.isArray(incomingObj.children) ? (incomingObj.children as unknown[]) : [];
      stack.push({ existingItems: existingChildren, incomingItems: incomingChildren, index: 0 });
    }
  }

  if (truncated) {
    throw new ForbiddenError("Bu sayfa şablon modunda; yalnızca içerik alanlarını düzenleyebilirsiniz.", {
      blocks: ["İçerik yapısı işlenemeyecek kadar karmaşık."],
    });
  }

  if (violationCount > 0) {
    throw new ForbiddenError("Bu sayfa şablon modunda; yalnızca içerik alanlarını düzenleyebilirsiniz.", {
      blocks: violations,
    });
  }
}
