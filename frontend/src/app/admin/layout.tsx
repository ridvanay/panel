import type { Metadata } from "next";
import type { ReactNode } from "react";
import { fetchSiteSettingsServer } from "@/lib/api/server-settings";
import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Görev (2026-09-16) — admin sekme başlığında jenerik "SaaS Platform" yerine kurumsal başlık.
 * Kabuk (`AdminShell`, sidebar/topbar/auth yönlendirmesi vb.) hooks + framer-motion kullandığı
 * için Client Component OLMAK ZORUNDA, ve Client Component `metadata`/`generateMetadata` EXPORT
 * EDEMEZ (bkz. `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md`
 * §"Why generateMetadata is Server Component only"). Bu yüzden bu dosya SERVER Component'e
 * dönüştürüldü, `AdminShell`i `children` olarak sarmalıyor — kabuk mantığında HİÇBİR değişiklik
 * yok (saf taşıma, bkz. `components/admin/admin-shell.tsx`).
 *
 * Site adı sabit (hardcoded) DEĞİL — `fetchSiteSettingsServer()` ile aynı kaynaktan (proje
 * genelinde JSON-LD/footer'ın kullandığı kaynakla AYNI) çekiliyor, site admin panelinden yeniden
 * adlandırılırsa otomatik yansır.
 *
 * DÜZELTME (2026-09-16) — "· SaaS Platform" ikilenme bug'ı: `title.default` kök layout'un
 * `title.template`'ine göre bir "sayfa başlığı" gibi davranıp kök template'e göre TEKRAR
 * sarmalanıyordu (bkz. aynı doküman §"title" > "Good to know": `title.default` "will augment
 * `title.template` from the closest parent segment if it exists"). `title.absolute` ise ata
 * segment'lerdeki `title.template`'i YOK SAYAR ("ignores `title.template` from parent segments").
 * `default` alanı yerine `absolute` kullanılarak kök template'in bu değeri tekrar sarmalaması
 * engellendi; admin'in KENDİ `template`'i alt sayfalar için olduğu gibi çalışmaya devam ediyor
 * (`title.template` sadece çocuk segment'leri etkiler, tanımlandığı segment'i etkilemez).
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await fetchSiteSettingsServer();
  const siteName = settings.siteName;
  return {
    title: {
      absolute: `Yönetim Paneli | ${siteName}`,
      template: `%s | Yönetim Paneli | ${siteName}`,
    },
  };
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
