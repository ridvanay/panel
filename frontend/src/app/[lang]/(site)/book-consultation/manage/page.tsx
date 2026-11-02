import type { Metadata } from "next";
import { fetchLocalesServer } from "@/lib/api/server-locales";
import { getSiteDictionary } from "@/lib/i18n/site-dictionaries";
import { withLocalePrefix } from "@/lib/i18n/site-path";
import { bookingPath } from "@/lib/service-booking-links";
import { ServiceConsultationManage } from "@/components/site/service-booking/service-consultation-manage";

/**
 * AI İş 3 — `/{lang}/book-consultation/manage#sc_…`: hastanın e-postadaki bağlantıyla görüşmesini iptal etmesi / saatini
 * değiştirmesi. Belirteç URL `#` parçasındadır (sunucuya gitmez); sayfa istemcide okur ve adres çubuğundan siler.
 * Kişisel/yönetim sayfası olduğundan `noindex`.
 */
type PageProps = { params: Promise<{ lang: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lang } = await params;
  const dict = await getSiteDictionary(lang);
  return {
    title: dict.serviceBooking.manageTitle,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function ManageConsultationPage({ params }: PageProps) {
  const { lang } = await params;
  const [locales, dict] = await Promise.all([fetchLocalesServer(), getSiteDictionary(lang)]);
  const defaultLocaleCode = locales.find((l) => l.isDefault)?.code ?? lang;
  const localize = (path: string) => withLocalePrefix(path, lang, defaultLocaleCode);
  return <ServiceConsultationManage lang={lang} strings={dict.serviceBooking} bookHref={localize(bookingPath())} homeHref={localize("/")} />;
}
