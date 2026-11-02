/**
 * Paket AH — kurumsal kimlik ibaresi: WM Health bir sağlık kuruluşu değil, uluslararası sağlık turizmi
 * aracı kuruluşudur. KAYNAK dil (EN metin kullanıcı tarafından verildi); diğer diller aynı anahtarlara sahip.
 * Kullanım: üst şerit, footer, Hakkımızda, hizmet/bölüm/talep/VIP/paket sayfaları, blog yazısı altı.
 * Yer tutucu: {no} (admin ayarındaki yetki belgesi numarası; boşsa belge satırı gösterilmez).
 */
export const intermediaryStrings = {
  shortLabel: "International Health Tourism Intermediary",
  description:
    "WM Health is an international health tourism intermediary organization, not a healthcare provider. All medical treatments are performed by healthcare facilities holding an International Health Tourism Authorization Certificate issued by the Republic of Türkiye Ministry of Health.",
  certificateLine: "Health Tourism Authorization Certificate No: {no}",
  facilitiesLink: "Treatments by authorized healthcare facilities",
  noticeAria: "About WM Health",
};

export type IntermediaryStrings = { [K in keyof typeof intermediaryStrings]: string };
