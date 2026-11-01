# Z2 için canlı veri (salt okuma sorguları, 2026-11-01)

Kaynak: canlı veritabanı. Kullanıcı sorguları sunucuda çalıştırdı. Kurallar için `2026-11-01-Z-konu-plani-kurallar.md` dosyasına bak.

## 1) Aktif hekimler (8; "test" pasife alındı)
| slug | title | specialty_slug | isFounder |
|---|---|---|---|
| kamil-ozdil | Prof. Dr. | gastroenterology | f |
| ayse-zehra-ozdemir-kaya | Assoc. Prof. Dr. | ivf-and-reproductive-health | f |
| ali-firat | Prof. Dr. | interventional-radiology-specialist | f |
| hakan-sofu | Prof. Dr. | obesity-and-metabolic-surgery | f |
| vahit-mutlu | Assoc. Prof. Dr. | obesity-and-metabolic-surgery | t |
| kadir-kolcuoglu | Dr. | orthodontist | f |
| hasan-tuna-turkmen | Op. Dr. | plastic-and-aesthetic-surgery | f |
| dogukan-yildirim | Prof. Dr. | surgical-oncology | f |

## 2) Uzmanlıklar (aktif hekim sayısı)
- dentalcare 0
- ercp 0
- esd 0
- gastroenterology 1
- hair-transplantation 0
- ivf-and-reproductive-health 1
- interventional-radiology-specialist 1
- neurosurgery 0
- obesity-and-metabolic-surgery 3 (biri pasif "test")
- orthodontist 1
- poem 0
- plastic-and-aesthetic-surgery 1
- surgical-oncology 1
- thoracic-surgery 0

## 3) Bakım konuları
Canlıda 332 konu var. Aşağıda yalnızca plan için kullanılabilecek olanlar listelenmiştir: `isRedFlag=false`, `isActive=true` ve en az bir uzmanlığı aktif hekimli olanlar. Hepsi aktiftir. Biçim: `slug — EN etiket — uzmanlıklar (ağırlık sırasıyla)`.

### abdomen
- abdominal-hernia — Abdominal / inguinal hernia — obesity-and-metabolic-surgery, plastic-and-aesthetic-surgery
- anal-fistula-pilonidal — Anal fistula / pilonidal sinus — gastroenterology
- ascites — Abdominal fluid (ascites) — gastroenterology, interventional-radiology-specialist
- bariatric-revision — Revision after weight-loss surgery — obesity-and-metabolic-surgery
- bile-duct-stones-jaundice — Bile duct stones / jaundice — gastroenterology
- bloating-ibs — Bloating / IBS — gastroenterology
- blood-in-stool — Blood in stool — gastroenterology, surgical-oncology
- capsule-endoscopy — Capsule endoscopy / small bowel — gastroenterology
- celiac-disease — Coeliac disease / gluten — gastroenterology
- chronic-diarrhea — Chronic diarrhoea — gastroenterology
- chronic-nausea — Chronic nausea / vomiting — gastroenterology
- colon-polyp — Colon / stomach polyp — gastroenterology
- colonoscopy-screening — Colonoscopy / endoscopy — gastroenterology
- colorectal-cancer — Colon / rectal cancer — surgical-oncology, gastroenterology
- constipation — Constipation — gastroenterology
- diverticulitis — Diverticulitis — gastroenterology
- early-gi-cancer — Early GI tumour (endoscopic removal) — gastroenterology, surgical-oncology
- fatty-liver-liver-enzymes — Fatty liver / high liver tests — gastroenterology, obesity-and-metabolic-surgery
- gallbladder-bile-cancer — Gallbladder / bile duct cancer — surgical-oncology, gastroenterology
- gallbladder-surgery — Gallbladder removal surgery — gastroenterology
- gallstones — Gallstones — gastroenterology
- gastric-balloon — Gastric balloon / endoscopic options — obesity-and-metabolic-surgery, gastroenterology
- gastritis-ulcer — Gastritis / ulcer — gastroenterology
- gerd-surgery — Reflux surgery — obesity-and-metabolic-surgery, gastroenterology
- hemorrhoids-fissure — Haemorrhoids / anal fissure — gastroenterology
- hepatitis-b-c — Hepatitis B / C — gastroenterology
- hiatal-hernia — Hiatal hernia — gastroenterology, obesity-and-metabolic-surgery
- indigestion-stomach-pain — Indigestion / stomach pain — gastroenterology
- lactose-intolerance — Food intolerance — gastroenterology
- liver-cirrhosis — Liver cirrhosis — gastroenterology
- liver-tumor — Liver tumour — surgical-oncology, interventional-radiology-specialist, gastroenterology
- obesity — Obesity / weight loss — obesity-and-metabolic-surgery
- pancreatic-cancer — Pancreatic cancer — surgical-oncology, gastroenterology
- pancreatitis-pancreatic-cyst — Pancreatitis / pancreatic cyst — gastroenterology, surgical-oncology
- reflux-heartburn — Reflux / heartburn — gastroenterology, obesity-and-metabolic-surgery
- stomach-cancer — Stomach cancer — surgical-oncology, gastroenterology
- type2-diabetes-metabolic — Type 2 diabetes (metabolic surgery) — obesity-and-metabolic-surgery, gastroenterology
- ulcerative-colitis-crohn — Crohn's / ulcerative colitis — gastroenterology

### cancer
- cancer-follow-up — Cancer follow-up after treatment — surgical-oncology
- cancer-of-unknown-origin — Metastasis / unknown primary — surgical-oncology
- cancer-screening — Cancer screening — surgical-oncology, gastroenterology
- cancer-surgery-opinion — Cancer surgery / second opinion — surgical-oncology
- neuroendocrine-tumor — Neuroendocrine tumour — surgical-oncology, gastroenterology
- peritoneal-cancer-hipec — Peritoneal cancer / HIPEC — surgical-oncology
- sarcoma — Sarcoma — surgical-oncology
- soft-tissue-lump — Lump under the skin — surgical-oncology, plastic-and-aesthetic-surgery
- swollen-lymph-nodes — Swollen lymph nodes — surgical-oncology
- testicular-cancer — Testicular cancer — surgical-oncology
- thyroid-cancer — Thyroid cancer — surgical-oncology
- tumour-ablation — Tumour ablation / embolisation — interventional-radiology-specialist, surgical-oncology

### chest
- achalasia — Achalasia — gastroenterology
- chest-wall-deformity — Chest wall deformity — thoracic-surgery, plastic-and-aesthetic-surgery
- chronic-cough — Long-lasting cough — thoracic-surgery, gastroenterology
- esophageal-cancer — Oesophageal cancer — surgical-oncology, gastroenterology, thoracic-surgery
- lung-cancer — Lung cancer — thoracic-surgery, surgical-oncology
- lung-nodule — Lung nodule — thoracic-surgery, surgical-oncology
- mediastinal-mass — Mediastinal mass — thoracic-surgery, surgical-oncology
- swallowing-difficulty — Difficulty swallowing — gastroenterology

### dental (yalnızca ortodonti)
- bite-problems — Bite / jaw alignment problems — orthodontist
- braces-crooked-teeth — Braces / crooked teeth — orthodontist
- clear-aligners — Clear aligners — orthodontist

### ent / eyes / head / neck-spine / joints
- head-neck-cancer — Head and neck cancer (diagnosed) — surgical-oncology
- throat-lump — Lump in the throat feeling — gastroenterology
- eyelid-droop — Drooping eyelid — plastic-and-aesthetic-surgery
- brain-aneurysm — Brain aneurysm (known, not acute) — neurosurgery, interventional-radiology-specialist
- brain-tumor-suspicion — Brain tumour (suspected/diagnosed) — neurosurgery, surgical-oncology
- hair-loss — Hair loss — hair-transplantation, plastic-and-aesthetic-surgery
- spinal-cord-tumor — Spinal cord tumour — neurosurgery, surgical-oncology
- hand-numbness-carpal-tunnel — Hand numbness / carpal tunnel — neurosurgery, plastic-and-aesthetic-surgery
- neck-lump — Lump in the neck — surgical-oncology
- thyroid-nodule — Thyroid nodule / goitre — interventional-radiology-specialist, surgical-oncology
- bone-tumor — Bone tumour — surgical-oncology
- hand-wrist — Hand / wrist problems — plastic-and-aesthetic-surgery

### heart-vessels (girişimsel radyoloji)
- aortic-aneurysm — Aortic aneurysm — interventional-radiology-specialist
- carotid-stenosis — Carotid artery narrowing — interventional-radiology-specialist
- claudication — Leg pain when walking (claudication) — interventional-radiology-specialist
- dvt-history — Blood clot follow-up (DVT) — interventional-radiology-specialist
- peripheral-artery-disease — Blocked leg arteries — interventional-radiology-specialist
- spider-veins — Spider veins — interventional-radiology-specialist
- varicose-veins — Varicose veins / venous insufficiency — interventional-radiology-specialist

### pelvis-urology / other
- kidney-bladder-cancer — Kidney / bladder cancer — surgical-oncology
- kidney-failure-dialysis — Kidney failure / dialysis — interventional-radiology-specialist
- male-infertility — Male infertility — ivf-and-reproductive-health
- prostate — Prostate enlargement — interventional-radiology-specialist
- prostate-cancer — Prostate cancer (diagnosed) — surgical-oncology
- testicle-lump — Testicle lump (not sudden pain) — surgical-oncology
- varicocele — Varicocele — interventional-radiology-specialist, ivf-and-reproductive-health
- dialysis-access — Dialysis fistula / access problems — interventional-radiology-specialist

### skin-aesthetic (estetik ve plastik cerrahi)
- acne-scars — Acne scars — plastic-and-aesthetic-surgery
- arm-thigh-lift — Arm / thigh lift — plastic-and-aesthetic-surgery
- breast-implant-revision — Breast implant removal / revision — plastic-and-aesthetic-surgery
- breast-reduction — Breast reduction — plastic-and-aesthetic-surgery
- brow-lift — Brow / forehead lift — plastic-and-aesthetic-surgery
- chin-jaw-contouring — Chin / jawline — plastic-and-aesthetic-surgery
- chronic-wound — Non-healing wound — plastic-and-aesthetic-surgery
- eyelid-surgery — Eyelid surgery — plastic-and-aesthetic-surgery
- facelift — Face and neck lift — plastic-and-aesthetic-surgery
- fat-transfer-bbl — Fat transfer / BBL — plastic-and-aesthetic-surgery
- fillers-botox — Fillers / botox — plastic-and-aesthetic-surgery
- gynecomastia — Gynaecomastia — plastic-and-aesthetic-surgery
- lip-lift — Lip lift — plastic-and-aesthetic-surgery
- liposuction-body-contouring — Liposuction / body contouring — plastic-and-aesthetic-surgery, obesity-and-metabolic-surgery
- lymphedema — Lymphoedema — plastic-and-aesthetic-surgery
- mommy-makeover — Mommy makeover — plastic-and-aesthetic-surgery
- otoplasty — Prominent ears — plastic-and-aesthetic-surgery
- post-weight-loss-contouring — Skin removal after weight loss — plastic-and-aesthetic-surgery, obesity-and-metabolic-surgery
- revision-rhinoplasty — Revision rhinoplasty — plastic-and-aesthetic-surgery
- rhinoplasty — Nose aesthetics — plastic-and-aesthetic-surgery
- scar-revision — Scar revision — plastic-and-aesthetic-surgery
- skin-cancer — Skin cancer / melanoma — surgical-oncology, plastic-and-aesthetic-surgery
- skin-laser-rejuvenation — Skin rejuvenation (laser, peels) — plastic-and-aesthetic-surgery
- skin-lesion-mole — Mole / skin lesion — plastic-and-aesthetic-surgery, surgical-oncology
- tummy-tuck — Tummy tuck — plastic-and-aesthetic-surgery

### women
- adenomyosis — Adenomyosis — interventional-radiology-specialist, surgical-oncology, ivf-and-reproductive-health
- breast-aesthetics — Breast aesthetics — plastic-and-aesthetic-surgery
- breast-cancer — Breast cancer — surgical-oncology, plastic-and-aesthetic-surgery
- breast-lump — Breast lump — surgical-oncology, plastic-and-aesthetic-surgery
- cervical-uterine-cancer — Cervical / uterine cancer — surgical-oncology
- egg-freezing — Egg freezing — ivf-and-reproductive-health
- endometriosis — Endometriosis — ivf-and-reproductive-health
- infertility — Infertility — ivf-and-reproductive-health
- ivf — IVF treatment — ivf-and-reproductive-health
- ovarian-cancer — Ovarian cancer — surgical-oncology
- ovarian-cyst — Ovarian cyst — ivf-and-reproductive-health, surgical-oncology
- pcos — PCOS — ivf-and-reproductive-health, obesity-and-metabolic-surgery
- recurrent-miscarriage — Recurrent miscarriage — ivf-and-reproductive-health
- uterine-fibroids — Uterine fibroids — surgical-oncology, interventional-radiology-specialist, ivf-and-reproductive-health
- vaginal-aesthetics — Intimate aesthetics — plastic-and-aesthetic-surgery

### Uzmanlığı olmayan genel konular (check-up paketleri ve seyahat rehberleri için)
- general-checkup — General check-up
- genetic-testing — Genetic testing
- longevity — Longevity / healthy ageing
- mens-checkup — Men's check-up
- pre-surgery-assessment — Pre-operative assessment
- second-opinion — Second opinion
- sports-medicine-check — Sports health check
- travel-vaccines — Vaccines / travel health
- womens-checkup — Women's check-up
- medical-tourism-planning — Treatment in Istanbul — planning
- second-opinion-surgery — Surgery recommended — second opinion

### "Beklemede" bölümü için (hekim gelince)
- **Kardiyoloji** (canlıda uzmanlık bağlantısı yok): arrhythmia-pacemaker, chest-pain-recurring, coronary-bypass-opinion, heart-failure, heart-valve, high-blood-pressure, high-cholesterol, palpitations, low-blood-pressure.
- **Genel diş** (dentalcare): all-on-4, bad-breath, bone-graft-sinus-lift, crowns-bridges, dental-abscess, dental-implant, dentures, gum-recession, gummy-smile, root-canal, sensitive-broken-teeth, smile-design, teeth-grinding-tmj, teeth-whitening, tooth-extraction, toothache, wisdom-tooth.

## 4) Aktif paketler
| slug | category | title_en | isFeatured |
|---|---|---|---|
| dermal-filler-botox | aesthetic | Dermal Filler & Botox | t |
| executive-check-up | check-up | Executive Check-up | t |
| cardiac-check-up | check-up | Cardiac Check-up | t |
| cancer-screening | check-up | Cancer Screening | t |
| dental-check-cleaning | dental | Dental Check & Cleaning | t |
| longevity-assessment | longevity | Longevity Assessment | t |
| therapeutic-massage | wellness | Therapeutic Massage | t |
| womens-check-up | women | Women's Check-up | t |
