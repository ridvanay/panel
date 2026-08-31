import type { Metadata } from "next";
import { DemoTemplatesView } from "./demo-templates-view";

// `.claude/architect-scope-demo-template-import.md` §11 — sunucu bileşeni kabuğu; tüm veri
// çekimi/etkileşim istemci tarafındadır (`demo-templates-view.tsx`, `"use client"`).
export const metadata: Metadata = {
  title: "Hazır Şablonlar",
};

export default function AdminDemoTemplatesPage() {
  return <DemoTemplatesView />;
}
