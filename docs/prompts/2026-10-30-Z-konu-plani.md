# Paket Z2 — Konu planı (100 başlık) — ONAYLANDI, kararlarla güncellendi (2026-11-01)

**Plan onaylandı (kararlar aşağıda). Yazım 10'luk partilerle başlıyor.**

**Kaynaklar:**
- `2026-10-30-Z-blog-yenileme-100-yazi.md` (Z2 bölümü)
- `2026-11-01-Z-konu-plani-kurallar.md` (çelişkide bu geçerli)
- `2026-11-01-Z-canli-veri.md`: canlıdan alınan hekim, uzmanlık, bakım konusu ve paket listesi. Yerel veri kullanılmadı.

## Özet

| | |
|---|---|
| Toplam | **100** başlık: 85 tıbbi rehber + 15 "Health travel to Istanbul" rehberi |
| Uzmanlıklar | Yalnızca aktif hekimi olan 7 uzmanlık. ERCP, ESD ve POEM gastroenterolojide (kamil-ozdil). Diş yalnızca ortodonti (kadir-kolcuoglu). |
| İnceleyen hekim | Her tıbbi yazının hekimi, yazının uzmanlığından. "test" profili hiçbir yerde yok. |
| Seyahat rehberleri | 15 adet, `isMedical=false` kategoride, `medicalReviewStatus=not_required`, uzmanlık ve hekim yok. |
| Paket bağlantıları | Yalnızca executive-check-up, cancer-screening, womens-check-up, dermal-filler-botox (longevity-assessment artık yalnızca "Beklemede"de). cardiac-check-up ve dental-check-cleaning yalnızca "Beklemede"de. therapeutic-massage hiç kullanılmıyor. |
| Bakım konuları | Yalnızca `isActive=true`, `isRedFlag=false` olan ve yazının uzmanlığıyla eşleşen konular, canlı listeden. Uzmanlığı olmayan genel konular yalnızca check-up ve seyahat yazılarında (aşağıdaki "Onay istenen kararlar" 1). |

## Hekim yükü (dengeli; kurucuya yığılma yok)

| Hekim | Uzmanlık | Yazı |
|---|---|---|
| kamil-ozdil (Prof. Dr.) | gastroenterology (ERCP/ESD/POEM dahil) | 12 |
| ayse-zehra-ozdemir-kaya (Assoc. Prof. Dr.) | ivf-and-reproductive-health | 11 |
| ali-firat (Prof. Dr.) | interventional-radiology-specialist | 11 |
| hakan-sofu (Prof. Dr.) | obesity-and-metabolic-surgery | 11 |
| vahit-mutlu (Assoc. Prof. Dr., kurucu) | obesity-and-metabolic-surgery | 10 |
| kadir-kolcuoglu (Dr.) | orthodontist | 7 (kapsam yalnızca ortodonti) |
| hasan-tuna-turkmen (Op. Dr.) | plastic-and-aesthetic-surgery | 12 |
| dogukan-yildirim (Prof. Dr.) | surgical-oncology | 11 |
| **Toplam** | | **85** |

## Kategoriler (Z2 içe aktarma script'i slug ile idempotent oluşturur, 9 dil)

| slug | isMedical | EN | TR | DE | AR | RU | ES | FR | RO | SR (latin) |
|---|---|---|---|---|---|---|---|---|---|---|
| digestive-health | true | Digestive health | Sindirim sağlığı | Verdauungsgesundheit | صحة الجهاز الهضمي | Здоровье пищеварения | Salud digestiva | Santé digestive | Sănătate digestivă | Zdravlje digestivnog sistema |
| fertility-reproductive-health | true | Fertility & reproductive health | Doğurganlık ve üreme sağlığı | Fruchtbarkeit & reproduktive Gesundheit | الخصوبة والصحة الإنجابية | Фертильность и репродуктивное здоровье | Fertilidad y salud reproductiva | Fertilité et santé reproductive | Fertilitate și sănătate reproductivă | Plodnost i reproduktivno zdravlje |
| interventional-radiology-vascular | true | Interventional radiology & vascular health | Girişimsel radyoloji ve damar sağlığı | Interventionelle Radiologie & Gefäßgesundheit | الأشعة التداخلية وصحة الأوعية الدموية | Интервенционная радиология и здоровье сосудов | Radiología intervencionista y salud vascular | Radiologie interventionnelle et santé vasculaire | Radiologie intervențională și sănătate vasculară | Interventna radiologija i zdravlje krvnih sudova |
| weight-loss-metabolic-health | true | Weight loss & metabolic health | Kilo verme ve metabolik sağlık | Gewichtsabnahme & Stoffwechselgesundheit | إنقاص الوزن والصحة الأيضية | Снижение веса и метаболическое здоровье | Pérdida de peso y salud metabólica | Perte de poids et santé métabolique | Scădere în greutate și sănătate metabolică | Mršavljenje i metaboličko zdravlje |
| check-ups-prevention | true | Check-ups & prevention | Check-up ve koruyucu sağlık | Vorsorge & Check-ups | الفحوصات الدورية والوقاية | Чекапы и профилактика | Chequeos y prevención | Bilans de santé et prévention | Controale și prevenție | Preventivni pregledi i prevencija |
| orthodontics | true | Orthodontics | Ortodonti | Kieferorthopädie | تقويم الأسنان | Ортодонтия | Ortodoncia | Orthodontie | Ortodonție | Ortodoncija |
| plastic-aesthetic-surgery | true | Plastic & aesthetic surgery | Plastik ve estetik cerrahi | Plastische & ästhetische Chirurgie | الجراحة التجميلية والترميمية | Пластическая и эстетическая хирургия | Cirugía plástica y estética | Chirurgie plastique et esthétique | Chirurgie plastică și estetică | Plastična i estetska hirurgija |
| cancer-care | true | Cancer care | Kanser bakımı | Krebsversorgung | رعاية مرضى السرطان | Онкологическая помощь | Atención del cáncer | Prise en charge du cancer | Îngrijirea cancerului | Lečenje raka |
| health-travel-guide | **false** | Health travel guide | Sağlık turizmi rehberi | Ratgeber Gesundheitsreisen | دليل السفر العلاجي | Путеводитель по медицинскому туризму | Guía de turismo de salud | Guide du tourisme médical | Ghid de turism medical | Vodič za zdravstveni turizam |

## Başlıklar

**Sütunlar:** arama niyeti (B = bilgi, K = karar/karşılaştırma, H = hazırlık/süreç, P = planlama/yurt dışından), bakım konusu slug'ları (`careTopicIds`), inceleyen hekim, paket bağlantısı ("—" = paket yok).

**Her yazının sonunda:**
- ilgili uzmanlık sayfası;
- W sihirbazı ("Find my physician");
- varsa paket bağlantısı.

### A. Sindirim sağlığı — gastroenterology — kamil-ozdil (12) · kategori `digestive-health`

| # | Başlık (EN, çalışma başlığı) | Niyet | Bakım konuları | Paket |
|---|---|---|---|---|
| 1 | ERCP explained: why it is done, how to prepare and what recovery looks like | B/H | bile-duct-stones-jaundice | — |
| 2 | ESD for early digestive tract tumours: what endoscopic removal involves | B | early-gi-cancer, colon-polyp | cancer-screening |
| 3 | POEM for achalasia: how the procedure works and who it may suit | B/K | achalasia, swallowing-difficulty | — |
| 4 | Colonoscopy and endoscopy: preparation, sedation and what to expect | H | colonoscopy-screening, capsule-endoscopy | cancer-screening |
| 5 | Colon polyps: why they are removed and how follow-up is planned | B | colon-polyp, blood-in-stool | cancer-screening |
| 6 | Reflux and heartburn: when it is time to see a gastroenterologist | B | reflux-heartburn, hiatal-hernia | — |
| 7 | Fatty liver and abnormal liver tests: what the results can mean | B | fatty-liver-liver-enzymes | executive-check-up |
| 8 | Gallstones: symptoms, tests and treatment options | B/K | gallstones, gallbladder-surgery | — |
| 9 | Bloating and IBS: understanding long-lasting digestive symptoms | B | bloating-ibs, chronic-diarrhea, constipation | — |
| 10 | Crohn's disease and ulcerative colitis: diagnosis and long-term care | B | ulcerative-colitis-crohn | — |
| 11 | Hepatitis B and C: testing, monitoring and treatment basics | B | hepatitis-b-c, liver-cirrhosis | — |
| 12 | Coeliac disease or food intolerance? How each is diagnosed | K | celiac-disease, lactose-intolerance | — |

### B. Doğurganlık ve üreme sağlığı — ivf-and-reproductive-health — ayse-zehra-ozdemir-kaya (11) · kategori `fertility-reproductive-health` (22 numara `check-ups-prevention`)

| # | Başlık | Niyet | Bakım konuları | Paket |
|---|---|---|---|---|
| 13 | IVF step by step: from the first consultation to embryo transfer | H | ivf, infertility | — |
| 14 | Egg freezing: who considers it and how the process works | B/K | egg-freezing | — |
| 15 | Fertility tests for couples: what to expect at the first visit | H | infertility, male-infertility | — |
| 16 | Male infertility: common causes and how it is evaluated | B | male-infertility, varicocele | — |
| 17 | PCOS and fertility: symptoms, diagnosis and planning ahead | B | pcos | — |
| 18 | Endometriosis and adenomyosis: symptoms and fertility considerations | B | endometriosis, adenomyosis | — |
| 19 | Recurrent miscarriage: which investigations may help | B | recurrent-miscarriage | — |
| 20 | Ovarian cysts: common types and when follow-up is needed | B | ovarian-cyst | — |
| 21 | Uterine fibroids and fertility: what to discuss with your doctor | B/K | uterine-fibroids | — |
| 22 | Women's check-up: which screenings are recommended at each age | B/H | womens-checkup | womens-check-up |
| 23 | Planning fertility treatment from abroad: remote steps and visits in Istanbul | P | ivf, infertility, medical-tourism-planning | — |

### C. Girişimsel radyoloji ve damar sağlığı — interventional-radiology-specialist — ali-firat (11) · kategori `interventional-radiology-vascular`

| # | Başlık | Niyet | Bakım konuları | Paket |
|---|---|---|---|---|
| 24 | What is interventional radiology? Image-guided, minimally invasive treatments | B | tumour-ablation | — |
| 25 | Varicose and spider veins: symptoms and minimally invasive options | B/K | varicose-veins, spider-veins | — |
| 26 | Blocked leg arteries: warning signs and treatment approaches | B | peripheral-artery-disease, claudication | — |
| 27 | Uterine fibroid embolisation: a non-surgical option explained | K | uterine-fibroids, adenomyosis | — |
| 28 | Prostate artery embolisation for an enlarged prostate | K | prostate | — |
| 29 | Thyroid nodules: evaluation and image-guided treatment options | B/K | thyroid-nodule | — |
| 30 | Ablation and embolisation in liver tumour care | B | liver-tumor, tumour-ablation | — |
| 31 | Carotid artery narrowing: what tests show and how it is treated | B | carotid-stenosis | — |
| 32 | Aortic aneurysm: monitoring and endovascular repair | B | aortic-aneurysm | — |
| 33 | Varicocele embolisation: an alternative to surgery | K | varicocele | — |
| 34 | Blood clots and long journeys: DVT follow-up and flying after a procedure | H/P | dvt-history | — |

### D. Kilo verme ve metabolik sağlık — obesity-and-metabolic-surgery — hakan-sofu (11) / vahit-mutlu (10) · kategori `weight-loss-metabolic-health` (53–54 `check-ups-prevention`)

| # | Başlık | Niyet | Bakım konuları | Hekim | Paket |
|---|---|---|---|---|---|
| 35 | Gastric sleeve or gastric bypass: understanding the differences | K | obesity | hakan-sofu | — |
| 36 | Who is a candidate for weight-loss surgery? | B | obesity | vahit-mutlu | — |
| 37 | Preparing for bariatric surgery: tests and lifestyle steps | H | obesity | hakan-sofu | — |
| 38 | Eating after gastric sleeve surgery: the diet stages explained | H | obesity | vahit-mutlu | — |
| 39 | Metabolic surgery and type 2 diabetes: what research shows | B | type2-diabetes-metabolic | hakan-sofu | — |
| 40 | Gastric balloon and endoscopic options: who are they for? | K | gastric-balloon | vahit-mutlu | — |
| 41 | Revision after weight-loss surgery: when it is considered | B | bariatric-revision | hakan-sofu | — |
| 42 | Reflux after sleeve gastrectomy and the role of reflux surgery | B | gerd-surgery, reflux-heartburn | vahit-mutlu | — |
| 43 | Hiatal hernia: symptoms and surgical repair | B | hiatal-hernia | hakan-sofu | — |
| 44 | Abdominal and inguinal hernia: when surgery is recommended | B | abdominal-hernia | vahit-mutlu | — |
| 45 | Fatty liver and excess weight: how weight loss affects liver health | B | fatty-liver-liver-enzymes | hakan-sofu | executive-check-up |
| 46 | PCOS and weight: the metabolic side of the condition | B | pcos | vahit-mutlu | — |
| 47 | Skin removal after major weight loss: timing and planning | H | post-weight-loss-contouring | hakan-sofu | — |
| 48 | Long-term follow-up after bariatric surgery: nutrition and check-ups | H | obesity | vahit-mutlu | — |
| 49 | Travelling for weight-loss surgery: planning, length of stay and remote follow-up | P | obesity, medical-tourism-planning | hakan-sofu | — |
| 50 | Gastric bypass surgery: how it works and what recovery involves | B/H | obesity | hakan-sofu | — |
| 51 | Weight regain after bariatric surgery: causes and next steps | B/K | bariatric-revision | vahit-mutlu | — |
| 52 | Liposuction or weight-loss surgery? How the two differ | K | liposuction-body-contouring | vahit-mutlu | — |
| 53 | Pre-operative assessment: why tests are needed before surgery | H | pre-surgery-assessment | hakan-sofu | — |
| 54 | Waist size, blood sugar and blood pressure: understanding metabolic risk | B | type2-diabetes-metabolic | vahit-mutlu | executive-check-up |
| 55 | One-anastomosis (mini) gastric bypass: an overview | B | obesity | hakan-sofu | — |

### E. Ortodonti — orthodontist — kadir-kolcuoglu (7) · kategori `orthodontics`

| # | Başlık | Niyet | Bakım konuları | Paket |
|---|---|---|---|---|
| 56 | Braces or clear aligners: questions to discuss with your orthodontist | K | braces-crooked-teeth, clear-aligners | — |
| 57 | How clear aligners move teeth: treatment steps explained | B | clear-aligners | — |
| 58 | Orthodontics for adults: is it ever too late for braces? | B | braces-crooked-teeth | — |
| 59 | Overbite, underbite and crossbite: causes and treatment options | B | bite-problems | — |
| 60 | Retainers after orthodontic treatment: why they matter | H | braces-crooked-teeth | — |
| 61 | Orthodontic treatment while living abroad: remote monitoring and visits | P | clear-aligners, medical-tourism-planning | — |
| 62 | When should a child have a first orthodontic check? | B | bite-problems | — |

### F. Plastik ve estetik cerrahi — plastic-and-aesthetic-surgery — hasan-tuna-turkmen (12) · kategori `plastic-aesthetic-surgery`

| # | Başlık | Niyet | Bakım konuları | Paket |
|---|---|---|---|---|
| 63 | Rhinoplasty: what to discuss in your consultation | H | rhinoplasty, revision-rhinoplasty | — |
| 64 | Eyelid surgery: functional and aesthetic reasons | B | eyelid-surgery, eyelid-droop | — |
| 65 | Tummy tuck: recovery stages and planning | H | tummy-tuck, mommy-makeover | — |
| 66 | Liposuction and body contouring: setting realistic expectations | B/K | liposuction-body-contouring | — |
| 67 | Dermal fillers and botox: how they work and what to ask | B | fillers-botox | dermal-filler-botox |
| 68 | Face and neck lift: what the procedures involve | B | facelift, brow-lift | — |
| 69 | Breast reduction: symptoms it may relieve and recovery | B | breast-reduction | — |
| 70 | Breast implant removal or revision: reasons and options | K | breast-implant-revision, breast-aesthetics | — |
| 71 | Gynaecomastia: causes and treatment options | B | gynecomastia | — |
| 72 | Scar revision and acne scars: treatment options | K | scar-revision, acne-scars | — |
| 73 | Planning aesthetic surgery in Istanbul: consultation, stay and aftercare | P | medical-tourism-planning | — |
| 74 | Skin rejuvenation: lasers and peels explained | B | skin-laser-rejuvenation | dermal-filler-botox |

### G. Kanser bakımı — surgical-oncology — dogukan-yildirim (11) · kategori `cancer-care` (76 `check-ups-prevention`)

| # | Başlık | Niyet | Bakım konuları | Paket |
|---|---|---|---|---|
| 75 | Getting a second opinion before cancer surgery | K | cancer-surgery-opinion, second-opinion-surgery | — |
| 76 | Cancer screening: which tests are recommended and when | B | cancer-screening | cancer-screening |
| 77 | Colorectal cancer: the diagnosis and treatment pathway | B | colorectal-cancer, blood-in-stool | cancer-screening |
| 78 | Stomach cancer: symptoms, tests and surgical treatment | B | stomach-cancer | — |
| 79 | Pancreatic cancer: understanding diagnosis and treatment options | B | pancreatic-cancer | — |
| 80 | Peritoneal cancer and HIPEC: what patients should know | B | peritoneal-cancer-hipec | — |
| 81 | Finding a breast lump: what happens next | H | breast-lump, breast-cancer | womens-check-up |
| 82 | Thyroid cancer: diagnosis and surgery | B | thyroid-cancer, neck-lump | — |
| 83 | Swollen lymph nodes: when they need to be checked | B | swollen-lymph-nodes, neck-lump | — |
| 84 | Life after cancer treatment: follow-up schedules and what to watch | H | cancer-follow-up | — |
| 85 | Skin cancer and melanoma: checking moles and skin changes | B | skin-cancer, skin-lesion-mole | cancer-screening |

### H. Health travel to Istanbul (15) · kategori `health-travel-guide` (`isMedical=false`, `not_required`, uzmanlık ve hekim yok)

| # | Başlık | Niyet | Bakım konuları | Paket |
|---|---|---|---|---|
| 86 | Planning treatment in Istanbul: a step-by-step guide | P | medical-tourism-planning | — |
| 87 | How an online pre-consultation works before you travel | P/H | medical-tourism-planning, second-opinion | — |
| 88 | Which medical documents to bring, and how to share them securely | H | medical-tourism-planning | — |
| 89 | Entry and visa requirements for medical travel to Türkiye: where to check | P | medical-tourism-planning | — |
| 90 | Choosing accommodation for your recovery in Istanbul | P | medical-tourism-planning | — |
| 91 | Travelling with a companion: how they can help | P | medical-tourism-planning | — |
| 92 | Interpreter support during your visit | P | medical-tourism-planning | — |
| 93 | Arrival day: airport, transfer and your first appointment | P | medical-tourism-planning | — |
| 94 | Getting your medical records translated | H | medical-tourism-planning | — |
| 95 | A packing list for a medical trip to Istanbul | H | medical-tourism-planning | — |
| 96 | Gentle things to do in Istanbul while you recover | P | medical-tourism-planning | — |
| 97 | Aftercare at home: remote follow-up after you return | H | medical-tourism-planning | — |
| 98 | Communicating with your care team before and after your trip | P/H | medical-tourism-planning | — |
| 99 | Your health data when you travel for care: privacy explained ⚖️ *hukuk kontrolü* | B | medical-tourism-planning | — |
| 100 | Seasons in Istanbul: planning your treatment dates | P | medical-tourism-planning | — |

## Beklemede (100'e dahil değil; hekim eklenince açılır, şimdi yazılmaz)

### İç hastalıkları (check-up) — inceleyen: "iç hastalıkları uzmanı (eklenecek)" — kullanıcı kararı 2026-11-01

1. Healthy ageing: what a longevity assessment looks at (longevity) — paket: longevity-assessment
2. Executive check-up: what is included and how to prepare (general-checkup) — paket: executive-check-up
3. Men's health check-up: recommended screenings by age (mens-checkup) — paket: executive-check-up
4. Sports health check: who may benefit from one (sports-medicine-check) — paket: longevity-assessment

### Kardiyoloji — inceleyen: "kardiyolog (eklenecek)" — paket: cardiac-check-up

1. Palpitations: when an irregular heartbeat needs checking (palpitations, arrhythmia-pacemaker)
2. High blood pressure: understanding your readings (high-blood-pressure)
3. High cholesterol: what the numbers mean (high-cholesterol)
4. Recurring chest pain: which heart tests may be recommended (chest-pain-recurring)
5. Heart valve disease: symptoms and treatment approaches (heart-valve)
6. Living with heart failure: monitoring and care (heart-failure)
7. Pacemakers: who needs one and what to expect (arrhythmia-pacemaker)
8. Coronary bypass: getting a second opinion (coronary-bypass-opinion)
9. Low blood pressure and dizziness: common causes (low-blood-pressure)
10. Cardiac check-up: what it includes and who may benefit (high-blood-pressure, high-cholesterol)

### Genel diş — inceleyen: "diş hekimi (eklenecek)" — paket: dental-check-cleaning

1. Dental implants: the treatment steps explained (dental-implant)
2. All-on-4: who it may suit (all-on-4)
3. Bone grafting and sinus lift before implants (bone-graft-sinus-lift)
4. Root canal treatment: why it is done and what to expect (root-canal, toothache)
5. Teeth whitening: options and what to ask (teeth-whitening)
6. Smile design: what the planning involves (smile-design, gummy-smile)
7. Crowns and bridges: when they are recommended (crowns-bridges, sensitive-broken-teeth)
8. Gum recession: causes and treatment (gum-recession)
9. Teeth grinding and jaw pain (teeth-grinding-tmj)
10. Wisdom teeth: when removal is considered (wisdom-tooth, tooth-extraction)

## Yazım ve teslim (Z2 kuralları; plan onayından sonra)

- **Metin:**
  - EN, 1.200–1.800 kelime, H2/H3 yapısı, 4–6 key takeaway, 5–8 FAQ.
  - Sade ve sakin dil.
  - **Yok:** fiyat, başarı oranı, garanti, üstünlük iddiası, önce/sonra, ilaç dozu.
  - Hekimler metinde adlarıyla geçmez; yalnızca "Consult a physician" kartında listelenir.
- **Kaynaklar:**
  - Yalnızca otoriter kaynaklar: WHO, NHS, NIH/MedlinePlus, CDC, uzmanlık dernekleri, T.C. Sağlık Bakanlığı.
  - **Erişip doğruladığım** bağlantılar konur. Doğrulayamadığım bağlantı eklenmez, yazı "kaynak eksik" olarak işaretlenir.
- **Kapak:** üretilmez; şablon kapak gösterilir.
- **Teslim:** `imports/blog/batch-XX.json` (gitignore), 10'luk partiler.
  - `backend/scripts/import-blog-posts.ts`:
    - kuru çalıştırma varsayılan, `--confirm=import-blog --operator=…`;
    - slug ile idempotent; yedek ve `--restore`;
    - **kategorileri de slug ile, 9 dilde idempotent oluşturur**;
    - yazılar `DRAFT` ve `pending`, seyahat yazıları `not_required`.
  - Canlıda varsayılan dil EN: metin kanonik kolonlara yazılır.
  - Her partiden sonra kısa rapor: başlıklar, kelime ve kaynak sayısı, "kaynak eksik" listesi, yazılar arası tekrar oranı.
  - **Her 30 yazıda bir durup onay istenir.**

## Kararlar (kullanıcı, 2026-11-01)

1. **Genel bakım konuları** yalnızca check-up, seyahat ve "yurt dışından planlama" yazılarında kullanılır: onaylandı.
2. **Check-up yazıları:**
   - #53 (pre-operative assessment) ve #54 (metabolic risk) obezite ve metabolik cerrahi hekimlerinde kaldı.
   - Eski #50 longevity, #51 executive, #52 men's ve #55 sports "Beklemede > İç hastalıkları"na taşındı.
   - Yerlerine 4 yeni başlık geldi: #50, #51, #52, #55, obezite ve metabolik cerrahi alanından. Hekim yükü değişmedi: hakan-sofu 11, vahit-mutlu 10.
3. **Seyahat yazıları:**
   - #98 (travel vaccines) çıkarıldı; yerine tıbbi olmayan "Communicating with your care team before and after your trip" geldi.
   - #99 kaldı ve **hukuk kontrol listesine** eklendi (sağlık verisi ve gizlilik ifadeleri).
4. **Ortodonti 7 yazı:** onaylandı.
5. **Başlıklar çalışma başlığıdır.** Yazım sırasında SEO uzunluğu için kısaltılabilir; anlam ve kapsam değişmez.

## Hukuk kontrol listesi (Z2)

- #99 "Your health data when you travel for care: privacy explained": KVKK/GDPR ifadeleri, veri aktarımı ve saklama süreleri hukuk onayı olmadan yayınlanmaz.
- #89 "Entry and visa requirements…": resmî kaynaklara yönlendirir, kesin vize bilgisi vermez; yine de kontrol edilmeli.
