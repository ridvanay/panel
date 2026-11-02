/**
 * Paket AH — WM Health bir sağlık kuruluşu değil, uluslararası sağlık turizmi aracı kuruluşudur.
 * Ziyaretçi tarafında hiçbir hekim adı/fotoğrafı/unvanı/sayısı gösterilmez. Kayıtlar silinmez;
 * yalnızca ziyaretçi görünümünden çıkarılır (admin ve hekim portalı etkilenmez). Bayrak kodu silmeden
 * yüzeyleri toplu açıp kapatmak içindir.
 */
export const DOCTORS_VISIBLE_TO_VISITORS: boolean = false;

/**
 * Paket AJ-2 — hekimler ziyaretçiye kapalıyken yorum kayıtlarından hekim adı/yanıtı/filtre listesi çıkarılır, böylece
 * RSC/hydration yüküne de girmez (kayıt silinmez; yalnızca ziyaretçi görünümünden çıkar). Bayrak açıksa veri aynen döner.
 */
export function withoutDoctorFromReviews<T extends { items: { doctor?: unknown; doctorReply?: string | null }[]; doctors?: unknown[] }>(data: T): T {
  if (DOCTORS_VISIBLE_TO_VISITORS) return data;
  return {
    ...data,
    items: data.items.map((item) => ({ ...item, doctorReply: null, ...("doctor" in item ? { doctor: null } : {}) })),
    ...(data.doctors ? { doctors: [] } : {}),
  };
}

/** Talep formunun yolu (dil önekiz); `service`/`package` sorgu parametreleri isteğe bağlı. */
export function requestFormPath(params?: { service?: string | null; pkg?: string | null }): string {
  const qs = new URLSearchParams();
  if (params?.service) qs.set("service", params.service);
  if (params?.pkg) qs.set("package", params.pkg);
  const query = qs.toString();
  return query ? `/request?${query}` : "/request";
}

/** Blog yazarı etiketi (kişi adı yerine editör ekibi). */
export const EDITORIAL_TEAM_NAME = "WM Health Editorial Team";

/** Ziyaretçiye gösterilmesine izin verilen kalıp: "physicians at authorized healthcare facilities" (tıbbi karar sorumluluğu beyanı). */
const ALLOWED_DOCTOR_PHRASE = /(?:physicians?|doctors?)\s+(?:at|in|from)\s+(?:the\s+|an?\s+)?(?:authorized\s+|partner\s+)?healthcare\s+facilit(?:y|ies)/gi;

/**
 * Paket AJ-6 — metin hekimle görüşme/hekim ekibi ima ediyor mu? (8 dil; "physicians at authorized healthcare
 * facilities" izinli). CMS'ten gelen eski metinleri ziyaretçi görünümünden süzmek için kullanılır.
 */
const DOCTOR_WORDS = [
  "doctors?",
  "physicians?",
  "surgeons?",
  String.raw`medical\s+team`,
  String.raw`(?:Dr|Prof)\.?`,
  String.raw`[aä]rzt\p{L}*`,
  String.raw`ärztin\p{L}*`,
  "m[eé]decins?",
  String.raw`(?:el|un|del|su|al|con|los|nuestros|sus|estos|otros)\s+m[eé]dicos?`,
  String.raw`врач\p{L}*`,
  String.raw`доктор\p{L}*`,
  String.raw`lekar\p{L}*`,
  "medic(?:i|ii|ul)?",
  String.raw`(?:ال)?طبيب\p{L}*`,
  "(?:ال)?أطباء",
  String.raw`(?:ال)?دكتور\p{L}*`,
  String.raw`hekim\p{L}*`,
  String.raw`doktor\p{L}*`,
].join("|");
export const DOCTOR_PATTERN = new RegExp(String.raw`(?<![\p{L}])(?:${DOCTOR_WORDS})(?![\p{L}])`, "iu");

export function impliesDoctor(text: string): boolean {
  return DOCTOR_PATTERN.test(text.replace(ALLOWED_DOCTOR_PHRASE, ""));
}

const NON_TEXT_KEYS = new Set(["id", "icon", "href", "imageUrl", "url", "type"]);

/**
 * Paket AJ-6 — CMS blok verisinde (ana sayfa) hekim ima eden metinleri ayıklar: işaretli metin alanı silinir (sözlük varsayılanı
 * devreye girer), işaretli madde içeren liste tümden atılır (varsayılan liste), etiketi silinen CTA'nın bağlantısı da gider.
 * Kayıt değişmez; yalnızca ziyaretçi görünümü. Bayrak açıksa veri aynen döner.
 */
export function sanitizeDoctorTexts(raw: unknown, doctorsVisible: boolean = DOCTORS_VISIBLE_TO_VISITORS): unknown {
  if (doctorsVisible) return raw;
  const scrub = (node: unknown, key: string): unknown => {
    if (typeof node === "string") return !NON_TEXT_KEYS.has(key) && impliesDoctor(node) ? undefined : node;
    if (Array.isArray(node)) {
      const items = node.map((item) => scrub(item, key));
      return items.some((item, i) => JSON.stringify(item) !== JSON.stringify(node[i])) ? undefined : items;
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        const next = scrub(v, k);
        if (next !== undefined) out[k] = next;
      }
      if (!("label" in out) && "href" in out && "label" in (node as object)) delete out.href;
      return out;
    }
    return node;
  };
  const data = (scrub(raw, "") ?? {}) as Record<string, unknown>;
  // Hekim bölümü ziyaretçiye hiç çizilmez.
  if (data && typeof data === "object" && "doctors" in data) data.doctors = { ...(data.doctors as object), enabled: false };
  return data;
}
