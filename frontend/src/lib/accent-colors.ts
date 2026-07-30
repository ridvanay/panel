export type AccentColorKey = "indigo" | "violet" | "emerald" | "rose" | "amber" | "cyan";

export interface AccentPalette {
  label: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  rgb400: string;
  rgb500: string; // "R, G, B" virgüllü string
}

export const ACCENT_COLORS: Record<AccentColorKey, AccentPalette> = {
  indigo: {
    label: "Indigo",
    300: "#a5b4fc",
    400: "#818cf8",
    500: "#6366f1",
    600: "#4f46e5",
    700: "#4338ca",
    rgb400: "129, 140, 248",
    rgb500: "99, 102, 241",
  },
  violet: {
    label: "Violet",
    300: "#c4b5fd",
    400: "#a78bfa",
    500: "#8b5cf6",
    600: "#7c3aed",
    700: "#6d28d9",
    rgb400: "167, 139, 250",
    rgb500: "139, 92, 246",
  },
  emerald: {
    label: "Emerald",
    300: "#6ee7b7",
    400: "#34d399",
    500: "#10b981",
    600: "#059669",
    700: "#047857",
    rgb400: "52, 211, 153",
    rgb500: "16, 185, 129",
  },
  rose: {
    label: "Rose",
    300: "#fda4af",
    400: "#fb7185",
    500: "#f43f5e",
    600: "#e11d48",
    700: "#be123c",
    rgb400: "251, 113, 133",
    rgb500: "244, 63, 94",
  },
  amber: {
    label: "Amber",
    300: "#fcd34d",
    400: "#fbbf24",
    500: "#f59e0b",
    600: "#d97706",
    700: "#b45309",
    rgb400: "251, 191, 36",
    rgb500: "245, 158, 11",
  },
  cyan: {
    label: "Cyan",
    300: "#67e8f9",
    400: "#22d3ee",
    500: "#06b6d4",
    600: "#0891b2",
    700: "#0e7490",
    rgb400: "34, 211, 238",
    rgb500: "6, 182, 212",
  },
};

export const DEFAULT_ACCENT: AccentColorKey = "indigo";
