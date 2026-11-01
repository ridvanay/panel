/**
 * Paket Z1-ek — editoryal güven sayfaları: "Content standards" (/content-standards) ve
 * "Authors & medical reviewers" (/medical-reviewers). KAYNAK dil; diğer 8 dil aynı anahtarlara sahip olmalı.
 * EN metin, Z1'de onaylanan metindir (backend/scripts/create-blog-trust-pages.ts); yeni sağlık iddiası,
 * garanti, fiyat ya da başarı oranı içermez. Hekim adı sabitlenmez (hekimler API'den gelir).
 * Yer tutucu: {n}.
 */
export const trustPagesStrings = {
  lastUpdated: "Last updated",
  contactLink: "Contact us",
  ctaGuides: "Read our health guides",
  profileLink: "View profile",
  // ---- Content standards ----
  csMetaTitle: "Content standards",
  csMetaDescription: "How WM Health prepares, reviews and updates its patient guides.",
  csTitle: "Content standards",
  csIntro:
    "Our guides help you understand a health topic before you speak with a physician. They offer general information in plain language. They do not replace a medical consultation.",
  csPrinciplesAria: "Our editorial principles",
  csWrittenTitle: "How guides are written",
  csWrittenText:
    "Each guide is prepared by the WM Health Editorial Team. We aim for clear, calm and practical language, and we avoid alarming wording. We do not publish prices, success rates or guarantees in these guides.",
  csReviewTitle: "Medical review",
  csReviewText:
    "Before a medical guide is published, a physician from our network reviews it. The reviewing physician is shown on the article together with the date of the last review. If the content of an article changes after a review, it is sent for review again.",
  csSourcesTitle: "Sources",
  csSourcesText:
    "Medical statements are based on recognised public health and clinical sources, such as international health organisations, national health services and professional societies. Each guide lists its references with the date we last accessed them.",
  csUpdatesTitle: "Updates & corrections",
  csUpdatesText:
    "We review our guides regularly. If you notice an error or an out-of-date statement, please contact us and we will check it.",
  csNotTitle: "What our guides are not",
  csNotText:
    "Our guides are for general information. They are not a diagnosis, a treatment plan or a substitute for a medical consultation.",
  csProcessTitle: "From draft to publication",
  csProcessAria: "Editorial process",
  csStep1Title: "Writing",
  csStep1Text: "The Editorial Team prepares the text in clear, plain language.",
  csStep2Title: "Source check",
  csStep2Text: "Medical statements are checked against recognised public health and clinical sources.",
  csStep3Title: "Physician review",
  csStep3Text: "A physician from our network reviews the guide.",
  csStep4Title: "Publication",
  csStep4Text: "The guide is published with the reviewing physician and the date of the review.",
  csStep5Title: "Regular re-review",
  csStep5Text: "We review our guides regularly. Changed content is sent for review again.",
  csAlertTitle: "Important",
  csAlertText:
    "Our guides are not a substitute for a medical consultation. If you have urgent symptoms, contact your local emergency services.",
  // ---- Authors & medical reviewers ----
  mrMetaTitle: "Authors & medical reviewers",
  mrMetaDescription: "Who writes and who medically reviews the WM Health patient guides.",
  mrTitle: "Authors & medical reviewers",
  mrIntro: "Our guides are written by the WM Health Editorial Team and reviewed by physicians from our network before publication.",
  mrEditorialTitle: "WM Health Editorial Team",
  mrEditorialText:
    "Our guides are written by the WM Health Editorial Team. The team prepares the text, checks the sources and keeps the guides up to date.",
  mrCoversTitle: "What a review covers",
  mrCover1: "The information is accurate.",
  mrCover2: "The topic is clearly explained.",
  mrCover3: "The content is consistent with current professional guidance.",
  mrCoversNote: "A review does not turn a guide into personal medical advice.",
  mrReviewersTitle: "Our reviewing physicians",
  mrReviewersText:
    "Each medical guide is reviewed by a physician from our network whose specialty matches the topic. The reviewing physician is named on the article, with a link to their profile and the date of the last review.",
  mrReviewersEmpty: "Our physicians review each guide before publication.",
  mrReviewedCount: "Guides reviewed: {n}",
  mrContactText: "If you have a question about an article or about our review process, please get in touch through the contact page.",
} as const;

export type TrustPagesStrings = Record<keyof typeof trustPagesStrings, string>;
