import type { Metadata } from "next";
import { InterpreterRoom } from "@/components/site/interpreter/interpreter-room";

/** Paket AA — tercümanın görüşme ekranı (yalnızca atanmış tercüman; erişim sunucuda doğrulanır). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function InterpreterSessionPage({ params }: { params: Promise<{ lang: string; id: string }> }) {
  const { id } = await params;
  return <InterpreterRoom assignmentId={id} />;
}
