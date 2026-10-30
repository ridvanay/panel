/**
 * Paket W — "Find my physician" katalog yapısı. KAYNAK: `docs/prompts/2026-10-30-W-eslesme-tablosu.md`
 * (kullanıcı kararlarıyla güncel; canlıya yüklenmeden önce hekim kontrolüne sunulur). Ağırlıklar
 * uzmanlık SLUG'ıyla yazılır; seed sırasında veritabanında olmayan slug atlanır ve raporlanır.
 * Hekimi olmayan uzmanlık bu dosyada KALIR — öneri anında kodda düşülür (bkz. matcher.service).
 *
 * Metinler (9 dil: etiket, açıklama, halk ağzı dahil eş anlamlılar) `./i18n/<dil>.json` dosyalarında.
 */
export const BODY_AREAS = [
  "head",
  "neck-spine",
  "chest",
  "abdomen",
  "pelvis-urology",
  "women",
  "skin-aesthetic",
  "dental",
  "joints-bones",
  "general-checkup",
  "cancer",
  "mental-wellbeing",
  "other",
] as const;
export type BodyArea = (typeof BODY_AREAS)[number];

export interface CatalogTopic {
  slug: string;
  bodyArea: BodyArea;
  /** Uzmanlık slug'ı → ağırlık (1–100). Boş = koordinatör yolu (KOORD). */
  weights: Record<string, number>;
  isRedFlag?: boolean;
}

const GAS = "gastroenterology";
const OBE = "obesity-and-metabolic-surgery";
const ONC = "surgical-oncology";
const IVF = "ivf-and-reproductive-health";
const PLA = "plastic-and-aesthetic-surgery";
const ORT = "orthodontist";
const IR = "interventional-radiology-specialist";
const DEN = "dentalcare";
const HAIR = "hair-transplantation";
const THO = "thoracic-surgery";
const NEU = "neurosurgery";

const t = (slug: string, bodyArea: BodyArea, weights: Record<string, number> = {}): CatalogTopic => ({ slug, bodyArea, weights });
const rf = (slug: string, bodyArea: BodyArea): CatalogTopic => ({ slug, bodyArea, weights: {}, isRedFlag: true });

export const CARE_TOPIC_CATALOG: CatalogTopic[] = [
  // 1. Baş
  t("headache-migraine", "head"),
  t("brain-tumor-suspicion", "head", { [NEU]: 100, [ONC]: 30 }),
  t("pituitary-tumor", "head", { [NEU]: 100 }),
  t("hydrocephalus", "head", { [NEU]: 100 }),
  t("trigeminal-neuralgia", "head", { [NEU]: 80 }),
  t("head-injury-followup", "head", { [NEU]: 80 }),
  t("hair-loss", "head", { [HAIR]: 100, [PLA]: 20 }),
  t("beard-eyebrow-transplant", "head", { [HAIR]: 100 }),
  // 2. Boyun ve omurga
  t("neck-pain", "neck-spine", { [NEU]: 70 }),
  t("cervical-disc-herniation", "neck-spine", { [NEU]: 100 }),
  t("lumbar-disc-herniation", "neck-spine", { [NEU]: 100 }),
  t("low-back-pain", "neck-spine", { [NEU]: 70 }),
  t("sciatica", "neck-spine", { [NEU]: 90 }),
  t("spinal-stenosis", "neck-spine", { [NEU]: 100 }),
  t("spine-slippage-scoliosis", "neck-spine", { [NEU]: 70 }),
  t("hand-numbness-carpal-tunnel", "neck-spine", { [NEU]: 70, [PLA]: 30 }),
  t("thyroid-nodule", "neck-spine", { [ONC]: 50, [IR]: 50 }),
  // 3. Göğüs
  t("lung-nodule", "chest", { [THO]: 100, [ONC]: 40 }),
  t("lung-cancer", "chest", { [THO]: 100, [ONC]: 60 }),
  t("chest-wall-deformity", "chest", { [THO]: 100, [PLA]: 30 }),
  t("pleural-effusion", "chest", { [THO]: 90 }),
  t("pneumothorax", "chest", { [THO]: 100 }),
  t("hyperhidrosis", "chest", { [THO]: 90 }),
  t("mediastinal-mass", "chest", { [THO]: 100, [ONC]: 40 }),
  t("chronic-cough", "chest", { [THO]: 40, [GAS]: 40 }),
  t("swallowing-difficulty", "chest", { [GAS]: 100 }),
  t("achalasia", "chest", { [GAS]: 100 }),
  t("esophageal-cancer", "chest", { [ONC]: 80, [GAS]: 60, [THO]: 50 }),
  // 4. Karın ve sindirim
  t("reflux-heartburn", "abdomen", { [GAS]: 100, [OBE]: 40 }),
  t("hiatal-hernia", "abdomen", { [GAS]: 80, [OBE]: 70 }),
  t("indigestion-stomach-pain", "abdomen", { [GAS]: 100 }),
  t("gastritis-ulcer", "abdomen", { [GAS]: 100 }),
  t("bloating-ibs", "abdomen", { [GAS]: 100 }),
  t("constipation", "abdomen", { [GAS]: 100 }),
  t("chronic-diarrhea", "abdomen", { [GAS]: 100 }),
  t("blood-in-stool", "abdomen", { [GAS]: 100, [ONC]: 30 }),
  t("hemorrhoids-fissure", "abdomen", { [GAS]: 50 }),
  t("colonoscopy-screening", "abdomen", { [GAS]: 100 }),
  t("colon-polyp", "abdomen", { [GAS]: 100 }),
  t("early-gi-cancer", "abdomen", { [GAS]: 100, [ONC]: 30 }),
  t("stomach-cancer", "abdomen", { [ONC]: 100, [GAS]: 50 }),
  t("colorectal-cancer", "abdomen", { [ONC]: 100, [GAS]: 50 }),
  t("gallstones", "abdomen", { [GAS]: 70 }),
  t("bile-duct-stones-jaundice", "abdomen", { [GAS]: 100 }),
  t("pancreatitis-pancreatic-cyst", "abdomen", { [GAS]: 90, [ONC]: 30 }),
  t("pancreatic-cancer", "abdomen", { [ONC]: 100, [GAS]: 60 }),
  t("fatty-liver-liver-enzymes", "abdomen", { [GAS]: 100, [OBE]: 30 }),
  t("liver-tumor", "abdomen", { [ONC]: 100, [IR]: 60, [GAS]: 40 }),
  t("abdominal-hernia", "abdomen", { [OBE]: 80, [PLA]: 30 }),
  t("obesity", "abdomen", { [OBE]: 100 }),
  t("type2-diabetes-metabolic", "abdomen", { [OBE]: 100, [GAS]: 20 }),
  t("bariatric-revision", "abdomen", { [OBE]: 100 }),
  t("gastric-balloon", "abdomen", { [OBE]: 80, [GAS]: 50 }),
  // 5. Pelvis ve üroloji
  t("kidney-stone", "pelvis-urology"),
  t("prostate", "pelvis-urology", { [IR]: 70 }),
  t("urinary-incontinence", "pelvis-urology"),
  t("male-infertility", "pelvis-urology", { [IVF]: 100 }),
  // 6. Kadın sağlığı
  t("infertility", "women", { [IVF]: 100 }),
  t("ivf", "women", { [IVF]: 100 }),
  t("egg-freezing", "women", { [IVF]: 100 }),
  t("recurrent-miscarriage", "women", { [IVF]: 90 }),
  t("pcos", "women", { [IVF]: 80, [OBE]: 30 }),
  t("endometriosis", "women", { [IVF]: 70 }),
  t("uterine-fibroids", "women", { [ONC]: 70, [IR]: 50, [IVF]: 30 }),
  t("ovarian-cyst", "women", { [IVF]: 50, [ONC]: 30 }),
  t("breast-lump", "women", { [ONC]: 100, [PLA]: 20 }),
  t("breast-cancer", "women", { [ONC]: 100, [PLA]: 40 }),
  t("breast-aesthetics", "women", { [PLA]: 100 }),
  // 7. Cilt ve estetik
  t("rhinoplasty", "skin-aesthetic", { [PLA]: 100 }),
  t("fillers-botox", "skin-aesthetic", { [PLA]: 100 }),
  t("facelift", "skin-aesthetic", { [PLA]: 100 }),
  t("eyelid-surgery", "skin-aesthetic", { [PLA]: 100 }),
  t("liposuction-body-contouring", "skin-aesthetic", { [PLA]: 100, [OBE]: 20 }),
  t("tummy-tuck", "skin-aesthetic", { [PLA]: 100 }),
  t("post-weight-loss-contouring", "skin-aesthetic", { [PLA]: 100, [OBE]: 30 }),
  t("gynecomastia", "skin-aesthetic", { [PLA]: 100 }),
  t("scar-revision", "skin-aesthetic", { [PLA]: 90 }),
  t("skin-lesion-mole", "skin-aesthetic", { [PLA]: 40, [ONC]: 40 }),
  // 8. Ağız ve diş — diş sağlığı yalnızca dentalcare, ortodonti yalnızca orthodontist (karar).
  t("toothache", "dental", { [DEN]: 100 }),
  t("dental-abscess", "dental", { [DEN]: 100 }),
  t("gum-recession", "dental", { [DEN]: 100 }),
  t("dental-implant", "dental", { [DEN]: 100 }),
  t("smile-design", "dental", { [DEN]: 100 }),
  t("teeth-whitening", "dental", { [DEN]: 100 }),
  t("braces-crooked-teeth", "dental", { [ORT]: 100 }),
  t("clear-aligners", "dental", { [ORT]: 100 }),
  t("bite-problems", "dental", { [ORT]: 100 }),
  t("root-canal", "dental", { [DEN]: 100 }),
  // 9. Eklem, kemik ve damar
  t("knee-pain", "joints-bones"),
  t("hip-shoulder-pain", "joints-bones"),
  t("varicose-veins", "joints-bones", { [IR]: 100 }),
  // 10. Genel kontrol
  t("general-checkup", "general-checkup"),
  t("longevity", "general-checkup"),
  t("second-opinion", "general-checkup"),
  // 11. Kanser
  t("cancer-screening", "cancer", { [GAS]: 50, [ONC]: 50 }),
  t("cancer-surgery-opinion", "cancer", { [ONC]: 100 }),
  t("soft-tissue-lump", "cancer", { [ONC]: 70, [PLA]: 30 }),
  t("swollen-lymph-nodes", "cancer", { [ONC]: 50 }),
  // 12. Ruh sağlığı
  t("stress-anxiety", "mental-wellbeing"),
  t("sleep-problems", "mental-wellbeing"),
  // 13. Diğer
  t("dialysis-access", "other", { [IR]: 100 }),
  t("something-else", "other"),
  // Kırmızı bayraklar — uzmanlığa eşlenmez.
  rf("rf-chest-pain-breathless", "chest"),
  rf("rf-stroke-signs", "head"),
  rf("rf-severe-bleeding", "other"),
  rf("rf-loss-of-consciousness", "head"),
  rf("rf-thunderclap-headache", "head"),
  rf("rf-suicidal-thoughts", "mental-wellbeing"),
  rf("rf-acute-abdomen", "abdomen"),
  rf("rf-severe-allergy", "other"),
];
