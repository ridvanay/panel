/**
 * SSS (FAQ) soru-cevap içeriği — `backend/scripts/create-faq-page.ts` (ayrı `/faq` sayfası) VE
 * `backend/scripts/add-home-journey-faq-blocks.ts` (ana sayfaya `spotlight` akordiyon bloğu)
 * BU TEK modülü paylaşır (2026-10-03, journey-faq-blok turu — "SSS metinlerini paylaşımlı bir
 * modülden al, tekrar yazma" talimatı). İçerik `docs/prompts/2026-10-02-wm-health-icerik-
 * guncellemesi.md` §"2) SSS"'teki EN metinlerle BİREBİR aynıdır (değiştirilmedi); TR çevirisi
 * doğal/profesyonel bir tıbbi turizm Türkçesiyle, kelime kelime DEĞİL.
 */

export interface FaqQA {
  id: string;
  question: string;
  answer: string;
}

export interface FaqLocaleCopy {
  heading: string;
  subtitle: string;
  items: FaqQA[];
}

export const FAQ_EN_COPY: FaqLocaleCopy = {
  heading: "Frequently Asked Questions",
  subtitle: "Clear information to help you plan your treatment journey with WM Health.",
  items: [
    {
      id: "faq-1",
      question: "How do I start my treatment journey?",
      answer:
        "Contact WM Health with information about the treatment you are considering and your medical history. Our team will explain the next steps and which medical records are needed for an initial review.",
    },
    {
      id: "faq-2",
      question: "Can my medical records be reviewed before I travel?",
      answer:
        "Relevant medical reports and test results can support a preliminary assessment before your visit. Your final treatment plan is determined following an in-person consultation and any necessary examinations.",
    },
    {
      id: "faq-3",
      question: "Who will carry out my treatment?",
      answer:
        "Your care is planned with the physician responsible for your treatment. Before confirming your visit, you can request information about the treating specialist and the hospital or clinic where your care will take place.",
    },
    {
      id: "faq-4",
      question: "How long will I need to stay in Istanbul?",
      answer:
        "The recommended length of stay depends on your procedure, medical condition, and recovery needs. Your proposed schedule should allow time for consultations, treatment, and follow-up assessments.",
    },
    {
      id: "faq-5",
      question: "When should I book my flights?",
      answer:
        "Please confirm your proposed treatment dates and recommended stay with our team before booking. Allowing flexibility in your return arrangements may be helpful if your recovery requires additional time.",
    },
    {
      id: "faq-6",
      question: "Are accommodation and airport transfers included?",
      answer:
        "The services included depend on your individual arrangements. Please confirm accommodation, airport transfers, and transport to medical appointments before finalizing your booking.",
    },
    {
      id: "faq-7",
      question: "Is language assistance available?",
      answer:
        "Please let our team know your preferred language before your visit. Available language support and any interpretation arrangements should be confirmed in advance.",
    },
    {
      id: "faq-8",
      question: "How is follow-up arranged after I return home?",
      answer:
        "Follow-up requirements vary by treatment. Before leaving Istanbul, clarify your recovery instructions, review schedule, and contact arrangements, including whether follow-up with a physician in your home country is needed.",
    },
  ],
};

export const FAQ_TR_COPY: FaqLocaleCopy = {
  heading: "Sıkça Sorulan Sorular",
  subtitle: "WM Health ile tedavi yolculuğunuzu planlamanıza yardımcı olacak net bilgiler.",
  items: [
    {
      id: "faq-1",
      question: "Tedavi sürecime nasıl başlarım?",
      answer:
        "Düşündüğünüz tedavi ve tıbbi geçmişinizle ilgili bilgileri WM Health ile paylaşın. Ekibimiz sonraki adımları ve ön değerlendirme için hangi tıbbi kayıtlara ihtiyaç duyulduğunu sizinle paylaşacaktır.",
    },
    {
      id: "faq-2",
      question: "Seyahat etmeden önce tıbbi kayıtlarım incelenebilir mi?",
      answer:
        "İlgili tıbbi raporlarınız ve tahlil sonuçlarınız, ziyaretinizden önce ön değerlendirme yapılmasına destek olabilir. Nihai tedavi planınız, yüz yüze konsültasyon ve gerekli görülen tetkikler sonrasında belirlenir.",
    },
    {
      id: "faq-3",
      question: "Tedavimi kim gerçekleştirecek?",
      answer:
        "Bakımınız, tedavinizden sorumlu hekimle birlikte planlanır. Ziyaretinizi kesinleştirmeden önce, sizi tedavi edecek uzman ve bakımınızın gerçekleştirileceği hastane veya klinik hakkında bilgi talep edebilirsiniz.",
    },
    {
      id: "faq-4",
      question: "İstanbul'da ne kadar süre kalmam gerekir?",
      answer:
        "Önerilen konaklama süresi; uygulanacak işleme, tıbbi durumunuza ve iyileşme sürecinize bağlıdır. Önerilen programınız, konsültasyonlar, tedavi ve kontrol değerlendirmeleri için yeterli zamanı içermelidir.",
    },
    {
      id: "faq-5",
      question: "Uçak biletlerimi ne zaman almalıyım?",
      answer:
        "Lütfen uçuşlarınızı ayırtmadan önce önerilen tedavi tarihlerinizi ve kalış sürenizi ekibimizle teyit edin. Dönüş planlarınızda esneklik bırakmanız, iyileşme sürecinizin uzaması ihtimaline karşı faydalı olabilir.",
    },
    {
      id: "faq-6",
      question: "Konaklama ve havalimanı transferleri dahil mi?",
      answer:
        "Sunulan hizmetler kişisel düzenlemelerinize bağlı olarak değişir. Rezervasyonunuzu kesinleştirmeden önce konaklama, havalimanı transferleri ve tıbbi randevularınıza ulaşım konularını lütfen teyit edin.",
    },
    {
      id: "faq-7",
      question: "Dil desteği mevcut mu?",
      answer:
        "Ziyaretinizden önce lütfen tercih ettiğiniz dili ekibimize bildirin. Mevcut dil desteği ve gerekebilecek tercümanlık düzenlemeleri önceden teyit edilmelidir.",
    },
    {
      id: "faq-8",
      question: "Yurda döndükten sonra takip süreci nasıl planlanır?",
      answer:
        "Takip gereksinimleri tedaviye göre değişiklik gösterir. İstanbul'dan ayrılmadan önce iyileşme talimatlarınızı, kontrol takviminizi ve iletişim düzenlemelerinizi netleştirin; bu, kendi ülkenizde bir hekimle takip gerekip gerekmediğini de kapsar.",
    },
  ],
};

export function faqCopyFor(code: string): FaqLocaleCopy {
  return code === "tr" ? FAQ_TR_COPY : FAQ_EN_COPY;
}
