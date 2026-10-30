import type { Metadata } from "next";
import { InterpreterPanel } from "@/components/site/interpreter/interpreter-panel";

/** Paket AA — tercüman paneli (kişiye özel; arama motorlarında indekslenmez). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function InterpreterPage() {
  return <InterpreterPanel />;
}
