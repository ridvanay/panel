/**
 * Paket AM İş 2 — misafir belirteci ve imzalı `guestSession` yalnızca `sessionStorage`'da (sekmeye özgü; `localStorage`
 * KULLANILMAZ, paylaşılan cihazda iz kalmaz). Anahtar şeması:
 *   `wm.meet.guest:<pathname>`            → o yoldaki (sekmedeki) son bağlantının özet kimliği (işaretçi)
 *   `wm.meet.guest:<pathname>:<digest>`   → { token, session?, name? } kaydı
 * `/meet/join` tek yol olduğundan kayıt belirteçten türetilen kısa özet (FNV-1a) ile ayrılır; farklı toplantı bağlantıları
 * aynı sekmede birbirinin oturumunu devralmaz. Depolama kapalıysa her şey sessizce yalnızca bellekte çalışır.
 */
const PREFIX = "wm.meet.guest:";

export interface GuestStoredRecord {
  token: string;
  session?: string;
  name?: string;
}

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function currentPath(): string {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

/** Belirteçten kısa ayırt edici kimlik (güvenlik değil, yalnızca anahtar ayrımı içindir). */
export function tokenDigest(token: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const recordKey = (path: string, digest: string) => `${PREFIX}${path}:${digest}`;

/** `token` verilirse o bağlantının kaydı; verilmezse bu yoldaki son bağlantının kaydı (yenileme). */
export function loadGuestRecord(token?: string | null): GuestStoredRecord | null {
  const s = store();
  if (!s) return null;
  try {
    const path = currentPath();
    const digest = token ? tokenDigest(token) : s.getItem(PREFIX + path);
    if (!digest) return null;
    const raw = s.getItem(recordKey(path, digest));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GuestStoredRecord> | null;
    if (!parsed || typeof parsed.token !== "string") return null;
    if (token && parsed.token !== token) return null;
    return {
      token: parsed.token,
      ...(typeof parsed.session === "string" ? { session: parsed.session } : {}),
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
    };
  } catch {
    return null;
  }
}

export function saveGuestRecord(record: GuestStoredRecord): void {
  const s = store();
  if (!s) return;
  try {
    const path = currentPath();
    const digest = tokenDigest(record.token);
    s.setItem(recordKey(path, digest), JSON.stringify(record));
    s.setItem(PREFIX + path, digest);
  } catch {
    /* kota/gizli mod: bellekte devam */
  }
}

export function clearGuestRecord(token?: string | null): void {
  const s = store();
  if (!s) return;
  try {
    const path = currentPath();
    const pointer = s.getItem(PREFIX + path);
    const digest = token ? tokenDigest(token) : pointer;
    if (digest) s.removeItem(recordKey(path, digest));
    if (!token || pointer === digest) s.removeItem(PREFIX + path);
  } catch {
    /* yoksay */
  }
}
