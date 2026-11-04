/**
 * Paket AK - aracı kuruluş dilinde yeni/değişen ziyaretçi metinleri (8 dil + `tr` yönetim kopyası).
 * `scripts/apply-client-revisions-ak.ts` canlı DB bloklarına bu metinleri yazar. EN/TR değerleri kod
 * kaynaklarıyla (`faq-content.ts`, `add-home-journey-faq-blocks.ts`, demo şablonu) tutarlı olmak zorundadır
 * (bkz. tests/unit/ak-copy.test.ts). Uydurma istatistik/akreditasyon/fiyat/garanti YOK.
 */
export const AK_LOCALES = ["en", "de", "ar", "fr", "ro", "sr-latn", "es", "ru", "tr"] as const;
export type AkLocale = (typeof AK_LOCALES)[number];
export type PerLocale<T> = Record<AkLocale, T>;

export function akLocaleOf(code: string | undefined): AkLocale {
  const c = (code ?? "en").toLowerCase();
  return (AK_LOCALES as readonly string[]).includes(c) ? (c as AkLocale) : "en";
}

export interface Pair {
  title: string;
  text: string;
}

/** Hero başlığı (slayt katman metni içindeyse): eski -> yeni, büyük/küçük harf korunur. */
export const HERO_OLD_PATTERN = /our health service(?!s)/i;
export const HERO_NEW_EN = "our health tourism services";

export const SERVICES_TITLE: PerLocale<string> = {
  en: "Our Health Tourism Services",
  de: "Unsere Gesundheitstourismus-Leistungen",
  ar: "خدمات السياحة العلاجية لدينا",
  fr: "Nos services de tourisme de santé",
  ro: "Serviciile noastre de turism medical",
  "sr-latn": "Naše usluge zdravstvenog turizma",
  es: "Nuestros servicios de turismo de salud",
  ru: "Наши услуги медицинского туризма",
  tr: "Sağlık Turizmi Hizmetlerimiz",
};

/** Özellik şeridi (3 madde): index 0 destek, 1 güvenli görüntülü görüşme, 2 yetkili tesisler. */
export const TRUST_BAND: PerLocale<Pair[]> = {
  en: [
    { title: "Support in your language", text: "Free support and interpreter service in 8 languages." },
    { title: "Secure video consultation", text: "Online consultations with your patient coordinator over an encrypted connection." },
    { title: "Authorized facilities", text: "Treatments are performed at healthcare facilities holding an International Health Tourism Authorization Certificate." },
  ],
  de: [
    { title: "Support in Ihrer Sprache", text: "Kostenloser Support und Dolmetscherservice in 8 Sprachen." },
    { title: "Sichere Videoberatung", text: "Online-Beratungen mit Ihrem Patientenkoordinator über eine verschlüsselte Verbindung." },
    { title: "Zugelassene Einrichtungen", text: "Behandlungen finden in Gesundheitseinrichtungen mit einem internationalen Genehmigungszertifikat für Gesundheitstourismus statt." },
  ],
  ar: [
    { title: "دعم بلغتك", text: "دعم مجاني وخدمة ترجمة فورية بـ 8 لغات." },
    { title: "استشارة فيديو آمنة", text: "استشارات عبر الإنترنت مع منسق المرضى الخاص بك عبر اتصال مشفّر." },
    { title: "منشآت مرخّصة", text: "تُجرى العلاجات في منشآت صحية حاصلة على شهادة ترخيص السياحة العلاجية الدولية." },
  ],
  fr: [
    { title: "Assistance dans votre langue", text: "Assistance gratuite et service d’interprétariat en 8 langues." },
    { title: "Consultation vidéo sécurisée", text: "Consultations en ligne avec votre coordinateur patient via une connexion chiffrée." },
    { title: "Établissements autorisés", text: "Les traitements sont réalisés dans des établissements de santé titulaires d’un Certificat d’autorisation du tourisme de santé international." },
  ],
  ro: [
    { title: "Asistență în limba dumneavoastră", text: "Asistență gratuită și serviciu de interpretariat în 8 limbi." },
    { title: "Consultație video securizată", text: "Consultații online cu coordonatorul dumneavoastră de pacienți printr-o conexiune criptată." },
    { title: "Unități autorizate", text: "Tratamentele se efectuează în unități medicale care dețin un Certificat de autorizare pentru turism medical internațional." },
  ],
  "sr-latn": [
    { title: "Podrška na vašem jeziku", text: "Besplatna podrška i usluga tumačenja na 8 jezika." },
    { title: "Bezbedna video konsultacija", text: "Onlajn konsultacije sa vašim koordinatorom za pacijente preko šifrovane veze." },
    { title: "Ovlašćene ustanove", text: "Lečenje se obavlja u zdravstvenim ustanovama koje poseduju Sertifikat o odobrenju za međunarodni zdravstveni turizam." },
  ],
  es: [
    { title: "Atención en su idioma", text: "Atención gratuita y servicio de interpretación en 8 idiomas." },
    { title: "Videoconsulta segura", text: "Consultas en línea con su coordinador de pacientes a través de una conexión cifrada." },
    { title: "Centros autorizados", text: "Los tratamientos se realizan en centros sanitarios con Certificado de Autorización de Turismo de Salud Internacional." },
  ],
  ru: [
    { title: "Поддержка на вашем языке", text: "Бесплатная поддержка и услуги переводчика на 8 языках." },
    { title: "Безопасная видеоконсультация", text: "Онлайн-консультации с вашим координатором пациентов по зашифрованному соединению." },
    { title: "Уполномоченные учреждения", text: "Лечение проходит в медицинских учреждениях, имеющих Международное разрешительное свидетельство в сфере медицинского туризма." },
  ],
  tr: [
    { title: "Kendi Dilinizde Destek", text: "8 dilde ücretsiz destek ve tercümanlık hizmeti." },
    { title: "Güvenli Görüntülü Görüşme", text: "Hasta koordinatörünüzle çevrimiçi görüşmeler şifreli bağlantı üzerinden yapılır." },
    { title: "Yetkili Sağlık Tesisleri", text: "Tedaviler, Uluslararası Sağlık Turizmi Yetki Belgesi bulunan sağlık tesislerinde gerçekleştirilir." },
  ],
};

/** "Nasıl çalışır" 3 adım (numara öneki eski başlıkta varsa script tarafından korunur). */
export const HOW_IT_WORKS: PerLocale<Pair[]> = {
  en: [
    { title: "Choose a service", text: "Select the health tourism service you are interested in." },
    { title: "Talk to your coordinator", text: "Meet your patient coordinator in a free online consultation." },
    { title: "Plan your journey", text: "We plan your treatment at an authorized facility, your travel and your stay." },
  ],
  de: [
    { title: "Wählen Sie eine Leistung", text: "Wählen Sie die Gesundheitstourismus-Leistung, für die Sie sich interessieren." },
    { title: "Sprechen Sie mit Ihrem Koordinator", text: "Lernen Sie Ihren Patientenkoordinator in einer kostenlosen Online-Beratung kennen." },
    { title: "Planen Sie Ihre Reise", text: "Wir planen Ihre Behandlung in einer zugelassenen Einrichtung sowie Ihre Reise und Ihren Aufenthalt." },
  ],
  ar: [
    { title: "اختر خدمة", text: "اختر خدمة السياحة العلاجية التي تهمك." },
    { title: "تحدث مع منسقك", text: "تعرّف على منسق المرضى الخاص بك في استشارة مجانية عبر الإنترنت." },
    { title: "خطط لرحلتك", text: "نخطط لعلاجك في منشأة مرخّصة ولسفرك وإقامتك." },
  ],
  fr: [
    { title: "Choisissez un service", text: "Sélectionnez le service de tourisme de santé qui vous intéresse." },
    { title: "Parlez à votre coordinateur", text: "Rencontrez votre coordinateur patient lors d’une consultation en ligne gratuite." },
    { title: "Planifiez votre voyage", text: "Nous organisons votre traitement dans un établissement autorisé, votre voyage et votre séjour." },
  ],
  ro: [
    { title: "Alegeți un serviciu", text: "Selectați serviciul de turism medical care vă interesează." },
    { title: "Discutați cu coordonatorul dumneavoastră", text: "Faceți cunoștință cu coordonatorul dumneavoastră de pacienți într-o consultație online gratuită." },
    { title: "Planificați-vă călătoria", text: "Planificăm tratamentul dumneavoastră într-o unitate autorizată, călătoria și șederea." },
  ],
  "sr-latn": [
    { title: "Izaberite uslugu", text: "Izaberite uslugu zdravstvenog turizma koja vas zanima." },
    { title: "Razgovarajte sa svojim koordinatorom", text: "Upoznajte svog koordinatora za pacijente na besplatnoj onlajn konsultaciji." },
    { title: "Planirajte svoje putovanje", text: "Planiramo vaše lečenje u ovlašćenoj ustanovi, vaše putovanje i boravak." },
  ],
  es: [
    { title: "Elija un servicio", text: "Seleccione el servicio de turismo de salud que le interesa." },
    { title: "Hable con su coordinador", text: "Conozca a su coordinador de pacientes en una consulta en línea gratuita." },
    { title: "Planifique su viaje", text: "Planificamos su tratamiento en un centro autorizado, su viaje y su estancia." },
  ],
  ru: [
    { title: "Выберите услугу", text: "Выберите услугу медицинского туризма, которая вас интересует." },
    { title: "Поговорите со своим координатором", text: "Познакомьтесь со своим координатором пациентов на бесплатной онлайн-консультации." },
    { title: "Спланируйте поездку", text: "Мы планируем ваше лечение в уполномоченном учреждении, поездку и проживание." },
  ],
  tr: [
    { title: "Hizmet Seçin", text: "İlgilendiğiniz sağlık turizmi hizmetini seçin." },
    { title: "Koordinatörünüzle Görüşün", text: "Ücretsiz çevrimiçi görüşmede hasta koordinatörünüzle tanışın." },
    { title: "Yolculuğunuzu Planlayın", text: "Tedavinizi yetkili bir tesiste, seyahatinizi ve konaklamanızı sizinle birlikte planlarız." },
  ],
};

/** SSS: faq-3 (soru+cevap) ve faq-8 (cevap). */
export const FAQ3: PerLocale<{ question: string; answer: string }> = {
  en: {
    question: "Where will my treatment take place?",
    answer:
      "WM Health is an international health tourism intermediary and does not provide healthcare itself. Your treatment takes place at a healthcare facility holding an International Health Tourism Authorization Certificate, where treatment decisions are made following an individual medical evaluation. Before confirming your visit, you can ask your patient coordinator about the facility where your care will take place.",
  },
  de: {
    question: "Wo findet meine Behandlung statt?",
    answer:
      "WM Health ist ein internationaler Vermittler für Gesundheitstourismus und erbringt selbst keine medizinischen Leistungen. Ihre Behandlung findet in einer Gesundheitseinrichtung mit internationalem Genehmigungszertifikat für Gesundheitstourismus statt; Behandlungsentscheidungen werden nach einer individuellen medizinischen Untersuchung getroffen. Bevor Sie Ihren Besuch bestätigen, können Sie Ihren Patientenkoordinator nach der Einrichtung fragen, in der Ihre Behandlung stattfinden wird.",
  },
  ar: {
    question: "أين سيتم علاجي؟",
    answer:
      "WM Health وسيط دولي في السياحة العلاجية ولا تقدم الرعاية الصحية بنفسها. يتم علاجك في منشأة صحية حاصلة على شهادة ترخيص السياحة العلاجية الدولية، حيث تُتخذ قرارات العلاج بعد تقييم طبي فردي. قبل تأكيد زيارتك، يمكنك الاستفسار من منسق المرضى الخاص بك عن المنشأة التي ستتلقى فيها رعايتك.",
  },
  fr: {
    question: "Où mon traitement aura-t-il lieu ?",
    answer:
      "WM Health est un intermédiaire international en tourisme de santé et ne dispense pas lui-même de soins. Votre traitement a lieu dans un établissement de santé titulaire d’un Certificat d’autorisation du tourisme de santé international, où les décisions thérapeutiques sont prises à l’issue d’une évaluation médicale individuelle. Avant de confirmer votre venue, vous pouvez interroger votre coordinateur patient sur l’établissement où vos soins seront dispensés.",
  },
  ro: {
    question: "Unde va avea loc tratamentul meu?",
    answer:
      "WM Health este un intermediar internațional în turismul medical și nu furnizează el însuși servicii medicale. Tratamentul dumneavoastră are loc într-o unitate medicală care deține un Certificat de autorizare pentru turism medical internațional, iar deciziile privind tratamentul se iau după o evaluare medicală individuală. Înainte de a confirma vizita, puteți solicita coordonatorului dumneavoastră de pacienți informații despre unitatea în care vor fi acordate îngrijirile.",
  },
  "sr-latn": {
    question: "Gde će se obaviti moje lečenje?",
    answer:
      "WM Health je međunarodni posrednik u zdravstvenom turizmu i sam ne pruža zdravstvene usluge. Vaše lečenje se obavlja u zdravstvenoj ustanovi koja poseduje Sertifikat o odobrenju za međunarodni zdravstveni turizam, a odluke o lečenju donose se nakon individualne medicinske procene. Pre nego što potvrdite posetu, možete da pitate svog koordinatora za pacijente o ustanovi u kojoj će se obaviti vaša nega.",
  },
  es: {
    question: "¿Dónde se realizará mi tratamiento?",
    answer:
      "WM Health es un intermediario internacional de turismo de salud y no presta atención sanitaria por sí mismo. Su tratamiento se realiza en un centro sanitario con Certificado de Autorización de Turismo de Salud Internacional, donde las decisiones de tratamiento se toman tras una evaluación médica individual. Antes de confirmar su visita, puede preguntar a su coordinador de pacientes por el centro en el que recibirá su atención.",
  },
  ru: {
    question: "Где будет проходить моё лечение?",
    answer:
      "WM Health — международный посредник в сфере медицинского туризма и сам не оказывает медицинских услуг. Ваше лечение проходит в медицинском учреждении, имеющем Международное разрешительное свидетельство в сфере медицинского туризма; решения о лечении принимаются после индивидуальной медицинской оценки. Перед подтверждением визита вы можете узнать у своего координатора пациентов, в каком учреждении будет проходить ваше лечение.",
  },
  tr: {
    question: "Tedavim nerede gerçekleştirilecek?",
    answer:
      "WM Health uluslararası bir sağlık turizmi aracı kuruluşudur; sağlık hizmetini kendisi sunmaz. Tedaviniz, Uluslararası Sağlık Turizmi Yetki Belgesi bulunan bir sağlık tesisinde, bireysel tıbbi değerlendirmenin ardından verilen kararlarla gerçekleştirilir. Ziyaretinizi kesinleştirmeden önce hasta koordinatörünüzden bakımınızın yapılacağı tesis hakkında bilgi isteyebilirsiniz.",
  },
};

export const FAQ8_ANSWER: PerLocale<string> = {
  en: "Follow-up requirements vary by treatment. Before leaving Istanbul, clarify your recovery instructions, review schedule, and contact arrangements with your patient coordinator, including whether follow-up with a healthcare professional in your home country is needed.",
  de: "Die Nachsorge richtet sich nach der Behandlung. Klären Sie vor der Abreise aus Istanbul mit Ihrem Patientenkoordinator Ihre Anweisungen zur Genesung, den Kontrolltermin-Plan und die Kontaktmöglichkeiten – auch ob eine Nachsorge bei einer Fachkraft im Gesundheitswesen in Ihrem Heimatland nötig ist.",
  ar: "تختلف متطلبات المتابعة باختلاف العلاج. قبل مغادرة إسطنبول، وضّح مع منسق المرضى الخاص بك تعليمات التعافي وجدول المراجعات وترتيبات التواصل، بما في ذلك ما إذا كانت هناك حاجة إلى متابعة لدى أحد المختصين في الرعاية الصحية في بلدك.",
  fr: "Le suivi varie selon le traitement. Avant de quitter Istanbul, précisez avec votre coordinateur patient les consignes de convalescence, le calendrier des contrôles et les modalités de contact, y compris la nécessité d’un suivi auprès d’un professionnel de santé dans votre pays.",
  ro: "Cerințele de monitorizare diferă în funcție de tratament. Înainte de a pleca din Istanbul, clarificați cu coordonatorul dumneavoastră de pacienți instrucțiunile de recuperare, calendarul controalelor și modalitățile de contact, inclusiv dacă este necesară monitorizarea de către un profesionist din domeniul sănătății din țara dumneavoastră.",
  "sr-latn": "Zahtevi za praćenje posle lečenja razlikuju se od slučaja do slučaja. Pre odlaska iz Istanbula razjasnite sa svojim koordinatorom za pacijente uputstva za oporavak, raspored kontrola i način kontakta, uključujući i to da li je potrebno praćenje kod zdravstvenog radnika u vašoj zemlji.",
  es: "Los requisitos de seguimiento varían según el tratamiento. Antes de salir de Estambul, aclare con su coordinador de pacientes las instrucciones de recuperación, el calendario de revisiones y los medios de contacto, incluido si necesita seguimiento con un profesional sanitario en su país de origen.",
  ru: "Требования к последующему наблюдению зависят от вида лечения. Перед отъездом из Стамбула уточните у своего координатора пациентов рекомендации по восстановлению, график контрольных осмотров и способы связи, в том числе нужно ли наблюдение у медицинского специалиста в вашей стране.",
  tr: "Takip gereksinimleri tedaviye göre değişir. İstanbul'dan ayrılmadan önce hasta koordinatörünüzle iyileşme talimatlarınızı, kontrol takviminizi ve iletişim düzenlemelerinizi netleştirin; bu, kendi ülkenizde bir sağlık profesyoneliyle takip gerekip gerekmediğini de kapsar.",
};

/** Yolculuk (journey-map) adım 3 metni. */
export const JOURNEY3_TEXT: PerLocale<string> = {
  en: "At an authorized healthcare facility, the necessary examinations are completed and your treatment plan is determined following an individual medical evaluation.",
  de: "In einer zugelassenen Gesundheitseinrichtung werden die notwendigen Untersuchungen durchgeführt, und Ihr Behandlungsplan wird nach einer individuellen medizinischen Untersuchung festgelegt.",
  ar: "في منشأة صحية مرخّصة تُجرى الفحوصات اللازمة، وتُحدَّد خطة علاجك بعد تقييم طبي فردي.",
  fr: "Dans un établissement de santé autorisé, les examens nécessaires sont réalisés et votre plan de traitement est établi à l’issue d’une évaluation médicale individuelle.",
  ro: "Într-o unitate medicală autorizată se efectuează examinările necesare, iar planul dumneavoastră de tratament se stabilește după o evaluare medicală individuală.",
  "sr-latn": "U ovlašćenoj zdravstvenoj ustanovi obavljaju se potrebni pregledi, a vaš plan lečenja utvrđuje se nakon individualne medicinske procene.",
  es: "En un centro sanitario autorizado se realizan las exploraciones necesarias y su plan de tratamiento se determina tras una evaluación médica individual.",
  ru: "В уполномоченном медицинском учреждении проводятся необходимые обследования, а план лечения определяется после индивидуальной медицинской оценки.",
  tr: "Yetkili bir sağlık tesisinde gerekli muayeneler tamamlanır ve tedavi planınız bireysel tıbbi değerlendirmenin ardından belirlenir.",
};

/** Hakkımızda `treatments` bölümü (CMS override varsa). */
export const ABOUT_TREATMENTS: PerLocale<{ eyebrow: string; title: string; body: string }> = {
  en: {
    eyebrow: "What we coordinate",
    title: "Treatment services we facilitate",
    body: "Each patient's needs are different. We connect you with healthcare facilities holding an International Health Tourism Authorization Certificate, where treatment decisions are made following an individual medical evaluation.",
  },
  de: {
    eyebrow: "Was wir koordinieren",
    title: "Behandlungsleistungen, die wir vermitteln",
    body: "Jeder Patient hat andere Bedürfnisse. Wir vermitteln Sie an Gesundheitseinrichtungen mit einem internationalen Genehmigungszertifikat für Gesundheitstourismus, in denen Behandlungsentscheidungen nach einer individuellen medizinischen Untersuchung getroffen werden.",
  },
  ar: {
    eyebrow: "ما ننسّقه",
    title: "خدمات العلاج التي نيسّرها",
    body: "تختلف احتياجات كل مريض. نربطك بمنشآت صحية حاصلة على شهادة ترخيص السياحة العلاجية الدولية، حيث تُتخذ قرارات العلاج بعد تقييم طبي فردي.",
  },
  fr: {
    eyebrow: "Ce que nous coordonnons",
    title: "Services de traitement que nous facilitons",
    body: "Les besoins de chaque patient sont différents. Nous vous mettons en relation avec des établissements de santé titulaires d’un Certificat d’autorisation du tourisme de santé international, où les décisions thérapeutiques sont prises à l’issue d’une évaluation médicale individuelle.",
  },
  ro: {
    eyebrow: "Ce coordonăm",
    title: "Servicii de tratament pe care le facilităm",
    body: "Nevoile fiecărui pacient sunt diferite. Vă punem în legătură cu unități medicale care dețin un Certificat de autorizare pentru turism medical internațional, unde deciziile privind tratamentul se iau după o evaluare medicală individuală.",
  },
  "sr-latn": {
    eyebrow: "Šta koordiniramo",
    title: "Usluge lečenja koje omogućavamo",
    body: "Potrebe svakog pacijenta su različite. Povezujemo vas sa zdravstvenim ustanovama koje poseduju Sertifikat o odobrenju za međunarodni zdravstveni turizam, u kojima se odluke o lečenju donose nakon individualne medicinske procene.",
  },
  es: {
    eyebrow: "Lo que coordinamos",
    title: "Servicios de tratamiento que facilitamos",
    body: "Las necesidades de cada paciente son distintas. Le ponemos en contacto con centros sanitarios que cuentan con un Certificado de Autorización de Turismo de Salud Internacional, donde las decisiones de tratamiento se toman tras una evaluación médica individual.",
  },
  ru: {
    eyebrow: "Что мы координируем",
    title: "Лечебные услуги, к которым мы обеспечиваем доступ",
    body: "Потребности каждого пациента различны. Мы связываем вас с медицинскими учреждениями, имеющими Международное разрешительное свидетельство в сфере медицинского туризма, где решения о лечении принимаются после индивидуальной медицинской оценки.",
  },
  tr: {
    eyebrow: "Neleri koordine ediyoruz",
    title: "Aracılık ettiğimiz tedavi hizmetleri",
    body: "Her hastanın ihtiyacı farklıdır. Sizi, Uluslararası Sağlık Turizmi Yetki Belgesi bulunan sağlık tesisleriyle buluşturuyoruz; tedavi kararları bireysel tıbbi değerlendirmenin ardından bu tesislerde verilir.",
  },
};

/** İletişim adresi (vergi levhası) - özel isim, çevrilmez. */
export const DEFAULT_ADDRESS = "Atatürk Mah. Ertuğrul Gazi Sk. Metropol İstanbul C1 Blok No: 2B İç Kapı No: 168, Ataşehir / İstanbul, Türkiye";
