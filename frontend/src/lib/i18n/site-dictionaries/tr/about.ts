import type { AboutStrings } from "../en/about";
import { telehealthStrings } from "./telehealth";

/**
 * Ürün sahibinin verdiği NİHAİ Türkçe metinler — birebir kullanılır. "Randevu al" CTA'sı için
 * sözlükte ZATEN var olan karşılık (`telehealth.bookAppointmentCta`) yeniden kullanılır ki sitede
 * aynı eylem iki farklı metinle görünmesin.
 */
export const aboutStrings: AboutStrings = {
  metaTitle: "Hakkımızda | WM Health",
  metaDescription:
    "WM Health, farklı ülkelerden hastaları İstanbul'da ağırlıyor. Tedavi alanlarımızı, yaklaşımımızı ve doktorlarımızı tanıyın.",

  breadcrumbCurrent: "Hakkımızda",
  heroEyebrow: "WM Health Hakkında",
  heroTitle: "Kaliteli sağlık hizmeti, sınırların ötesinde daha erişilebilir.",
  heroBody:
    "Dr. Vahit Mutlu önderliğinde kurulan WM Health, farklı ülkelerden hastaları İstanbul'da ağırlıyor. Güvenli ve bilgiye dayalı bir tedavi süreci için yüksek bakım standartlarını, açık iletişimi ve özenli koordinasyonu bir araya getiriyoruz. İlk konsültasyondan sonraki adımların planlanmasına kadar, kaliteli sağlık hizmetini sınırların ötesinde daha erişilebilir kılmayı amaçlıyoruz.",
  bookConsultationCta: telehealthStrings.bookAppointmentCta,
  meetDoctorsCta: "Doktorlarımızla tanışın",
  locationTitle: "İstanbul, Türkiye",
  locationSubtitle: "Farklı ülkelerden hastaları ağırlıyoruz",

  treatmentEyebrow: "Tedavi ettiklerimiz",
  treatmentTitle: "Tedavi alanlarımız",
  treatmentBody:
    "Her hastanın ihtiyaçları farklıdır. Tedavi kararları, hastanın sağlık geçmişi ve hedefleri göz önünde bulundurularak yapılan bireysel tıbbi değerlendirmenin ardından verilir.",
  treatmentObesity: "Obezite ve metabolik cerrahi",
  treatmentOncology: "Cerrahi onkoloji",
  treatmentIvf: "Tüp bebek (IVF) ve üreme sağlığı",
  treatmentDental: "Diş tedavileri",
  treatmentHair: "Saç ekimi",
  treatmentPlastic: "Plastik, rekonstrüktif ve estetik cerrahi",

  approachEyebrow: "Yaklaşımımız",
  approachTitle: "Neden WM Health?",
  approach1Title: "Tıbbi Değerlendirmeye Dayalı Bakım",
  approach1Body: "Tedavi seçenekleri, bireysel sağlık ihtiyaçlarınız doğrultusunda değerlendirilir.",
  approach2Title: "Her Adımda Açıklık",
  approach2Body: "Önerilen tedaviyi, zaman planını ve tıbbi ekibinizle konuşmanız gereken soruları anlayın.",
  approach3Title: "Sınırların Ötesinde Destek",
  approach3Body: "İstanbul'daki sağlık yolculuğunuzu, ziyaretinizden önce ve ziyaretiniz süresince rehberlik alarak planlayın.",

  doctorsEyebrow: "Tıbbi ekibimiz",
  doctorsTitle: "Doktorlarımızla tanışın",
  viewAllDoctorsCta: "Tüm doktorlar",
  founderBadge: "Kurucu",

  closingTitle: "Bir konsültasyonla başlayın",
  contactCta: "Bize ulaşın",
};
