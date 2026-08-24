import { redirect } from "next/navigation";
import { localizePathServer } from "@/lib/api/server-locales";

/**
 * §customer-portal §4.1 — `/hesabim` artık bir yönlendiricidir; eski 759 satırlık profil/2FA/
 * oturum içeriği `profil/page.tsx`'e TAŞINDI (bkz. plan §4.1).
 */
export default async function HesabimIndexPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  redirect(await localizePathServer(lang, "/hesabim/profil"));
}
