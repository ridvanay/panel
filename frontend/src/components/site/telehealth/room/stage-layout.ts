import type { PipCorner, PipSize, StageLayout } from "./device-prefs";

/**
 * Paket AF (Aşama 2) — sahne yerleşimi. SAF mantık: hangi kutu "büyük ekran / küçük kutu / yan küçük / ızgara" rolünde.
 * Roller yalnızca CSS konumunu belirler; kutuların DOM'daki sırası ve `key`'leri SABİT kalır (video elemanları sökülüp takılmaz).
 */
export type TileKind = "screen" | "counterpart" | "interpreter" | "local";
export type TileRole = "main" | "pip" | "thumb" | "grid";

export interface StageTileInfo {
  key: string;
  kind: TileKind;
}

export interface AssignedRole {
  role: TileRole;
  /** `thumb` rolündekiler için 0'dan başlayan sıra (üst üste dizilirler). */
  thumbIndex: number;
}

export function assignRoles(params: {
  layout: StageLayout;
  swapped: boolean;
  tiles: readonly StageTileInfo[];
  /** Konuşmacı görünümünde (2 sn gecikmeli) büyük ekrana çıkacak uzak katılımcının türü. */
  speakerKind: "counterpart" | "interpreter";
}): Map<string, AssignedRole> {
  const { layout, swapped, tiles, speakerKind } = params;
  const result = new Map<string, AssignedRole>();

  if (layout === "grid") {
    for (const tile of tiles) result.set(tile.key, { role: "grid", thumbIndex: 0 });
    return result;
  }

  const local = tiles.find((tile) => tile.kind === "local");
  const remotes = tiles.filter((tile) => tile.kind !== "local");
  // Karşı taraf (ya da ekran paylaşımı) yoksa — yalnızca tercüman gelmişse bile — büyük ekran kendi görüntüsüdür
  // (bekleme odası); tercüman küçük kutuda kalır.
  if (!remotes.some((tile) => tile.kind === "screen" || tile.kind === "counterpart")) {
    if (local) result.set(local.key, { role: "main", thumbIndex: 0 });
    remotes.forEach((tile, index) => result.set(tile.key, { role: "thumb", thumbIndex: index }));
    return result;
  }

  // Ekran paylaşımı her zaman odak; yoksa konuşmacı; o da yoksa ilk uzak kutu.
  const focus = remotes.find((tile) => tile.kind === "screen") ?? remotes.find((tile) => tile.kind === speakerKind) ?? remotes[0]!;
  const others = remotes.filter((tile) => tile !== focus);

  if (!local) {
    result.set(focus.key, { role: "main", thumbIndex: 0 });
  } else if (swapped) {
    result.set(local.key, { role: "main", thumbIndex: 0 });
    result.set(focus.key, { role: "pip", thumbIndex: 0 });
  } else {
    result.set(focus.key, { role: "main", thumbIndex: 0 });
    result.set(local.key, { role: "pip", thumbIndex: 0 });
  }
  others.forEach((tile, index) => result.set(tile.key, { role: "thumb", thumbIndex: index }));
  return result;
}

/**
 * Köşe konumları (mantıksal start/end → RTL'de otomatik aynalanır). Üst köşeler durum rozeti/kayıt göstergesinin,
 * alt köşeler kontrol çubuğunun ALTINDA kalmaz. (Tailwind tam sınıf adlarını kaynaktan taradığı için sabit yazılır.)
 */
export const CORNER_CLASS: Record<PipCorner, string> = {
  "top-start": "top-24 start-3 lg:top-16 lg:start-5",
  "top-end": "top-24 end-3 lg:top-16 lg:end-5",
  "bottom-start": "bottom-[5.75rem] start-3 lg:bottom-28 lg:start-5",
  "bottom-end": "bottom-[5.75rem] end-3 lg:bottom-28 lg:end-5",
};

export const SIZE_CLASS: Record<PipSize, string> = {
  small: "w-[8.5rem]",
  medium: "w-[9.5rem] lg:w-[12rem]",
  large: "w-[12rem] lg:w-[18rem]",
};

export function oppositeCorner(corner: PipCorner): PipCorner {
  return (corner.endsWith("start") ? corner.replace("start", "end") : corner.replace("end", "start")) as PipCorner;
}

/** Üst üste dizilen küçük kutuların dikey kayması (px): üstteki köşede aşağı, alttaki köşede yukarı. */
export function thumbShiftPx(corner: PipCorner, index: number): number {
  const step = 110;
  return corner.startsWith("top") ? index * step : -index * step;
}

/** Izgara sütun sayısı: 1-2 kutuda en çok 2, 3+ kutuda geniş ekranda 3 sütun (herkes eşit). */
export function gridColumnsClass(count: number): string {
  if (count >= 3) return "grid-cols-1 sm:grid-cols-3";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  return "grid-cols-1";
}
