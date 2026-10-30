# Paket W — Şikayet/İhtiyaç → Uzmanlık Eşleme Tablosu (hekim kontrolü için)

> **Durum:** Kullanıcı kararları işlendi (2026-10-30). Canlıya yüklenmeden önce **bir hekimimize gösterilecek.** Seed kuru çalıştırmayla gelir.
>
> Sihirbaz **tanı koymaz.** Bu tablo yalnızca "hangi uzmanlık alanındaki hekime yönlendirelim?" sorusunu yanıtlar.

## Nasıl okunur

- **Ağırlık (1–100):** Konunun o uzmanlığa ne kadar uygun olduğunu gösterir. 100 en uygun uzmanlıktır; 20–40 ikincil, "bu hekim de bakabilir" düzeyidir.
- **Hesap:** Hasta en çok 3 konu seçer. Her uzmanlığın puanı, seçilen konulardaki ağırlıklarının toplamıdır. Puanı **40 ve üzeri** olan uzmanlıklardan en yüksek **2** tanesi önerilir.
- **Hekimi olmayan uzmanlık önerilmez.** Bu kural tabloda değil **kodda** uygulanır:
  - Öneri anında yayında ve aktif hekimi olmayan uzmanlıklar puanlamadan düşülür.
  - Geriye eşiği geçen uzmanlık kalmazsa koordinatör yoluna gidilir; lead oluşur ve "1 iş günü içinde bildirelim" gösterilir.
  - Ağırlıklar tabloda kalır; uzmanlığa hekim atanınca kendiliğinden devreye girer.
  - Bugün hekimi olmayanlar: `dentalcare`, `hair-transplantation`, `thoracic-surgery`, `neurosurgery`. Bu uzmanlıklara bağlı konular şu an koordinatör yoluna düşer.
- **KOORD:** Bu konunun uygun bir uzmanlığı yok; doğrudan koordinatör yoluna gider.
- **Kırmızı bayrak:** Hiçbir uzmanlığa eşlenmez. Seçildiğinde ya da serbest metinde eş anlamlısı geçtiğinde tam ekran acil uyarısı çıkar.
- **Eş anlamlılar:** Tabloda TR/EN örnekleri var. Seed dosyasında her konu için **9 dilde** eş anlamlı bulunur (TR, EN, DE, FR, ES, RU, AR, RO, SR-Latin), halk ağzı dahil. Örnek:
  - TR "mide yanması"
  - DE "Sodbrennen"
  - AR "حرقة المعدة"
  - RU "изжога"
- **İşlem adları:** ERCP, ESD ve POEM ayrı uzmanlık olarak **önerilmez.** Bunlar gastroenterolojinin işlemleridir; ilgili konularda yalnızca eş anlamlı olarak aranabilir.

## Uzmanlıklar (canlıda 14)

| Kısaltma | slug | Ad | Sihirbazda |
|---|---|---|---|
| GAS | `gastroenterology` | Gastroenteroloji | önerilir |
| OBE | `obesity-and-metabolic-surgery` | Obezite ve Metabolik Cerrahi | önerilir |
| ONC | `surgical-oncology` | Cerrahi Onkoloji | önerilir |
| IVF | `ivf-and-reproductive-health` | Tüp Bebek ve Üreme Sağlığı | önerilir |
| PLA | `plastic-and-aesthetic-surgery` | Plastik ve Estetik Cerrahi | önerilir |
| ORT | `orthodontist` | Ortodonti | önerilir |
| IR | `interventional-radiology-specialist` | Girişimsel Radyoloji | önerilir |
| DEN | `dentalcare` | Diş Sağlığı | hekim atanınca |
| HAIR | `hair-transplantation` | Saç Ekimi | hekim atanınca |
| THO | `thoracic-surgery` | Göğüs Cerrahisi | hekim atanınca |
| NEU | `neurosurgery` | Beyin ve Sinir Cerrahisi | hekim atanınca |
| — | `ercp`, `esd`, `poem` | İşlem sayfaları | **önerilmez**; konular GAS'a bağlıdır |

"Sihirbazda" sütunu bilgi amaçlıdır. Gerçek durum, öneri anında yayındaki aktif hekim sayısından hesaplanır.

⚠️ **Sitede olmayan dallar:**
- üroloji, kadın hastalıkları ve doğum (genel), ortopedi
- kardiyoloji, dahiliye / check-up, nöroloji
- KBB, dermatoloji, psikiyatri, genel cerrahi

Bu dallardaki konular KOORD olarak işaretlidir.

---

## 1. Baş — `head`

| # | slug | EN | TR | Eşleme (ağırlık) | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 1 | `headache-migraine` | Headache / migraine | Baş ağrısı / migren | **KOORD** | başım ağrıyor, migren, yarım baş ağrısı / migraine, recurring headache | Karar: hiçbir uzmanlığa bağlanmaz. **Ani ve şiddetli** baş ağrısı kırmızı bayrak (K5). |
| 2 | `brain-tumor-suspicion` | Brain tumour (suspected/diagnosed) | Beyin tümörü şüphesi | NEU 100 · ONC 30 | beyinde kitle, MR'da kitle / brain mass, brain lesion | |
| 3 | `pituitary-tumor` | Pituitary tumour | Hipofiz tümörü | NEU 100 | hipofiz adenomu / pituitary adenoma | |
| 4 | `hydrocephalus` | Hydrocephalus | Hidrosefali | NEU 100 | beyinde su toplanması / water on the brain | |
| 5 | `trigeminal-neuralgia` | Facial nerve pain | Yüz siniri ağrısı (trigeminal nevralji) | NEU 80 | yüzde elektrik çarpması gibi ağrı / trigeminal neuralgia | |
| 6 | `head-injury-followup` | Follow-up after head injury | Kafa travması sonrası kontrol | NEU 80 | düşme sonrası baş, kafa darbesi / head trauma follow-up | Akut bilinç kaybı K4'e gider. |
| 7 | `hair-loss` | Hair loss | Saç dökülmesi | HAIR 100 · PLA 20 | saç seyrelmesi, kellik, saç ekimi / balding, hair transplant | |
| 8 | `beard-eyebrow-transplant` | Beard / eyebrow transplant | Sakal / kaş ekimi | HAIR 100 | sakal ekimi, kaş ekimi / beard implant | |

## 2. Boyun ve omurga — `neck-spine`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 9 | `neck-pain` | Neck pain | Boyun ağrısı | NEU 70 | boynum ağrıyor, boyun tutulması / stiff neck | NEU ikincil kalır (karar). |
| 10 | `cervical-disc-herniation` | Neck disc herniation | Boyun fıtığı | NEU 100 | boyun fıtığı, servikal disk / cervical hernia | |
| 11 | `lumbar-disc-herniation` | Lower back disc herniation | Bel fıtığı | NEU 100 | bel fıtığı, disk kayması / slipped disc, herniated disc | |
| 12 | `low-back-pain` | Lower back pain | Bel ağrısı | NEU 70 | belim ağrıyor, lumbago / backache | NEU ikincil kalır (karar). |
| 13 | `sciatica` | Sciatica | Siyatik (bacağa vuran ağrı) | NEU 90 | siyatik, bacağıma vuruyor / leg pain from back | |
| 14 | `spinal-stenosis` | Spinal stenosis | Kanal darlığı | NEU 100 | omurilik kanal darlığı / narrow spinal canal | |
| 15 | `spine-slippage-scoliosis` | Spondylolisthesis / scoliosis | Bel kayması / skolyoz | NEU 70 | omurga eğriliği, bel kayması / curved spine | |
| 16 | `hand-numbness-carpal-tunnel` | Hand numbness / carpal tunnel | Elde uyuşma / karpal tünel | NEU 70 · PLA 30 | elim uyuşuyor, bilekte sinir sıkışması / numb fingers | |
| 17 | `thyroid-nodule` | Thyroid nodule / goitre | Tiroid nodülü / guatr | ONC 50 · IR 50 | guatr, boyunda şişlik, tiroid biyopsisi, nodül ablasyonu / goiter, thyroid lump, thyroid ablation | Karar: ONC 50 · IR 50. |

## 3. Göğüs — `chest`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 18 | `lung-nodule` | Lung nodule | Akciğerde nodül | THO 100 · ONC 40 | akciğerde leke, tomografide nodül / spot on the lung | |
| 19 | `lung-cancer` | Lung cancer | Akciğer kanseri | THO 100 · ONC 60 | akciğer tümörü / lung tumour | |
| 20 | `chest-wall-deformity` | Chest wall deformity | Göğüs duvarı şekil bozukluğu | THO 100 · PLA 30 | kunduracı göğsü, güvercin göğsü / pectus excavatum, pectus carinatum | |
| 21 | `pleural-effusion` | Fluid around the lung | Akciğer zarında sıvı | THO 90 | akciğerde su toplanması / pleural effusion | |
| 22 | `pneumothorax` | Collapsed lung (recurrent) | Akciğer sönmesi (tekrarlayan) | THO 100 | pnömotoraks / pneumothorax | Akut nefes darlığı K1'e gider. |
| 23 | `hyperhidrosis` | Excessive sweating | Aşırı terleme | THO 90 | el terlemesi, koltuk altı terlemesi / sweaty hands | |
| 24 | `mediastinal-mass` | Mediastinal mass | Göğüs ortasında kitle (mediasten) | THO 100 · ONC 40 | timoma / thymoma | |
| 25 | `chronic-cough` | Long-lasting cough | Uzun süren öksürük | THO 40 · GAS 40 | geçmeyen öksürük / persistent cough | Göğüs hastalıkları yok; reflü kaynaklı olabilir. |
| 26 | `swallowing-difficulty` | Difficulty swallowing | Yutma güçlüğü | GAS 100 | yutkunamıyorum, lokma takılıyor, POEM / dysphagia | |
| 27 | `achalasia` | Achalasia | Akalazya | GAS 100 | yemek borusu kasılmaması, POEM / achalasia cardia, peroral endoscopic myotomy | POEM eş anlamlı. |
| 28 | `esophageal-cancer` | Oesophageal cancer | Yemek borusu kanseri | ONC 80 · GAS 60 · THO 50 | özofagus kanseri, ESD / esophageal tumour | |

## 4. Karın ve sindirim — `abdomen`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 29 | `reflux-heartburn` | Reflux / heartburn | Reflü / mide yanması | GAS 100 · OBE 40 | mide yanması, ağza acı su gelmesi / acid reflux, GERD | |
| 30 | `hiatal-hernia` | Hiatal hernia | Mide fıtığı | GAS 80 · OBE 70 | hiatal herni, mide fıtığı / hiatus hernia | |
| 31 | `indigestion-stomach-pain` | Indigestion / stomach pain | Hazımsızlık / mide ağrısı | GAS 100 | midem ağrıyor, dispepsi / dyspepsia | Ani şiddetli karın ağrısı K7'ye gider. |
| 32 | `gastritis-ulcer` | Gastritis / ulcer | Gastrit / ülser | GAS 100 | mide ülseri, H. pylori / stomach ulcer | |
| 33 | `bloating-ibs` | Bloating / IBS | Şişkinlik / huzursuz bağırsak | GAS 100 | gaz, spastik kolon / irritable bowel | |
| 34 | `constipation` | Constipation | Kabızlık | GAS 100 | tuvalete çıkamıyorum / constipated | |
| 35 | `chronic-diarrhea` | Chronic diarrhoea | Uzun süren ishal | GAS 100 | geçmeyen ishal, Crohn, ülseratif kolit / IBD | |
| 36 | `blood-in-stool` | Blood in stool | Dışkıda kan | GAS 100 · ONC 30 | makattan kan, kanlı dışkı / rectal bleeding | Şiddetli kanama K3'e gider. |
| 37 | `hemorrhoids-fissure` | Haemorrhoids / anal fissure | Hemoroid / anal fissür | GAS 50 | basur, makat çatlağı / piles | Genel cerrahi yok. |
| 38 | `colonoscopy-screening` | Colonoscopy / endoscopy | Kolonoskopi / endoskopi | GAS 100 | bağırsak kamerası / colon check | |
| 39 | `colon-polyp` | Colon / stomach polyp | Bağırsak / mide polipi | GAS 100 | polip, ESD / polyp removal | |
| 40 | `early-gi-cancer` | Early GI tumour (endoscopic removal) | Erken evre mide/bağırsak tümörü (endoskopik çıkarım) | GAS 100 · ONC 30 | ameliyatsız tümör çıkarma, ESD / endoscopic submucosal dissection | ESD eş anlamlı. |
| 41 | `stomach-cancer` | Stomach cancer | Mide kanseri | ONC 100 · GAS 50 | mide tümörü / gastric cancer | |
| 42 | `colorectal-cancer` | Colon / rectal cancer | Kolon / rektum kanseri | ONC 100 · GAS 50 | bağırsak kanseri / bowel cancer | |
| 43 | `gallstones` | Gallstones | Safra kesesi taşı | GAS 70 | safra taşı, ERCP / gallbladder stones | Kolesistektomi genel cerrahi (yok). |
| 44 | `bile-duct-stones-jaundice` | Bile duct stones / jaundice | Safra yolu taşı / sarılık | GAS 100 | koledok taşı, gözlerde sararma, ERCP / jaundice | ERCP eş anlamlı. |
| 45 | `pancreatitis-pancreatic-cyst` | Pancreatitis / pancreatic cyst | Pankreatit / pankreas kisti | GAS 90 · ONC 30 | pankreas iltihabı, ERCP / pancreas cyst | |
| 46 | `pancreatic-cancer` | Pancreatic cancer | Pankreas kanseri | ONC 100 · GAS 60 | pankreas tümörü / pancreatic tumour | |
| 47 | `fatty-liver-liver-enzymes` | Fatty liver / high liver tests | Karaciğer yağlanması / yüksek karaciğer değerleri | GAS 100 · OBE 30 | karaciğer yağlanması, ALT yüksek / fatty liver | |
| 48 | `liver-tumor` | Liver tumour | Karaciğer tümörü | ONC 100 · IR 60 · GAS 40 | karaciğerde kitle, tümör ablasyonu / liver mass, liver ablation | IR = ablasyon. |
| 49 | `abdominal-hernia` | Abdominal / inguinal hernia | Karın / kasık fıtığı | OBE 80 · PLA 30 | kasık fıtığı, göbek fıtığı / inguinal hernia | Karar: OBE 80 · PLA 30. |
| 50 | `obesity` | Obesity / weight loss | Obezite / kilo verme | OBE 100 | aşırı kilo, tüp mide, mide küçültme / gastric sleeve | |
| 51 | `type2-diabetes-metabolic` | Type 2 diabetes (metabolic surgery) | Tip 2 diyabet (metabolik cerrahi) | OBE 100 · GAS 20 | şeker hastalığı ameliyatı / diabetes surgery | |
| 52 | `bariatric-revision` | Revision after weight-loss surgery | Obezite ameliyatı sonrası revizyon | OBE 100 | tekrar kilo alma, tüp mide sonrası reflü / revision surgery | |
| 53 | `gastric-balloon` | Gastric balloon / endoscopic options | Mide balonu / endoskopik yöntemler | OBE 80 · GAS 50 | mide balonu, mide botoksu / intragastric balloon | |

## 5. Pelvis ve üroloji — `pelvis-urology`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 54 | `kidney-stone` | Kidney stone | Böbrek taşı | **KOORD** | böbrek taşı, sancı / renal colic | Üroloji yok. |
| 55 | `prostate` | Prostate enlargement | Prostat büyümesi | IR 70 | prostat, sık idrara çıkma, prostat arter embolizasyonu / BPH, prostate artery embolisation | Karar: IR (PAE). Üroloji yok. |
| 56 | `urinary-incontinence` | Urinary incontinence | İdrar kaçırma | **KOORD** | idrar tutamama / bladder leakage | |
| 57 | `male-infertility` | Male infertility | Erkek kısırlığı | IVF 100 | sperm sayısı düşük / low sperm count | |

## 6. Kadın sağlığı — `women`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 58 | `infertility` | Infertility | Kısırlık / çocuk sahibi olamama | IVF 100 | bebek olmuyor, infertilite / trying to conceive | |
| 59 | `ivf` | IVF treatment | Tüp bebek tedavisi | IVF 100 | tüp bebek, aşılama / in vitro fertilisation | |
| 60 | `egg-freezing` | Egg freezing | Yumurta dondurma | IVF 100 | yumurta saklama / oocyte freezing | |
| 61 | `recurrent-miscarriage` | Recurrent miscarriage | Tekrarlayan düşük | IVF 90 | düşük yapma / pregnancy loss | |
| 62 | `pcos` | PCOS | Polikistik over | IVF 80 · OBE 30 | yumurtalıkta kist, adet düzensizliği / polycystic ovaries | |
| 63 | `endometriosis` | Endometriosis | Endometriozis | IVF 70 | çikolata kisti / endometrioma | |
| 64 | `uterine-fibroids` | Uterine fibroids | Rahim miyomu | ONC 70 · IR 50 · IVF 30 | miyom, miyom embolizasyonu / fibroid, uterine fibroid embolisation | Karar: ONC 70 · IR 50 · IVF 30. |
| 65 | `ovarian-cyst` | Ovarian cyst | Yumurtalık kisti | IVF 50 · ONC 30 | over kisti / ovary cyst | |
| 66 | `breast-lump` | Breast lump | Memede kitle | ONC 100 · PLA 20 | memede sertlik, meme kisti / lump in breast | |
| 67 | `breast-cancer` | Breast cancer | Meme kanseri | ONC 100 · PLA 40 | meme tümörü / breast tumour | PLA = rekonstrüksiyon. |
| 68 | `breast-aesthetics` | Breast aesthetics | Meme estetiği | PLA 100 | meme büyütme, küçültme, dikleştirme / breast augmentation, lift | |

## 7. Cilt ve estetik — `skin-aesthetic`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 69 | `rhinoplasty` | Nose aesthetics | Burun estetiği | PLA 100 | rinoplasti, burun ameliyatı / nose job | |
| 70 | `fillers-botox` | Fillers / botox | Dolgu / botoks | PLA 100 | dudak dolgusu, kırışıklık / lip filler, anti-wrinkle | |
| 71 | `facelift` | Face and neck lift | Yüz / boyun germe | PLA 100 | yüz germe, sarkma / facelift | |
| 72 | `eyelid-surgery` | Eyelid surgery | Göz kapağı estetiği | PLA 100 | blefaroplasti, göz altı torbası / blepharoplasty | |
| 73 | `liposuction-body-contouring` | Liposuction / body contouring | Liposuction / vücut şekillendirme | PLA 100 · OBE 20 | yağ aldırma, lipo / lipo | |
| 74 | `tummy-tuck` | Tummy tuck | Karın germe | PLA 100 | abdominoplasti, karında sarkma / abdominoplasty | |
| 75 | `post-weight-loss-contouring` | Skin removal after weight loss | Kilo kaybı sonrası sarkma | PLA 100 · OBE 30 | kol germe, uyluk germe / arm lift | |
| 76 | `gynecomastia` | Gynaecomastia | Jinekomasti (erkekte meme büyümesi) | PLA 100 | erkek memesi / man boobs | |
| 77 | `scar-revision` | Scar revision | Yara izi düzeltme | PLA 90 | iz, keloid / scar treatment | |
| 78 | `skin-lesion-mole` | Mole / skin lesion | Ben / cilt lezyonu | PLA 40 · ONC 40 | ben aldırma, şüpheli ben / mole removal | Dermatoloji yok. |

## 8. Ağız ve diş — `dental`

Diş sağlığı konuları **yalnızca `dentalcare`**'e bağlanır, ortodontiye bağlanmaz (karar). Ortodonti konuları (#84a–84c) **yalnızca `orthodontist`**'e bağlanır.

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 79 | `toothache` | Toothache / cavity | Diş ağrısı / çürük | DEN 100 | dişim ağrıyor, diş çürüğü / tooth pain, cavity | |
| 80 | `dental-abscess` | Dental abscess | Diş apsesi | DEN 100 | diş iltihabı, yüzde şişlik / tooth infection | Yüzde/boyunda hızla yayılan şişlik ve nefes güçlüğü K1/K8'e gider. |
| 81 | `gum-recession` | Gum recession / gum disease | Diş eti çekilmesi / diş eti hastalığı | DEN 100 | diş eti kanaması, periodontit / gum disease | |
| 82 | `dental-implant` | Dental implant | İmplant | DEN 100 | diş eksikliği, vidalı diş / tooth implant | |
| 83 | `smile-design` | Smile design / veneers | Gülüş tasarımı / kaplama | DEN 100 | zirkonyum, lamina / veneers, Hollywood smile | |
| 84 | `teeth-whitening` | Teeth whitening | Diş beyazlatma | DEN 100 | beyazlatma / bleaching | |
| 84a | `braces-crooked-teeth` | Braces / crooked teeth | Diş teli / çapraşık diş | ORT 100 | diş teli, braket, çapraşıklık / braces, crowded teeth | |
| 84b | `clear-aligners` | Clear aligners | Şeffaf plak | ORT 100 | şeffaf plak, görünmez tel / aligners, invisible braces | |
| 84c | `bite-problems` | Bite / jaw alignment problems | Çene-diş kapanış bozukluğu | ORT 100 | kapanış bozukluğu, alt çene önde, derin kapanış / overbite, underbite, malocclusion | |
| 86 | `root-canal` | Root canal treatment | Kanal tedavisi | DEN 100 | kanal / endodontics | |

(#85 "ortodonti" konusu #84a–84c olarak üçe bölündü.)

## 9. Eklem, kemik ve damar — `joints-bones`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 87 | `knee-pain` | Knee pain | Diz ağrısı | **KOORD** | menisküs, diz kireçlenmesi / knee arthritis | Ortopedi yok. |
| 88 | `hip-shoulder-pain` | Hip / shoulder pain | Kalça / omuz ağrısı | **KOORD** | kalça protezi, donuk omuz / hip replacement | Ortopedi yok. |
| 88a | `varicose-veins` | Varicose veins / venous insufficiency | Varis / toplardamar yetmezliği | IR 100 | varis, bacakta damar, venöz yetmezlik / varicose veins, venous ablation | Yeni (IR). Bacakta ani şişlik ve ağrı ile nefes darlığı K1'e gider. |

## 10. Genel kontrol — `general-checkup`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 89 | `general-checkup` | General check-up | Check-up | **KOORD** | genel sağlık kontrolü / health check | Dahiliye yok. |
| 90 | `longevity` | Longevity / healthy ageing | Sağlıklı yaşlanma (longevity) | **KOORD** | yaşlanma karşıtı, uzun yaşam / healthy aging | |
| 91 | `second-opinion` | Second opinion | İkinci görüş | **KOORD** | başka doktor görüşü / medical second opinion | Başka bir konu da seçilirse o konunun eşlemesi geçerli olur. |

## 11. Kanser — `cancer`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 92 | `cancer-screening` | Cancer screening | Kanser taraması | GAS 50 · ONC 50 | kanser kontrolü / cancer check | |
| 93 | `cancer-surgery-opinion` | Cancer surgery / second opinion | Kanser ameliyatı / ikinci görüş | ONC 100 | tümör ameliyatı / tumour surgery | |
| 94 | `soft-tissue-lump` | Lump under the skin | Deri altında kitle / şişlik | ONC 70 · PLA 30 | yumru, lipom / lipoma, lump | |
| 95 | `swollen-lymph-nodes` | Swollen lymph nodes | Lenf bezi büyümesi | ONC 50 | boyunda bez, lenf nodu / swollen glands | |

## 12. Ruh sağlığı — `mental-wellbeing`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 96 | `stress-anxiety` | Stress / anxiety | Stres / kaygı | **KOORD** | panik atak, depresyon / panic attacks, low mood | İntihar düşüncesi K6'ya gider. |
| 97 | `sleep-problems` | Sleep problems | Uyku sorunları | **KOORD** | uykusuzluk, horlama / insomnia, snoring | |

## 13. Diğer — `other`

| # | slug | EN | TR | Eşleme | Örnek eş anlamlılar (TR / EN) | Not |
|---|---|---|---|---|---|---|
| 98 | `dialysis-access` | Dialysis fistula / access problems | Diyaliz fistülü sorunları | IR 100 | fistül tıkanması, diyaliz damar yolu / AV fistula, dialysis access | Yeni (IR). |
| 99 | `something-else` | Something else | Başka bir konu | **KOORD** | — | Serbest metinle birlikte kullanılır. |

---

## Kırmızı bayrak konuları (`isRedFlag = true`, uzmanlığa eşlenmez)

| # | slug | EN | TR | Serbest metinde tetikleyen örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|
| K1 | `rf-chest-pain-breathless` | Chest pain with shortness of breath | Göğüs ağrısı ve nefes darlığı | göğsüm sıkışıyor, nefes alamıyorum, kalp krizi / crushing chest pain, can't breathe, heart attack |
| K2 | `rf-stroke-signs` | Stroke signs (face drooping, speech difficulty, arm weakness) | İnme belirtileri (yüzde kayma, konuşma bozukluğu, kolda güçsüzlük) | felç, ağız kayması, dil dolanması, kolum tutmuyor / face drooping, slurred speech, stroke |
| K3 | `rf-severe-bleeding` | Severe bleeding | Şiddetli kanama | durmayan kanama, kan kusma / heavy bleeding, vomiting blood |
| K4 | `rf-loss-of-consciousness` | Loss of consciousness | Bilinç kaybı | bayıldı, kendinden geçti / fainted, passed out, unconscious |
| K5 | `rf-thunderclap-headache` | Sudden severe headache | Ani şiddetli baş ağrısı | hayatımın en kötü baş ağrısı, aniden başlayan baş ağrısı / worst headache of my life |
| K6 | `rf-suicidal-thoughts` | Suicidal thoughts | İntihar düşüncesi | kendimi öldürmek, yaşamak istemiyorum / suicidal, want to die |
| K7 | `rf-acute-abdomen` | Sudden severe abdominal pain | Ani şiddetli karın ağrısı | karnım çok şiddetli ağrıyor, karın sertleşti / severe sudden belly pain |
| K8 | `rf-severe-allergy` | Severe allergic reaction | Ciddi alerjik reaksiyon | dilim şişti, boğazım kapanıyor / throat swelling, anaphylaxis |

**Acil numaraları (kullanıcının ülkesine göre vurgulanır):**

| Ülke / bölge | Numara |
|---|---|
| Türkiye | 112 |
| AB ülkeleri | 112 |
| ABD / Kanada | 911 |
| Birleşik Krallık | 999 (112 de çalışır) |
| Diğer ülkeler | 112 gösterilir, "yerel acil numaranız" notuyla |

## Serbest metin kuralı

- Serbest metinde **kırmızı bayrak eş anlamlısı** geçerse acil ekranı açılır.
- Konu eş anlamlısı geçerse o konu "önerilen" olarak gösterilir; **otomatik seçilmez**, hasta onaylar.
- Eşleşme yoksa metin hiçbir konu eklemez. Rapora yalnızca anonim terim sıklığı düşer.

## Karar kaydı (2026-10-30, kullanıcı)

1. Canlıda 14 uzmanlık var. `orthodontist` ve `interventional-radiology-specialist` eklendi; ikisinde de aktif hekim var.
2. `ercp`, `poem` ve `esd` ayrı uzmanlık olarak önerilmez. İlgili konular GAS'a yüksek ağırlıkla bağlandı; işlem adları eş anlamlı olarak kalıyor.
3. Hekimi olmayan uzmanlık önerilmez. Kural kodda; ağırlıklar tabloda kalıyor.
4. Diş sağlığı konuları `dentalcare`'e, ortodonti konuları `orthodontist`'e bağlı; ikisi karışmaz.
5. #17 tiroid: ONC 50 · IR 50. #49 fıtık: OBE 80 · PLA 30. #64 miyom: ONC 70 · IR 50 · IVF 30.
6. Boyun ve bel ağrısında NEU ikincil kalıyor. Baş ağrısı KOORD.
7. K7 ve K8 kırmızı bayrak olarak eklendi.
8. Eşik 40; en çok 2 uzmanlık önerisi.
