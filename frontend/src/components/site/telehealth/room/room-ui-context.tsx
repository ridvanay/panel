"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { loadPrefs, savePrefs, type PipCorner, type PipSize, type StageLayout } from "./device-prefs";
import type { Facing } from "./camera-facing";
import { cycleSize, stepSize } from "./pip-geometry";

/**
 * Paket AF (Aşama 2) — YALNIZCA GÖRSEL durum: yerleşim, kendi görüntü kutusu (köşe/boyut/gizli/yer değiştirme) ve yerel
 * kamera yönü. Sağlayıcı `<LiveKitRoom>`'un DIŞINDA durur; böylece token yenilenip oda yeniden kurulsa da görsel tercihler
 * korunur. Bu durumun hiçbiri Room'a, abonelik ya da yayın kalitesine dokunmaz (`adaptiveStream` kendi işini yapar).
 */
export interface RoomUiState {
  layout: StageLayout;
  toggleLayout: () => void;
  swapped: boolean;
  toggleSwap: () => void;
  pipSize: PipSize;
  stepPipSize: (delta: number) => void;
  cyclePipSize: () => void;
  pipCorner: PipCorner;
  setPipCorner: (corner: PipCorner) => void;
  pipHidden: boolean;
  setPipHidden: (hidden: boolean) => void;
  facing: Facing;
  setFacing: (facing: Facing) => void;
}

const NOOP_STATE: RoomUiState = {
  layout: "speaker",
  toggleLayout: () => {},
  swapped: false,
  toggleSwap: () => {},
  pipSize: "medium",
  stepPipSize: () => {},
  cyclePipSize: () => {},
  pipCorner: "bottom-end",
  setPipCorner: () => {},
  pipHidden: false,
  setPipHidden: () => {},
  facing: "user",
  setFacing: () => {},
};

const RoomUiContext = createContext<RoomUiState>(NOOP_STATE);

export function RoomUiProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(loadPrefs);
  const [layout, setLayout] = useState<StageLayout>(initial.layout);
  const [swapped, setSwapped] = useState(false);
  const [pipSize, setPipSize] = useState<PipSize>(initial.pipSize);
  const [pipCorner, setPipCornerState] = useState<PipCorner>(initial.pipCorner);
  const [pipHidden, setPipHidden] = useState(false);
  const [facing, setFacing] = useState<Facing>("user");

  const toggleLayout = useCallback(() => {
    setLayout((prev) => {
      const next: StageLayout = prev === "speaker" ? "grid" : "speaker";
      savePrefs({ layout: next });
      return next;
    });
  }, []);
  const toggleSwap = useCallback(() => setSwapped((prev) => !prev), []);
  const stepPipSize = useCallback((delta: number) => {
    setPipSize((prev) => {
      const next = stepSize(prev, delta);
      if (next !== prev) savePrefs({ pipSize: next });
      return next;
    });
  }, []);
  const cyclePipSize = useCallback(() => {
    setPipSize((prev) => {
      const next = cycleSize(prev);
      savePrefs({ pipSize: next });
      return next;
    });
  }, []);
  const setPipCorner = useCallback((corner: PipCorner) => {
    setPipCornerState(corner);
    savePrefs({ pipCorner: corner });
  }, []);

  const value = useMemo<RoomUiState>(
    () => ({ layout, toggleLayout, swapped, toggleSwap, pipSize, stepPipSize, cyclePipSize, pipCorner, setPipCorner, pipHidden, setPipHidden, facing, setFacing }),
    [layout, toggleLayout, swapped, toggleSwap, pipSize, stepPipSize, cyclePipSize, pipCorner, setPipCorner, pipHidden, facing]
  );

  return <RoomUiContext.Provider value={value}>{children}</RoomUiContext.Provider>;
}

export function useRoomUi(): RoomUiState {
  return useContext(RoomUiContext);
}
