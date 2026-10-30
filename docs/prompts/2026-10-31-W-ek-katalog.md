# Paket W-ek — Genişletilmiş eşleştirme kataloğu (hekim kontrolü için)

> **Durum: ONAYLANDI (2026-10-31), aşağıdaki düzeltmelerle uygulandı.** Ayrıntılar: `2026-10-31-W-ek-RAPOR.md` §2. Sihirbaz **tanı koymaz**; katalog yalnızca "hangi uzmanlık / koordinatör" sorusunu yanıtlar.
>
> **Onay sonrası düzeltmeler** (aşağıdaki tablo onay öncesi hâlidir; kodda bunlar geçerlidir):
> - `rf-poisoning`, `rf-loss-of-consciousness` ve `rf-sudden-vision-loss` tetikleyicileri daraltıldı: "ilaç içti", tek başına "bayıldı/bayıldım" ve "gözüm karardı" çıkarıldı.
> - Kırmızı bayrak terimleri, başka konuların eş anlamlılarıyla hiçbir dilde çakışmaz; bunu bir test denetler.
> - `adenomyosis`: IR 40 · IVF 30 · **ONC 40**.
> - `leg-pain-cramps` ("Bacak ağrısı / kramp") koordinatöre gider; ipucu "Kardiyoloji / Damar cerrahisi".
> - Yeni konu `claudication` ("Yürürken bacak ağrısı"): IR 40.
> - Öneri kırmızı bayraklar eklendi: `rf-sudden-testicular-pain`, `rf-infant-fever`.
> - Sonuç: **332 kayıt = 314 konu + 18 kırmızı bayrak**; 143 konu koordinatöre gider.

## Özet

- **Toplam 329 kayıt:** 313 konu + 16 kırmızı bayrak.
  - Mevcut: 110 (102 konu + 8 kırmızı bayrak).
  - Yeni: **219** (211 konu + 8 kırmızı bayrak).
  - Ek olarak **2 kırmızı bayrak önerisi** onaya bağlı (aşağıda).
- **Koordinatöre giden konu (ağırlık yok, `targetSpecialtyHint` dolu): 142.**
- Ayrıca **43 konu** yalnızca bugün hekimi olmayan uzmanlıklara bağlı (DEN / HAIR / THO / NEU). Kural gereği bunlar da şu an koordinatöre düşer; hekim atanınca kendiliğinden devreye girer.
- **Yeni bölgeler (6):**
  - Genel belirtiler
  - Kulak-burun-boğaz
  - Göz
  - Kalp ve damar
  - Hormon ve metabolizma
  - Çocuk
- **Bölge değişikliği:** `varicose-veins` "Eklem, kemik ve damar" bölgesinden "Kalp ve damar"a taşındı. "Baş" bölgesi "Baş ve sinir sistemi" olarak adlandırıldı. Var olan kayıtlar seed'de yalnızca `--update-existing` ile ve değişmemişlerse güncellenir.

## Kurallar

- **Uzmanlık kısaltmaları** (canlıdaki slug'lar):

  | Kısaltma | Slug |
  |---|---|
  | GAS | `gastroenterology` |
  | OBE | `obesity-and-metabolic-surgery` |
  | ONC | `surgical-oncology` |
  | IR | `interventional-radiology-specialist` |
  | IVF | `ivf-and-reproductive-health` |
  | PLA | `plastic-and-aesthetic-surgery` |
  | ORT | `orthodontist` |
  | DEN | `dentalcare` |
  | HAIR | `hair-transplantation` |
  | THO | `thoracic-surgery` |
  | NEU | `neurosurgery` |

  `ercp`, `esd` ve `poem` önerilmez (önceki karar).
- **Ağırlıksız konular:** Bizde uygun uzmanlık yoksa **ağırlık verilmez**. Konu koordinatöre gider; `targetSpecialtyHint` yalnızca admin ve raporlar içindir, hasta görmez.
- **Zorlama eşleme yok.** Örnek: baş dönmesi → Beyin Cerrahisi **değil**. Ağırlık yalnızca uzmanlığın gerçekten yaptığı işlerde verildi:
  - IR: varikosel, aort/karotis, tümör yakma
  - NEU: sinir sıkışması, Chiari, Parkinson cerrahisi değerlendirmesi
  - PLA: genital estetik, lenfödem, iyileşmeyen yara
- **Eşik ve öneri sayısı** ayardan gelir (varsayılan 40 / 2). Eşik altındaki ağırlıklar ikincil bilgi niteliğindedir.
- **Eş anlamlılar:** Tabloda TR/EN örnekleri var. Seed'de her konu için **9 dilde 8–15 eş anlamlı** yazılacak: halk ağzı, yazım hataları ve aksansız yazımlar dahil ("bas donmesi", "basim donuyor", "dizziness", "Schwindel", "головокружение", "دوخة" gibi).
- **Kırmızı bayrak tetikleyicileri** serbest metinde de aranır ("göğsüm sıkışıyor", "nefes alamıyorum" gibi).

## Bölge bazında sayılar

| Bölge | slug | Yeni bölge | Konu | Kırmızı bayrak | Yeni kayıt | Koordinatöre giden | Yalnızca hekimsiz uzmanlık |
|---|---|---|---|---|---|---|---|
| Genel belirtiler | `general-symptoms` | evet | 14 | 0 | 14 | 14 | 0 |
| Baş ve sinir sistemi | `head` |  | 21 | 4 | 14 | 9 | 8 |
| Kulak-burun-boğaz | `ent` | evet | 12 | 0 | 12 | 10 | 0 |
| Göz | `eyes` | evet | 8 | 1 | 9 | 7 | 0 |
| Boyun ve omurga | `neck-spine` |  | 14 | 0 | 5 | 1 | 10 |
| Göğüs ve akciğer | `chest` |  | 19 | 2 | 9 | 5 | 6 |
| Kalp ve damar | `heart-vessels` | evet | 17 | 0 | 16 | 10 | 0 |
| Mide ve sindirim | `abdomen` |  | 38 | 2 | 14 | 0 | 0 |
| Hormon ve metabolizma | `hormones-metabolism` | evet | 8 | 0 | 8 | 8 | 0 |
| Pelvis ve üroloji | `pelvis-urology` |  | 16 | 0 | 12 | 9 | 0 |
| Kadın sağlığı | `women` |  | 24 | 1 | 14 | 9 | 0 |
| Cilt ve estetik | `skin-aesthetic` |  | 35 | 0 | 25 | 8 | 2 |
| Ağız ve diş | `dental` |  | 20 | 0 | 10 | 0 | 17 |
| Eklem, kemik ve kas | `joints-bones` |  | 14 | 0 | 12 | 12 | 0 |
| Genel kontrol | `general-checkup` |  | 9 | 0 | 6 | 9 | 0 |
| Kanser (tanı aldım / ikinci görüş) | `cancer` |  | 14 | 0 | 10 | 2 | 0 |
| Ruh sağlığı | `mental-wellbeing` |  | 10 | 1 | 8 | 10 | 0 |
| Çocuk (şimdilik koordinatör; veli kuralı) | `children` | evet | 14 | 1 | 15 | 14 | 0 |
| Diğer | `other` |  | 6 | 4 | 6 | 5 | 0 |
| **Toplam** | | | **313** | **16** | **219** | **142** | **43** |

## Yeni kırmızı bayraklar (8)

| slug | EN | TR | Örnek tetikleyiciler (TR / EN) |
|---|---|---|---|
| `rf-fainting-chest-pain` | Fainting with chest pain | Bayılma ile göğüs ağrısı | bayıldı göğsü ağrıyordu; göğüs ağrısı sonra bayılma / fainted with chest pain; collapsed chest pain |
| `rf-fever-stiff-neck` | High fever with stiff neck | Yüksek ateş ile ense sertliği | ense sertliği; boynum kaskatı ve ateş; menenjit / stiff neck and high fever; meningitis |
| `rf-pregnancy-bleeding-pain` | Bleeding or severe pain in pregnancy | Gebelikte kanama / şiddetli ağrı | hamileyim kanama; gebelikte kanama; hamilelikte şiddetli karın ağrısı / bleeding in pregnancy; severe pain while pregnant |
| `rf-sudden-vision-loss` | Sudden loss of vision | Ani görme kaybı | aniden göremiyorum; ani görme kaybı; gözüm karardı / sudden vision loss; suddenly can't see |
| `rf-coffee-ground-vomit` | Vomiting blood / coffee-ground vomit | Kahve telvesi gibi kusma / kan kusma | kahve telvesi kusma; siyah kusma; kan kustum / coffee ground vomit; vomiting blood |
| `rf-child-breathing` | Child with breathing difficulty | Çocukta nefes güçlüğü | çocuğum nefes alamıyor; bebek morardı; hırıltılı nefes çocuk / child can't breathe; baby turning blue |
| `rf-severe-burn` | Severe burn | Ağır yanık | ağır yanık; büyük yanık; kaynar su döküldü / severe burn; large burn |
| `rf-poisoning` | Poisoning | Zehirlenme | zehirlendi; ilaç içti; çamaşır suyu içti; mantar zehirlenmesi / poisoning; swallowed pills; overdose |

**Öneri — onaylarsanız eklenir:**

| slug | EN | TR | Örnek tetikleyiciler (TR / EN) |
|---|---|---|---|
| `rf-sudden-testicular-pain` | Sudden severe testicle pain | Ani şiddetli testis ağrısı | testisim aniden çok ağrıyor; torsiyon / sudden testicle pain; testicular torsion |
| `rf-infant-fever` | Fever in a baby under 3 months | 3 aydan küçük bebekte ateş | bebeğim 2 aylık ateşi var; yenidoğan ateş / fever in newborn; baby under 3 months fever |

Not: "Kahve telvesi gibi kusma" mevcut "Şiddetli kanama" (K3) ile örtüşür; ayrı konu olarak hem seçilebilir hem de serbest metinde tetiklenir.

## Kontrol edilmesini istediğim noktalar

1. Yeni 6 bölge ve "Baş ve sinir sistemi" adı uygun mu?
2. Kısmi ağırlıklar için hekim teyidi gerekiyor:
   - `parkinsons-disease` NEU 40 (yalnızca cerrahi/DBS değerlendirmesi)
   - `throat-lump` GAS 40 (reflü kaynaklı olabilir)
   - `leg-pain-cramps` IR 40
   - `dvt-history` IR 40
   - `adenomyosis` IR 40 · IVF 30
   - `hand-wrist` PLA 40
   - `chronic-wound` PLA 50
   - `skin-laser-rejuvenation` PLA 50
   - `bad-breath` DEN 60
   - `cancer-follow-up` ONC 60
3. Çocuk konuları (14) şimdilik tamamen koordinatöre gidiyor; 18 yaş altı veli kuralı geçerli. Çocuk diş konusu da koordinatörde (DEN'e bağlanmadı). Uygun mu?
4. 2 öneri kırmızı bayrak (ani testis ağrısı, 3 aydan küçük bebekte ateş) eklensin mi?

## Genel belirtiler — `general-symptoms` (YENİ BÖLGE)

Konu: **14** · kırmızı bayrak: 0 · yeni: 14 · koordinatöre giden: 14

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `allergy-hay-fever` | Allergy / hay fever | Alerji / saman nezlesi | **KOORD** | Alerji / KBB | YENİ | alerji; saman nezlesi; bahar alerjisi; polen alerjisi / allergy; hay fever; pollen allergy; allergic rhinitis |
| 2 | `anemia` | Anaemia | Kansızlık | **KOORD** | Hematoloji / İç Hastalıkları | YENİ | kansızlık; kansizlik; demir eksikliği; anemi; hemoglobin düşük / anaemia; anemia; iron deficiency; low haemoglobin |
| 3 | `chronic-pain` | Chronic pain | Kronik ağrı | **KOORD** | Algoloji | YENİ | kronik ağrı; kronik agri; geçmeyen ağrı; ağrı kesici işe yaramıyor / chronic pain; persistent pain; pain management |
| 4 | `dizziness-vertigo` | Dizziness / vertigo | Baş dönmesi / vertigo | **KOORD** | Nöroloji / KBB | YENİ | baş dönmesi; bas donmesi; başım dönüyor; basim donuyor; sersemlik / dizziness; vertigo; feeling dizzy; dizzy spells |
| 5 | `excessive-thirst` | Excessive thirst / dry mouth | Aşırı susama / ağız kuruluğu | **KOORD** | Endokrinoloji | YENİ | çok su içiyorum; aşırı susama; asiri susama; ağız kuruluğu / excessive thirst; always thirsty; dry mouth |
| 6 | `fainting-episodes` | Fainting episodes (recurring, recovered) | Tekrarlayan bayılma (geçmiş) | **KOORD** | Kardiyoloji / Nöroloji | YENİ | bayılma; bayiliyorum; senkop; gözüm kararıyor / fainting; syncope; blackouts; passing out (recovered) |
| 7 | `fatigue-weakness` | Fatigue / weakness | Yorgunluk / halsizlik | **KOORD** | İç Hastalıkları | YENİ | yorgunluk; halsizlik; halsizim; hep yorgunum; bitkinlik / fatigue; tiredness; always tired; weakness |
| 8 | `frequent-infections` | Frequent infections | Sık enfeksiyon | **KOORD** | İç Hastalıkları / İmmünoloji | YENİ | sık hastalanıyorum; bağışıklık düşük; sik hasta oluyorum / frequent infections; weak immune system; always getting sick |
| 9 | `hives-urticaria` | Hives / urticaria | Kurdeşen / ürtiker | **KOORD** | Dermatoloji / Alerji | YENİ | kurdeşen; kurdesen; ürtiker; kaşıntılı kabarıklık / hives; urticaria; itchy welts |
| 10 | `loss-of-appetite` | Loss of appetite | İştahsızlık | **KOORD** | İç Hastalıkları | YENİ | iştahsızlık; istahsizlik; canım bir şey yemek istemiyor; yemek yiyemiyorum / loss of appetite; no appetite; not hungry |
| 11 | `night-sweats` | Night sweats | Gece terlemesi | **KOORD** | İç Hastalıkları | YENİ | gece terlemesi; gece terliyorum; geceleri ter / night sweats; sweating at night |
| 12 | `prolonged-fever` | Long-lasting fever | Uzun süren ateş | **KOORD** | İç Hastalıkları / Enfeksiyon | YENİ | geçmeyen ateş; gecmeyen ates; ateşim düşmüyor; hafif ateş / prolonged fever; fever that won't go away; low-grade fever |
| 13 | `swelling-edema` | Swelling / oedema | Ödem / şişlik | **KOORD** | Kardiyoloji / Nefroloji | YENİ | ödem; odem; bacaklarım şişiyor; ayak şişmesi; vücutta şişlik / swelling; oedema; edema; swollen ankles |
| 14 | `unexplained-weight-loss` | Unexplained weight loss | Açıklanamayan kilo kaybı | **KOORD** | İç Hastalıkları | YENİ | nedensiz kilo kaybı; kilo veriyorum; zayıflıyorum; kilo kaybi / unexplained weight loss; losing weight without trying |

## Baş ve sinir sistemi — `head`

Konu: **21** · kırmızı bayrak: 4 · yeni: 14 · koordinatöre giden: 9

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `beard-eyebrow-transplant` | Beard / eyebrow transplant | Sakal / kaş ekimi | HAIR 100 | — | mevcut | sakal ekimi; kaş ekimi; bıyık ekimi; seyrek sakal / beard implant; beard transplant; eyebrow transplant |
| 2 | `brain-tumor-suspicion` | Brain tumour (suspected/diagnosed) | Beyin tümörü şüphesi | NEU 100 · ONC 30 | — | mevcut | beyinde kitle; mr'da kitle; beyin tümörü; beyinde lezyon / brain mass; brain lesion; brain tumor |
| 3 | `hair-loss` | Hair loss | Saç dökülmesi | HAIR 100 · PLA 20 | — | mevcut | saç seyrelmesi; kellik; saç ekimi; saçım dökülüyor / balding; hair transplant; thinning hair |
| 4 | `head-injury-followup` | Follow-up after head injury | Kafa travması sonrası kontrol | NEU 80 | Nöroloji | mevcut | düşme sonrası baş; kafa darbesi; kafamı çarptım; kafa travması / head trauma follow-up; hit my head; head injury |
| 5 | `headache-migraine` | Headache / migraine | Baş ağrısı / migren | **KOORD** | Nöroloji | mevcut | başım ağrıyor; migren; yarım baş ağrısı; zonklayan baş ağrısı / migraine; recurring headache; my head hurts |
| 6 | `hydrocephalus` | Hydrocephalus | Hidrosefali | NEU 100 | — | mevcut | beyinde su toplanması; kafada su birikmesi; şant; vp şant / water on the brain; fluid on the brain; enlarged ventricles |
| 7 | `pituitary-tumor` | Pituitary tumour | Hipofiz tümörü | NEU 100 | — | mevcut | hipofiz adenomu; prolaktinoma; hipofizde kitle; makroadenom / pituitary adenoma; pituitary tumor; prolactinoma |
| 8 | `trigeminal-neuralgia` | Facial nerve pain | Yüz siniri ağrısı (trigeminal nevralji) | NEU 80 | Nöroloji | mevcut | yüzde elektrik çarpması gibi ağrı; trigeminal nevralji; yüz ağrısı; yüzde bıçak saplanır gibi ağrı / trigeminal neuralgia; electric shock pain in face; stabbing face pain |
| 9 | `brain-aneurysm` | Brain aneurysm (known, not acute) | Beyin anevrizması (bilinen) | NEU 90 · IR 50 | — | YENİ | beyin anevrizması; anevrizma; beyin damar balonu / brain aneurysm; cerebral aneurysm |
| 10 | `chiari-malformation` | Chiari malformation | Chiari malformasyonu | NEU 100 | — | YENİ | chiari; beyincik sarkması / Chiari malformation |
| 11 | `epilepsy-follow-up` | Epilepsy follow-up | Epilepsi takibi | **KOORD** | Nöroloji | YENİ | epilepsi; sara; nöbet geçiriyorum; havale / epilepsy; seizures follow-up; fits |
| 12 | `facial-paralysis` | Facial paralysis | Yüz felci | **KOORD** | Nöroloji / KBB | YENİ | yüz felci; yuz felci; bell felci; ağzım kaydı (eski) / facial palsy; Bell's palsy |
| 13 | `memory-problems` | Memory problems | Hafıza sorunları / unutkanlık | **KOORD** | Nöroloji | YENİ | unutkanlık; unutkanlik; hafıza kaybı; demans; alzheimer / memory problems; forgetfulness; dementia; Alzheimer's |
| 14 | `multiple-sclerosis` | Multiple sclerosis | MS (multipl skleroz) | **KOORD** | Nöroloji | YENİ | ms hastalığı; multipl skleroz; ms / multiple sclerosis; MS |
| 15 | `nerve-entrapment` | Nerve entrapment (elbow/wrist) | Sinir sıkışması (dirsek/bilek) | NEU 70 | — | YENİ | sinir sıkışması; sinir sikismasi; dirsekte sinir; kübital tünel / nerve entrapment; cubital tunnel; pinched nerve |
| 16 | `neuropathy` | Neuropathy | Nöropati (sinir hasarı) | **KOORD** | Nöroloji | YENİ | nöropati; noropati; diyabetik nöropati; ayaklarda yanma / neuropathy; nerve damage; burning feet |
| 17 | `numbness-tingling` | Numbness / tingling | Uyuşma / karıncalanma | **KOORD** | Nöroloji | YENİ | uyuşma; uyusma; karıncalanma; karincalanma; elim ayağım uyuşuyor / numbness; tingling; pins and needles |
| 18 | `parkinsons-disease` | Parkinson's disease | Parkinson hastalığı | NEU 40 | Nöroloji | YENİ | parkinson; parkinsonda titreme; beyin pili / Parkinson's; Parkinson disease; deep brain stimulation |
| 19 | `spinal-cord-tumor` | Spinal cord tumour | Omurilik tümörü | NEU 100 · ONC 30 | — | YENİ | omurilik tümörü; omurga tümörü / spinal cord tumour; spine tumor |
| 20 | `stroke-follow-up` | After a stroke (rehab / follow-up) | İnme sonrası takip / rehabilitasyon | **KOORD** | Nöroloji / FTR | YENİ | felç sonrası; inme sonrası; felc gecirdim / stroke rehabilitation; after stroke follow-up |
| 21 | `tremor` | Tremor | Titreme | **KOORD** | Nöroloji | YENİ | titreme; ellerim titriyor; el titremesi / tremor; shaking hands; trembling |
| 22 | `rf-loss-of-consciousness` | Loss of consciousness | Bilinç kaybı | KIRMIZI BAYRAK | — | mevcut | bayıldı; kendinden geçti; bayıldım; bilincini kaybetti / fainted; passed out; unconscious |
| 23 | `rf-stroke-signs` | Stroke signs (face drooping, speech difficulty, arm weakness) | İnme belirtileri (yüzde kayma, konuşma bozukluğu, kolda güçsüzlük) | KIRMIZI BAYRAK | — | mevcut | felç; ağız kayması; dil dolanması; kolum tutmuyor / face drooping; slurred speech; stroke |
| 24 | `rf-thunderclap-headache` | Sudden severe headache | Ani şiddetli baş ağrısı | KIRMIZI BAYRAK | — | mevcut | hayatımın en kötü baş ağrısı; aniden başlayan baş ağrısı; başıma balyoz yemiş gibi; başım patlayacak gibi / worst headache of my life; sudden severe headache; thunderclap headache |
| 25 | `rf-fever-stiff-neck` | High fever with stiff neck | Yüksek ateş ile ense sertliği | KIRMIZI BAYRAK | Acil (112) | YENİ | ense sertliği; boynum kaskatı ve ateş; menenjit / stiff neck and high fever; meningitis |

## Kulak-burun-boğaz — `ent` (YENİ BÖLGE)

Konu: **12** · kırmızı bayrak: 0 · yeni: 12 · koordinatöre giden: 10

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `ear-infection` | Ear infection / discharge | Kulak iltihabı / akıntı | **KOORD** | KBB | YENİ | kulak iltihabı; kulak akıntısı; kulak ağrısı / ear infection; ear discharge; earache |
| 2 | `head-neck-cancer` | Head and neck cancer (diagnosed) | Baş-boyun kanseri (tanı aldım) | ONC 60 | KBB | YENİ | gırtlak kanseri; dil kanseri; ağız içi kanser; larinks / head and neck cancer; throat cancer; laryngeal cancer |
| 3 | `hearing-loss` | Hearing loss | İşitme kaybı | **KOORD** | KBB | YENİ | işitme kaybı; isitme kaybi; az duyuyorum; kulağım duymuyor / hearing loss; can't hear well; deafness |
| 4 | `hoarseness` | Hoarseness / voice problems | Ses kısıklığı | **KOORD** | KBB | YENİ | ses kısıklığı; ses kisikligi; sesim kısıldı; ses teli nodülü / hoarseness; voice problems; vocal cord nodules |
| 5 | `nasal-blockage` | Blocked nose / deviated septum | Burun tıkanıklığı / kemik eğriliği | **KOORD** | KBB | YENİ | burun tıkanıklığı; burun tikanikligi; burun kemiği eğriliği; deviasyon / blocked nose; deviated septum; can't breathe through nose |
| 6 | `nasal-polyps` | Nasal polyps | Burun polibi | **KOORD** | KBB | YENİ | burun polibi; burunda et / nasal polyps |
| 7 | `sinusitis` | Sinusitis | Sinüzit | **KOORD** | KBB | YENİ | sinüzit; sinuzit; geniz akıntısı; yüzde baskı / sinusitis; sinus infection; post-nasal drip |
| 8 | `smell-taste-loss` | Loss of smell or taste | Koku / tat kaybı | **KOORD** | KBB | YENİ | koku alamıyorum; tat alamıyorum; koku kaybı / loss of smell; loss of taste; anosmia |
| 9 | `snoring-sleep-apnea` | Snoring / sleep apnoea | Horlama / uyku apnesi | **KOORD** | KBB / Uyku bozuklukları | YENİ | horlama; uyku apnesi; uykuda nefes durması; horluyorum / snoring; sleep apnoea; sleep apnea; stop breathing at night |
| 10 | `throat-lump` | Lump in the throat feeling | Boğazda yumru hissi | GAS 40 | KBB | YENİ | boğazda yumru; bogazda takilma; boğazımda bir şey var / lump in throat; globus sensation |
| 11 | `tinnitus` | Ringing in the ears | Kulak çınlaması | **KOORD** | KBB | YENİ | kulak çınlaması; kulak cinlamasi; kulağımda vınlama; tinnitus / tinnitus; ringing in ears; buzzing ears |
| 12 | `tonsils` | Tonsil problems | Bademcik sorunları | **KOORD** | KBB | YENİ | bademcik; bademcik iltihabı; sık boğaz enfeksiyonu / tonsils; tonsillitis; tonsil removal |

## Göz — `eyes` (YENİ BÖLGE)

Konu: **8** · kırmızı bayrak: 1 · yeni: 9 · koordinatöre giden: 7

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `blurred-vision` | Blurred vision | Bulanık görme | **KOORD** | Göz Hastalıkları | YENİ | bulanık görme; bulanik gorme; net göremiyorum; gözüm bulanık / blurred vision; blurry eyes |
| 2 | `cataract` | Cataract | Katarakt | **KOORD** | Göz Hastalıkları | YENİ | katarakt; perde; gözde perde / cataract |
| 3 | `dry-eye` | Dry or red eyes | Göz kuruluğu / kızarıklık | **KOORD** | Göz Hastalıkları | YENİ | göz kuruluğu; gözüm kızarıyor; goz kurulugu / dry eyes; red eyes; eye irritation |
| 4 | `eyelid-droop` | Drooping eyelid | Göz kapağı düşüklüğü | PLA 60 | Göz (Okuloplasti) | YENİ | göz kapağı düşüklüğü; pitoz; kapak düşmesi / drooping eyelid; ptosis |
| 5 | `glaucoma` | Glaucoma | Glokom (göz tansiyonu) | **KOORD** | Göz Hastalıkları | YENİ | göz tansiyonu; glokom; goz tansiyonu / glaucoma; eye pressure |
| 6 | `laser-eye-surgery` | Laser eye surgery (no glasses) | Gözlükten kurtulma (lazer) | **KOORD** | Göz Hastalıkları | YENİ | lazer göz ameliyatı; gözlükten kurtulmak; lasik; smile lazer / laser eye surgery; LASIK; get rid of glasses |
| 7 | `retina-diabetic-eye` | Retina / diabetic eye disease | Retina / şeker gözü | **KOORD** | Göz Hastalıkları (Retina) | YENİ | retina; şeker gözü; sari nokta; makula / retina; diabetic retinopathy; macular degeneration |
| 8 | `strabismus` | Squint / strabismus | Şaşılık | **KOORD** | Göz Hastalıkları | YENİ | şaşılık; sasilik; gözüm kayıyor / squint; strabismus; crossed eyes |
| 9 | `rf-sudden-vision-loss` | Sudden loss of vision | Ani görme kaybı | KIRMIZI BAYRAK | Acil (112) | YENİ | aniden göremiyorum; ani görme kaybı; gözüm karardı / sudden vision loss; suddenly can't see |

## Boyun ve omurga — `neck-spine`

Konu: **14** · kırmızı bayrak: 0 · yeni: 5 · koordinatöre giden: 1

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `cervical-disc-herniation` | Neck disc herniation | Boyun fıtığı | NEU 100 | — | mevcut | boyun fıtığı; servikal disk; servikal disk hernisi; boyunda sinir sıkışması / cervical hernia; cervical disc herniation; herniated disc in neck |
| 2 | `hand-numbness-carpal-tunnel` | Hand numbness / carpal tunnel | Elde uyuşma / karpal tünel | NEU 70 · PLA 30 | El Cerrahisi / Nöroloji | mevcut | elim uyuşuyor; bilekte sinir sıkışması; karpal tünel; parmaklarda uyuşma / numb fingers; carpal tunnel; pins and needles in hand |
| 3 | `low-back-pain` | Lower back pain | Bel ağrısı | NEU 70 | Ortopedi / FTR | mevcut | belim ağrıyor; lumbago; bel tutulması; bel sızısı / backache; lumbago; my back hurts |
| 4 | `lumbar-disc-herniation` | Lower back disc herniation | Bel fıtığı | NEU 100 | — | mevcut | bel fıtığı; disk kayması; lomber disk hernisi; bel diski / slipped disc; herniated disc; lumbar hernia |
| 5 | `neck-pain` | Neck pain | Boyun ağrısı | NEU 70 | Ortopedi / FTR | mevcut | boynum ağrıyor; boyun tutulması; boyun düzleşmesi; ense ağrısı / stiff neck; my neck hurts; sore neck |
| 6 | `sciatica` | Sciatica | Siyatik (bacağa vuran ağrı) | NEU 90 | — | mevcut | siyatik; bacağıma vuruyor; siyatik siniri; bacağa yayılan ağrı / leg pain from back; sciatic nerve pain; pain down my leg |
| 7 | `spinal-stenosis` | Spinal stenosis | Kanal darlığı | NEU 100 | — | mevcut | omurilik kanal darlığı; spinal stenoz; dar kanal; bel kanal darlığı / narrow spinal canal; lumbar stenosis; cervical stenosis |
| 8 | `spine-slippage-scoliosis` | Spondylolisthesis / scoliosis | Bel kayması / skolyoz | NEU 70 | Ortopedi | mevcut | omurga eğriliği; bel kayması; skolyoz; spondilolistezis / curved spine; scoliosis; spondylolisthesis |
| 9 | `thyroid-nodule` | Thyroid nodule / goitre | Tiroid nodülü / guatr | ONC 50 · IR 50 | Endokrin Cerrahi | mevcut | guatr; boyunda şişlik; tiroid biyopsisi; nodül ablasyonu / goiter; goitre; thyroid lump |
| 10 | `coccyx-pain` | Tailbone pain | Kuyruk sokumu ağrısı | **KOORD** | Ortopedi / FTR | YENİ | kuyruk sokumu ağrısı; koksiks; kuyruk sokumu / tailbone pain; coccyx pain |
| 11 | `failed-back-surgery` | Pain after back surgery | Bel ameliyatı sonrası ağrı | NEU 90 | — | YENİ | ameliyat sonrası bel ağrısı; ameliyat oldum geçmedi / failed back surgery; pain after spine surgery |
| 12 | `neck-lump` | Lump in the neck | Boyunda şişlik / kitle | ONC 50 | KBB / Genel Cerrahi | YENİ | boyunda kitle; boyunda şişlik; boyunda bez / neck lump; swelling in neck |
| 13 | `spine-surgery-opinion` | Spine surgery second opinion | Omurga ameliyatı ikinci görüş | NEU 100 | — | YENİ | omurga ameliyatı; bel ameliyatı önerildi; ikinci görüş omurga / spine surgery second opinion; back surgery advice |
| 14 | `whiplash-neck-injury` | Neck injury / whiplash | Boyun zorlanması / travma | NEU 40 | Ortopedi / FTR | YENİ | boyun travması; kaza sonrası boyun; boyun incinmesi / whiplash; neck injury |

## Göğüs ve akciğer — `chest`

Konu: **19** · kırmızı bayrak: 2 · yeni: 9 · koordinatöre giden: 5

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `achalasia` | Achalasia | Akalazya | GAS 100 | — | mevcut | yemek borusu kasılmaması; poem; akalazya kardia; yemek geri geliyor / achalasia cardia; peroral endoscopic myotomy; poem |
| 2 | `chest-wall-deformity` | Chest wall deformity | Göğüs duvarı şekil bozukluğu | THO 100 · PLA 30 | — | mevcut | kunduracı göğsü; güvercin göğsü; çökük göğüs; pektus ekskavatum / pectus excavatum; pectus carinatum; sunken chest |
| 3 | `chronic-cough` | Long-lasting cough | Uzun süren öksürük | THO 40 · GAS 40 | Göğüs Hastalıkları | mevcut | geçmeyen öksürük; kronik öksürük; kuru öksürük; sürekli öksürüyorum / persistent cough; chronic cough; cough that won't go away |
| 4 | `esophageal-cancer` | Oesophageal cancer | Yemek borusu kanseri | ONC 80 · GAS 60 · THO 50 | — | mevcut | özofagus kanseri; esd; yemek borusu tümörü; özofagus tümörü / esophageal tumour; esophageal cancer; cancer of the gullet |
| 5 | `hyperhidrosis` | Excessive sweating | Aşırı terleme | THO 90 | — | mevcut | el terlemesi; koltuk altı terlemesi; hiperhidroz; ayak terlemesi / sweaty hands; hyperhidrosis; sweaty palms |
| 6 | `lung-cancer` | Lung cancer | Akciğer kanseri | THO 100 · ONC 60 | — | mevcut | akciğer tümörü; ciğer kanseri; akciğer karsinomu; küçük hücreli akciğer kanseri / lung tumour; lung tumor; lung carcinoma |
| 7 | `lung-nodule` | Lung nodule | Akciğerde nodül | THO 100 · ONC 40 | — | mevcut | akciğerde leke; tomografide nodül; akciğerde gölge; akciğerde nokta / spot on the lung; lung spot; nodule on ct |
| 8 | `mediastinal-mass` | Mediastinal mass | Göğüs ortasında kitle (mediasten) | THO 100 · ONC 40 | — | mevcut | timoma; mediasten kitlesi; göğüste kitle; timüs tümörü / thymoma; mass in chest; mediastinal tumor |
| 9 | `pleural-effusion` | Fluid around the lung | Akciğer zarında sıvı | THO 90 | — | mevcut | akciğerde su toplanması; plevral efüzyon; akciğer zarında su; ciğerde su / pleural effusion; water on the lung; fluid on the lungs |
| 10 | `pneumothorax` | Collapsed lung (recurrent) | Akciğer sönmesi (tekrarlayan) | THO 100 | — | mevcut | pnömotoraks; akciğer sönmesi; akciğer delinmesi; tekrarlayan pnömotoraks / pneumothorax; collapsed lung; punctured lung |
| 11 | `swallowing-difficulty` | Difficulty swallowing | Yutma güçlüğü | GAS 100 | — | mevcut | yutkunamıyorum; lokma takılıyor; poem; disfaji / dysphagia; can't swallow; food gets stuck |
| 12 | `asthma` | Asthma | Astım | **KOORD** | Göğüs Hastalıkları | YENİ | astım; astim; hırıltı; nefes açıcı / asthma; wheezing; inhaler |
| 13 | `bronchiectasis` | Bronchiectasis | Bronşektazi | THO 40 | Göğüs Hastalıkları | YENİ | bronşektazi; bol balgam / bronchiectasis |
| 14 | `copd` | COPD / chronic bronchitis | KOAH / kronik bronşit | **KOORD** | Göğüs Hastalıkları | YENİ | koah; kronik bronşit; amfizem / COPD; chronic bronchitis; emphysema |
| 15 | `coughing-blood-mild` | Blood-stained phlegm | Balgamda kan (az) | THO 50 | Göğüs Hastalıkları | YENİ | balgamda kan; kanlı balgam; öksürünce kan / blood in phlegm; coughing up a little blood |
| 16 | `quit-smoking` | Quit smoking | Sigarayı bırakma | **KOORD** | Göğüs Hastalıkları | YENİ | sigarayı bırakmak; sigara bırakma; sigara bagimliligi / quit smoking; stop smoking; nicotine addiction |
| 17 | `rib-chest-wall-pain` | Chest wall / rib pain | Kaburga / göğüs duvarı ağrısı | THO 40 | Ortopedi | YENİ | kaburga ağrısı; kaburga kırığı; göğüs kafesi ağrısı / rib pain; chest wall pain; rib fracture |
| 18 | `sarcoidosis-lung-disease` | Interstitial lung disease / sarcoidosis | Akciğer fibrozisi / sarkoidoz | **KOORD** | Göğüs Hastalıkları | YENİ | akciğer fibrozisi; sarkoidoz; interstisyel / lung fibrosis; sarcoidosis; interstitial lung disease |
| 19 | `shortness-of-breath` | Shortness of breath (not sudden) | Nefes darlığı (acil olmayan) | **KOORD** | Göğüs Hastalıkları / Kardiyoloji | YENİ | nefes darlığı; nefes darligi; merdivende nefesim kesiliyor; çabuk yoruluyorum / shortness of breath; breathless on stairs; breathlessness |
| 20 | `rf-chest-pain-breathless` | Chest pain with shortness of breath | Göğüs ağrısı ve nefes darlığı | KIRMIZI BAYRAK | — | mevcut | göğsüm sıkışıyor; nefes alamıyorum; kalp krizi; göğsümde baskı / crushing chest pain; can't breathe; heart attack |
| 21 | `rf-fainting-chest-pain` | Fainting with chest pain | Bayılma ile göğüs ağrısı | KIRMIZI BAYRAK | Acil (112) | YENİ | bayıldı göğsü ağrıyordu; göğüs ağrısı sonra bayılma / fainted with chest pain; collapsed chest pain |

## Kalp ve damar — `heart-vessels` (YENİ BÖLGE)

Konu: **17** · kırmızı bayrak: 0 · yeni: 16 · koordinatöre giden: 10

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `aortic-aneurysm` | Aortic aneurysm | Aort anevrizması | IR 60 | Kalp-Damar Cerrahisi | YENİ | aort anevrizması; aort genişlemesi / aortic aneurysm; AAA |
| 2 | `arrhythmia-pacemaker` | Arrhythmia / pacemaker | Ritim bozukluğu / kalp pili | **KOORD** | Kardiyoloji (Elektrofizyoloji) | YENİ | ritim bozukluğu; kalp pili; atrial fibrilasyon / arrhythmia; atrial fibrillation; pacemaker |
| 3 | `carotid-stenosis` | Carotid artery narrowing | Şah damarı darlığı | IR 50 | Kalp-Damar Cerrahisi / Nöroloji | YENİ | şah damarı darlığı; karotis / carotid stenosis; neck artery narrowing |
| 4 | `chest-pain-recurring` | Recurring chest discomfort (not now) | Tekrarlayan göğüs ağrısı (şu an yok) | **KOORD** | Kardiyoloji | YENİ | ara ara göğüs ağrısı; efor sırasında göğüs ağrısı / recurring chest pain; angina; chest pain on exertion |
| 5 | `coronary-bypass-opinion` | Bypass / stent second opinion | Bypass / stent ikinci görüş | **KOORD** | Kardiyoloji / Kalp Cerrahisi | YENİ | bypass önerildi; stent; anjiyo / bypass; coronary stent; angiography second opinion |
| 6 | `dvt-history` | Blood clot follow-up (DVT) | Pıhtı takibi (DVT) | IR 40 | Kalp-Damar Cerrahisi | YENİ | bacakta pıhtı; derin ven trombozu; pihti / blood clot follow-up; DVT |
| 7 | `heart-failure` | Heart failure | Kalp yetmezliği | **KOORD** | Kardiyoloji | YENİ | kalp yetmezliği; kalp büyümesi / heart failure; enlarged heart |
| 8 | `heart-valve` | Heart valve disease | Kalp kapak hastalığı | **KOORD** | Kardiyoloji / Kalp Cerrahisi | YENİ | kalp kapağı; kapak darlığı; kapak yetmezliği / heart valve disease; valve stenosis |
| 9 | `high-blood-pressure` | High blood pressure | Yüksek tansiyon | **KOORD** | Kardiyoloji / İç Hastalıkları | YENİ | yüksek tansiyon; tansiyonum yüksek; hipertansiyon / high blood pressure; hypertension |
| 10 | `high-cholesterol` | High cholesterol | Yüksek kolesterol | **KOORD** | Kardiyoloji / Endokrinoloji | YENİ | kolesterol yüksek; kolestrol; trigliserit / high cholesterol; triglycerides |
| 11 | `leg-pain-cramps` | Leg pain / cramps when walking | Yürürken bacak ağrısı / kramp | IR 40 | Kalp-Damar Cerrahisi | YENİ | bacak krampı; yürürken bacak ağrısı; baldır ağrısı / leg cramps; leg pain when walking; claudication |
| 12 | `low-blood-pressure` | Low blood pressure | Düşük tansiyon | **KOORD** | Kardiyoloji / İç Hastalıkları | YENİ | düşük tansiyon; tansiyonum düşüyor; hipotansiyon / low blood pressure; hypotension |
| 13 | `palpitations` | Palpitations | Çarpıntı | **KOORD** | Kardiyoloji | YENİ | çarpıntı; carpinti; kalbim hızlı atıyor; kalp çarpıntısı / palpitations; racing heart; irregular heartbeat |
| 14 | `peripheral-artery-disease` | Blocked leg arteries | Bacak damar tıkanıklığı | IR 70 | Kalp-Damar Cerrahisi | YENİ | damar tıkanıklığı; bacak damar tıkanıklığı; periferik arter / peripheral artery disease; blocked arteries in legs |
| 15 | `raynaud` | Cold / white fingers | Parmaklarda morarma (Raynaud) | **KOORD** | Romatoloji / Kalp-Damar | YENİ | raynaud; parmaklarım morarıyor; soğukta beyazlaşma / Raynaud's; cold fingers turning white |
| 16 | `spider-veins` | Spider veins | Kılcal damarlar | IR 60 | Kalp-Damar Cerrahisi / Dermatoloji | YENİ | kılcal damar; örümcek ağı damar; kilcal damar / spider veins; thread veins |
| 17 | `varicose-veins` | Varicose veins / venous insufficiency | Varis / toplardamar yetmezliği | IR 100 | — | mevcut (bölge taşındı) | varis; bacakta damar; venöz yetmezlik; örümcek ağı damar / varicose veins; venous ablation; spider veins |

## Mide ve sindirim — `abdomen`

Konu: **38** · kırmızı bayrak: 2 · yeni: 14 · koordinatöre giden: 0

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `abdominal-hernia` | Abdominal / inguinal hernia | Karın / kasık fıtığı | OBE 80 · PLA 30 | Genel Cerrahi | mevcut | kasık fıtığı; göbek fıtığı; karın fıtığı; ameliyat yeri fıtığı / inguinal hernia; umbilical hernia; groin hernia |
| 2 | `bariatric-revision` | Revision after weight-loss surgery | Obezite ameliyatı sonrası revizyon | OBE 100 | — | mevcut | tekrar kilo alma; tüp mide sonrası reflü; revizyon ameliyatı; tüp mideden bypassa geçiş / revision surgery; weight regain; reflux after sleeve |
| 3 | `bile-duct-stones-jaundice` | Bile duct stones / jaundice | Safra yolu taşı / sarılık | GAS 100 | — | mevcut | koledok taşı; gözlerde sararma; ercp; sarılık / jaundice; ercp; bile duct stones |
| 4 | `bloating-ibs` | Bloating / IBS | Şişkinlik / huzursuz bağırsak | GAS 100 | — | mevcut | gaz; spastik kolon; huzursuz bağırsak sendromu; karnım şişiyor / irritable bowel; ibs; bloating |
| 5 | `blood-in-stool` | Blood in stool | Dışkıda kan | GAS 100 · ONC 30 | — | mevcut | makattan kan; kanlı dışkı; makattan kanama; siyah dışkı / rectal bleeding; bloody stool; blood when i poop |
| 6 | `chronic-diarrhea` | Chronic diarrhoea | Uzun süren ishal | GAS 100 | — | mevcut | geçmeyen ishal; crohn; ülseratif kolit; kronik ishal / ibd; crohn's; ulcerative colitis |
| 7 | `colon-polyp` | Colon / stomach polyp | Bağırsak / mide polipi | GAS 100 | — | mevcut | polip; esd; polip aldırma; kolon polipi / polyp removal; polyp; colon polyp |
| 8 | `colonoscopy-screening` | Colonoscopy / endoscopy | Kolonoskopi / endoskopi | GAS 100 | — | mevcut | bağırsak kamerası; kolonoskopi; endoskopi; gastroskopi / colon check; colonoscopy; endoscopy |
| 9 | `colorectal-cancer` | Colon / rectal cancer | Kolon / rektum kanseri | ONC 100 · GAS 50 | — | mevcut | bağırsak kanseri; kolon kanseri; rektum kanseri; kalın bağırsak kanseri / bowel cancer; colon cancer; rectal cancer |
| 10 | `constipation` | Constipation | Kabızlık | GAS 100 | — | mevcut | tuvalete çıkamıyorum; kabız; sert dışkı; bağırsaklarım çalışmıyor / constipated; can't poop; hard stools |
| 11 | `early-gi-cancer` | Early GI tumour (endoscopic removal) | Erken evre mide/bağırsak tümörü (endoskopik çıkarım) | GAS 100 · ONC 30 | — | mevcut | ameliyatsız tümör çıkarma; esd; endoskopik submukozal diseksiyon; emr / endoscopic submucosal dissection; esd; emr |
| 12 | `fatty-liver-liver-enzymes` | Fatty liver / high liver tests | Karaciğer yağlanması / yüksek karaciğer değerleri | GAS 100 · OBE 30 | — | mevcut | karaciğer yağlanması; alt yüksek; ast yüksek; karaciğer enzimleri yüksek / fatty liver; high alt; high liver enzymes |
| 13 | `gallstones` | Gallstones | Safra kesesi taşı | GAS 70 | Genel Cerrahi | mevcut | safra taşı; ercp; safra kesesi; safra sancısı / gallbladder stones; gallstone; gallbladder pain |
| 14 | `gastric-balloon` | Gastric balloon / endoscopic options | Mide balonu / endoskopik yöntemler | OBE 80 · GAS 50 | — | mevcut | mide balonu; mide botoksu; yutulabilir mide balonu; endoskopik tüp mide / intragastric balloon; gastric balloon; stomach balloon |
| 15 | `gastritis-ulcer` | Gastritis / ulcer | Gastrit / ülser | GAS 100 | — | mevcut | mide ülseri; h. pylori; gastrit; helikobakter / stomach ulcer; gastritis; h. pylori |
| 16 | `hemorrhoids-fissure` | Haemorrhoids / anal fissure | Hemoroid / anal fissür | GAS 50 | Genel Cerrahi | mevcut | basur; makat çatlağı; hemoroid; anal fissür / piles; hemorrhoids; anal fissure |
| 17 | `hiatal-hernia` | Hiatal hernia | Mide fıtığı | GAS 80 · OBE 70 | — | mevcut | hiatal herni; mide fıtığı; hiatus hernisi; diyafram fıtığı / hiatus hernia; hiatal hernia; stomach hernia |
| 18 | `indigestion-stomach-pain` | Indigestion / stomach pain | Hazımsızlık / mide ağrısı | GAS 100 | — | mevcut | midem ağrıyor; dispepsi; hazımsızlık; mide bulantısı / dyspepsia; stomach ache; upset stomach |
| 19 | `liver-tumor` | Liver tumour | Karaciğer tümörü | ONC 100 · IR 60 · GAS 40 | — | mevcut | karaciğerde kitle; tümör ablasyonu; karaciğer kanseri; karaciğerde lezyon / liver mass; liver ablation; liver lesion |
| 20 | `obesity` | Obesity / weight loss | Obezite / kilo verme | OBE 100 | — | mevcut | aşırı kilo; tüp mide; mide küçültme; gastrik bypass / gastric sleeve; weight loss surgery; bariatric surgery |
| 21 | `pancreatic-cancer` | Pancreatic cancer | Pankreas kanseri | ONC 100 · GAS 60 | — | mevcut | pankreas tümörü; pankreasta kitle; whipple ameliyatı; pankreas ca / pancreatic tumour; pancreatic tumor; pancreas cancer |
| 22 | `pancreatitis-pancreatic-cyst` | Pancreatitis / pancreatic cyst | Pankreatit / pankreas kisti | GAS 90 · ONC 30 | — | mevcut | pankreas iltihabı; ercp; pankreas kisti; pankreatit / pancreas cyst; pancreatitis; inflamed pancreas |
| 23 | `reflux-heartburn` | Reflux / heartburn | Reflü / mide yanması | GAS 100 · OBE 40 | — | mevcut | mide yanması; ağza acı su gelmesi; reflü; göğüste yanma / acid reflux; gerd; heartburn |
| 24 | `stomach-cancer` | Stomach cancer | Mide kanseri | ONC 100 · GAS 50 | — | mevcut | mide tümörü; gastrik kanser; midede kitle; gastrektomi / gastric cancer; stomach tumour; stomach tumor |
| 25 | `type2-diabetes-metabolic` | Type 2 diabetes (metabolic surgery) | Tip 2 diyabet (metabolik cerrahi) | OBE 100 · GAS 20 | — | mevcut | şeker hastalığı ameliyatı; metabolik cerrahi; tip 2 diyabet; şeker hastalığı / diabetes surgery; metabolic surgery; type 2 diabetes |
| 26 | `anal-fistula-pilonidal` | Anal fistula / pilonidal sinus | Anal fistül / kıl dönmesi | GAS 40 | Genel Cerrahi | YENİ | fistül; kıl dönmesi; kil donmesi; makatta apse / anal fistula; pilonidal sinus |
| 27 | `ascites` | Abdominal fluid (ascites) | Karında su toplanması | GAS 70 · IR 30 | — | YENİ | karında su; asit; karin sisligi / ascites; fluid in abdomen |
| 28 | `capsule-endoscopy` | Capsule endoscopy / small bowel | Kapsül endoskopi / ince bağırsak | GAS 100 | — | YENİ | kapsül endoskopi; ince bağırsak / capsule endoscopy; small bowel |
| 29 | `celiac-disease` | Coeliac disease / gluten | Çölyak / gluten hassasiyeti | GAS 100 | — | YENİ | çölyak; colyak; gluten hassasiyeti / coeliac disease; celiac; gluten intolerance |
| 30 | `chronic-nausea` | Chronic nausea / vomiting | Sürekli bulantı / kusma | GAS 90 | — | YENİ | bulantı; mide bulantısı; sürekli kusma; bulanti / nausea; vomiting; feeling sick |
| 31 | `diverticulitis` | Diverticulitis | Divertikülit | GAS 100 | — | YENİ | divertikül; divertikulit / diverticulitis; diverticular disease |
| 32 | `gallbladder-bile-cancer` | Gallbladder / bile duct cancer | Safra kesesi / safra yolu kanseri | ONC 90 · GAS 40 | — | YENİ | safra kesesi kanseri; safra yolu kanseri; kolanjiyokarsinom / gallbladder cancer; bile duct cancer |
| 33 | `gallbladder-surgery` | Gallbladder removal surgery | Safra kesesi ameliyatı | GAS 40 | Genel Cerrahi | YENİ | safra kesesi ameliyatı; kapalı safra ameliyatı / gallbladder removal; cholecystectomy |
| 34 | `gerd-surgery` | Reflux surgery | Reflü ameliyatı | OBE 70 · GAS 60 | — | YENİ | reflü ameliyatı; fundoplikasyon / reflux surgery; fundoplication |
| 35 | `hepatitis-b-c` | Hepatitis B / C | Hepatit B / C | GAS 100 | — | YENİ | hepatit; sarılık b; hepatit c / hepatitis B; hepatitis C |
| 36 | `lactose-intolerance` | Food intolerance | Gıda intoleransı / laktoz | GAS 90 | — | YENİ | laktoz intoleransı; süt dokunuyor; gıda intoleransı / lactose intolerance; food intolerance |
| 37 | `liver-cirrhosis` | Liver cirrhosis | Karaciğer sirozu | GAS 100 | — | YENİ | siroz; karaciğer sertleşmesi / cirrhosis; liver scarring |
| 38 | `ulcerative-colitis-crohn` | Crohn's / ulcerative colitis | Crohn / ülseratif kolit | GAS 100 | — | YENİ | crohn; ülseratif kolit; iltihabi bagirsak / Crohn's disease; ulcerative colitis; IBD |
| 39 | `rf-acute-abdomen` | Sudden severe abdominal pain | Ani şiddetli karın ağrısı | KIRMIZI BAYRAK | — | mevcut | karnım çok şiddetli ağrıyor; karın sertleşti; dayanılmaz karın ağrısı; karnım tahta gibi / severe sudden belly pain; sudden stomach pain; unbearable abdominal pain |
| 40 | `rf-coffee-ground-vomit` | Vomiting blood / coffee-ground vomit | Kahve telvesi gibi kusma / kan kusma | KIRMIZI BAYRAK | Acil (112) | YENİ | kahve telvesi kusma; siyah kusma; kan kustum / coffee ground vomit; vomiting blood |

## Hormon ve metabolizma — `hormones-metabolism` (YENİ BÖLGE)

Konu: **8** · kırmızı bayrak: 0 · yeni: 8 · koordinatöre giden: 8

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `adrenal-pituitary-hormones` | Adrenal / hormone imbalance | Böbreküstü / hormon dengesizliği | **KOORD** | Endokrinoloji | YENİ | hormon bozukluğu; kortizol; böbreküstü / hormone imbalance; adrenal; cortisol |
| 2 | `diabetes` | Diabetes (management) | Diyabet (şeker) takibi | **KOORD** | Endokrinoloji | YENİ | diyabet; şeker hastalığı; seker hastaligi; insülin / diabetes; blood sugar; insulin |
| 3 | `gout` | Gout / high uric acid | Gut / ürik asit yüksekliği | **KOORD** | Romatoloji | YENİ | gut; ürik asit; ayak başparmağı ağrısı / gout; high uric acid |
| 4 | `osteoporosis` | Osteoporosis | Kemik erimesi | **KOORD** | Endokrinoloji / FTR | YENİ | kemik erimesi; osteoporoz / osteoporosis; bone loss |
| 5 | `prediabetes-insulin-resistance` | Insulin resistance / prediabetes | İnsülin direnci / gizli şeker | **KOORD** | Endokrinoloji | YENİ | insülin direnci; insulin direnci; gizli şeker / insulin resistance; prediabetes |
| 6 | `testosterone-low` | Low testosterone | Testosteron düşüklüğü | **KOORD** | Üroloji / Endokrinoloji | YENİ | testosteron düşük; erkeklik hormonu / low testosterone; male hormone |
| 7 | `thyroid-hormone` | Thyroid hormone problems | Tiroid hormon bozukluğu | **KOORD** | Endokrinoloji | YENİ | tiroid; haşimoto; hipotiroidi; hipertiroidi; guatr ilacı / thyroid problems; hypothyroidism; hyperthyroidism; Hashimoto's |
| 8 | `vitamin-deficiency` | Vitamin deficiency | Vitamin eksikliği | **KOORD** | İç Hastalıkları | YENİ | d vitamini eksikliği; b12 eksikliği; vitamin eksikligi / vitamin deficiency; vitamin D; B12 |

## Pelvis ve üroloji — `pelvis-urology`

Konu: **16** · kırmızı bayrak: 0 · yeni: 12 · koordinatöre giden: 9

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `kidney-stone` | Kidney stone | Böbrek taşı | **KOORD** | Üroloji | mevcut | böbrek taşı; sancı; böbrek sancısı; idrar yolu taşı / renal colic; kidney stones; kidney pain |
| 2 | `male-infertility` | Male infertility | Erkek kısırlığı | IVF 100 | — | mevcut | sperm sayısı düşük; erkek infertilitesi; sperm kalitesi düşük; azospermi / low sperm count; male factor infertility; poor sperm quality |
| 3 | `prostate` | Prostate enlargement | Prostat büyümesi | IR 70 | Üroloji | mevcut | prostat; sık idrara çıkma; prostat arter embolizasyonu; pae / bph; prostate artery embolisation; pae |
| 4 | `urinary-incontinence` | Urinary incontinence | İdrar kaçırma | **KOORD** | Üroloji / Ürojinekoloji | mevcut | idrar tutamama; idrar kaçırıyorum; öksürünce idrar kaçırma; aşırı aktif mesane / bladder leakage; leaking urine; can't hold my pee |
| 5 | `blood-in-urine` | Blood in urine | İdrarda kan | **KOORD** | Üroloji | YENİ | idrarda kan; kanlı idrar; idrarim kirmizi / blood in urine; haematuria |
| 6 | `circumcision-adult` | Adult circumcision / foreskin | Yetişkin sünnet / fimozis | **KOORD** | Üroloji | YENİ | sünnet; fimozis; sunnet / circumcision; phimosis |
| 7 | `erectile-dysfunction` | Erection problems | Sertleşme sorunu | **KOORD** | Üroloji / Androloji | YENİ | sertleşme sorunu; sertlesme; iktidarsızlık / erectile dysfunction; ED; impotence |
| 8 | `frequent-urination` | Frequent urination | Sık idrara çıkma | **KOORD** | Üroloji | YENİ | sık idrar; sik idrara cikma; gece idrara kalkma / frequent urination; peeing at night |
| 9 | `kidney-bladder-cancer` | Kidney / bladder cancer | Böbrek / mesane kanseri | ONC 60 | Üroloji | YENİ | böbrek kanseri; mesane kanseri; mesane tümörü / kidney cancer; bladder cancer |
| 10 | `kidney-cyst-function` | Kidney cyst / kidney function | Böbrek kisti / böbrek fonksiyonu | **KOORD** | Nefroloji / Üroloji | YENİ | böbrek kisti; kreatinin yüksek; böbrek yetmezliği / kidney cyst; kidney function; creatinine |
| 11 | `kidney-failure-dialysis` | Kidney failure / dialysis | Böbrek yetmezliği / diyaliz | IR 30 | Nefroloji | YENİ | diyaliz; böbrek yetmezliği; nakil / kidney failure; dialysis; kidney transplant |
| 12 | `premature-ejaculation` | Premature ejaculation | Erken boşalma | **KOORD** | Üroloji / Androloji | YENİ | erken boşalma; erken bosalma / premature ejaculation |
| 13 | `prostate-cancer` | Prostate cancer (diagnosed) | Prostat kanseri (tanı aldım) | ONC 50 | Üroloji | YENİ | prostat kanseri; psa yüksek / prostate cancer; high PSA |
| 14 | `testicle-lump` | Testicle lump (not sudden pain) | Testiste kitle (ani ağrı değil) | ONC 40 | Üroloji | YENİ | testiste şişlik; yumurtalıkta kitle erkek / testicle lump; testicular swelling |
| 15 | `urinary-tract-infection` | Recurring urinary infections | Tekrarlayan idrar yolu enfeksiyonu | **KOORD** | Üroloji | YENİ | idrar yolu enfeksiyonu; yanma; sistit / urinary tract infection; UTI; cystitis |
| 16 | `varicocele` | Varicocele | Varikosel | IR 60 · IVF 30 | Üroloji | YENİ | varikosel; testiste varis / varicocele |

## Kadın sağlığı — `women`

Konu: **24** · kırmızı bayrak: 1 · yeni: 14 · koordinatöre giden: 9

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `breast-aesthetics` | Breast aesthetics | Meme estetiği | PLA 100 | — | mevcut | meme büyütme; meme küçültme; meme dikleştirme; göğüs estetiği / breast augmentation; breast lift; breast reduction |
| 2 | `breast-cancer` | Breast cancer | Meme kanseri | ONC 100 · PLA 40 | — | mevcut | meme tümörü; meme ca; mastektomi; meme koruyucu cerrahi / breast tumour; breast tumor; mastectomy |
| 3 | `breast-lump` | Breast lump | Memede kitle | ONC 100 · PLA 20 | — | mevcut | memede sertlik; meme kisti; memede yumru; fibroadenom / lump in breast; breast cyst; breast mass |
| 4 | `egg-freezing` | Egg freezing | Yumurta dondurma | IVF 100 | — | mevcut | yumurta saklama; oosit dondurma; yumurtalarımı dondurmak; doğurganlığı koruma / oocyte freezing; freeze my eggs; egg preservation |
| 5 | `endometriosis` | Endometriosis | Endometriozis | IVF 70 | Kadın Hastalıkları | mevcut | çikolata kisti; endometrioma; ağrılı adet; kasık ağrısı / endometrioma; chocolate cyst; painful periods |
| 6 | `infertility` | Infertility | Kısırlık / çocuk sahibi olamama | IVF 100 | — | mevcut | bebek olmuyor; infertilite; hamile kalamıyorum; çocuğumuz olmuyor / trying to conceive; can't get pregnant; not getting pregnant |
| 7 | `ivf` | IVF treatment | Tüp bebek tedavisi | IVF 100 | — | mevcut | tüp bebek; aşılama; ivf; icsi / in vitro fertilisation; in vitro fertilization; test tube baby |
| 8 | `ovarian-cyst` | Ovarian cyst | Yumurtalık kisti | IVF 50 · ONC 30 | Kadın Hastalıkları | mevcut | over kisti; yumurtalıkta kist; dermoid kist; yumurtalıkta kitle / ovary cyst; cyst on ovary; dermoid cyst |
| 9 | `pcos` | PCOS | Polikistik over | IVF 80 · OBE 30 | — | mevcut | yumurtalıkta kist; adet düzensizliği; pkos; polikistik over sendromu / polycystic ovaries; polycystic ovary syndrome; irregular periods |
| 10 | `recurrent-miscarriage` | Recurrent miscarriage | Tekrarlayan düşük | IVF 90 | — | mevcut | düşük yapma; tekrarlayan gebelik kaybı; sürekli düşük yapıyorum; bebeği kaybettim / pregnancy loss; repeated miscarriages; keep miscarrying |
| 11 | `uterine-fibroids` | Uterine fibroids | Rahim miyomu | ONC 70 · IR 50 · IVF 30 | Kadın Hastalıkları | mevcut | miyom; miyom embolizasyonu; rahimde ur; yoğun adet kanaması / fibroid; uterine fibroid embolisation; ufe |
| 12 | `adenomyosis` | Adenomyosis | Adenomiyozis | IR 40 · IVF 30 | Kadın Hastalıkları | YENİ | adenomiyozis; rahim kalınlaşması / adenomyosis |
| 13 | `cervical-uterine-cancer` | Cervical / uterine cancer | Rahim ağzı / rahim kanseri | ONC 70 | Jinekolojik Onkoloji | YENİ | rahim kanseri; rahim ağzı kanseri; endometrium / cervical cancer; uterine cancer; endometrial cancer |
| 14 | `contraception` | Contraception | Doğum kontrolü | **KOORD** | Kadın Hastalıkları | YENİ | doğum kontrolü; spiral; hap / contraception; birth control; IUD |
| 15 | `irregular-periods` | Irregular periods | Adet düzensizliği | **KOORD** | Kadın Hastalıkları | YENİ | adet düzensizliği; regl düzensiz; adet gecikmesi / irregular periods; missed period |
| 16 | `menopause` | Menopause | Menopoz | **KOORD** | Kadın Hastalıkları | YENİ | menopoz; sıcak basması; sicak basmasi / menopause; hot flushes |
| 17 | `ovarian-cancer` | Ovarian cancer | Yumurtalık kanseri | ONC 80 | Jinekolojik Onkoloji | YENİ | yumurtalık kanseri; over kanseri / ovarian cancer |
| 18 | `painful-heavy-periods` | Painful or heavy periods | Ağrılı / bol adet | **KOORD** | Kadın Hastalıkları | YENİ | ağrılı adet; bol adet; adet sancısı / painful periods; heavy periods |
| 19 | `pelvic-pain` | Pelvic pain | Kasık / pelvik ağrı | **KOORD** | Kadın Hastalıkları | YENİ | kasık ağrısı kadın; pelvik ağrı / pelvic pain; lower abdominal pain |
| 20 | `pregnancy-follow-up` | Pregnancy follow-up | Gebelik takibi | **KOORD** | Kadın Doğum | YENİ | gebelik takibi; hamilelik; hamileyim / pregnancy follow-up; prenatal care |
| 21 | `smear-hpv` | Smear test / HPV | Smear / HPV | **KOORD** | Kadın Hastalıkları | YENİ | smear; hpv; rahim ağzı taraması / smear test; HPV; cervical screening |
| 22 | `uterine-prolapse` | Uterine / pelvic prolapse | Rahim sarkması | **KOORD** | Kadın Hastalıkları / Ürojinekoloji | YENİ | rahim sarkması; mesane sarkması; sarkma / uterine prolapse; pelvic organ prolapse |
| 23 | `vaginal-aesthetics` | Intimate aesthetics | Genital estetik | PLA 80 | — | YENİ | genital estetik; labioplasti; vajinoplasti / labiaplasty; vaginal rejuvenation; intimate surgery |
| 24 | `vaginal-infection` | Vaginal discharge / infection | Akıntı / vajinal enfeksiyon | **KOORD** | Kadın Hastalıkları | YENİ | akıntı; vajinal enfeksiyon; mantar / vaginal discharge; vaginal infection |
| 25 | `rf-pregnancy-bleeding-pain` | Bleeding or severe pain in pregnancy | Gebelikte kanama / şiddetli ağrı | KIRMIZI BAYRAK | Acil (112) | YENİ | hamileyim kanama; gebelikte kanama; hamilelikte şiddetli karın ağrısı / bleeding in pregnancy; severe pain while pregnant |

## Cilt ve estetik — `skin-aesthetic`

Konu: **35** · kırmızı bayrak: 0 · yeni: 25 · koordinatöre giden: 8

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `eyelid-surgery` | Eyelid surgery | Göz kapağı estetiği | PLA 100 | — | mevcut | blefaroplasti; göz altı torbası; göz kapağı düşüklüğü; üst göz kapağı sarkması / blepharoplasty; eye bags; droopy eyelids |
| 2 | `facelift` | Face and neck lift | Yüz / boyun germe | PLA 100 | — | mevcut | yüz germe; sarkma; boyun germe; gıdı sarkması / facelift; neck lift; sagging skin |
| 3 | `fillers-botox` | Fillers / botox | Dolgu / botoks | PLA 100 | — | mevcut | dudak dolgusu; kırışıklık; botoks; hyaluronik asit / lip filler; anti-wrinkle; botox |
| 4 | `gynecomastia` | Gynaecomastia | Jinekomasti (erkekte meme büyümesi) | PLA 100 | — | mevcut | erkek memesi; jinekomasti; erkekte meme küçültme; erkekte göğüs büyümesi / man boobs; gynecomastia; male breast reduction |
| 5 | `liposuction-body-contouring` | Liposuction / body contouring | Liposuction / vücut şekillendirme | PLA 100 · OBE 20 | — | mevcut | yağ aldırma; lipo; liposakşın; vaser / lipo; liposuction; vaser |
| 6 | `post-weight-loss-contouring` | Skin removal after weight loss | Kilo kaybı sonrası sarkma | PLA 100 · OBE 30 | — | mevcut | kol germe; uyluk germe; deri sarkması; fazla deri alma / arm lift; thigh lift; loose skin |
| 7 | `rhinoplasty` | Nose aesthetics | Burun estetiği | PLA 100 | — | mevcut | rinoplasti; burun ameliyatı; burun kemeri; eğri burun / nose job; rhinoplasty; nose surgery |
| 8 | `scar-revision` | Scar revision | Yara izi düzeltme | PLA 90 | — | mevcut | iz; keloid; yara izi; ameliyat izi / scar treatment; keloid; scar removal |
| 9 | `skin-lesion-mole` | Mole / skin lesion | Ben / cilt lezyonu | PLA 40 · ONC 40 | Dermatoloji | mevcut | ben aldırma; şüpheli ben; cilt lezyonu; et beni / mole removal; suspicious mole; skin lesion |
| 10 | `tummy-tuck` | Tummy tuck | Karın germe | PLA 100 | — | mevcut | abdominoplasti; karında sarkma; doğum sonrası karın sarkması; önlük karın / abdominoplasty; saggy belly; loose belly skin |
| 11 | `acne` | Acne | Sivilce / akne | **KOORD** | Dermatoloji | YENİ | sivilce; akne; yüzde sivilce / acne; pimples; spots |
| 12 | `acne-scars` | Acne scars | Akne izi | PLA 60 | Dermatoloji | YENİ | akne izi; sivilce izi / acne scars |
| 13 | `arm-thigh-lift` | Arm / thigh lift | Kol / bacak germe | PLA 100 | — | YENİ | kol germe; bacak germe; sarkma / arm lift; thigh lift |
| 14 | `breast-implant-revision` | Breast implant removal / revision | Meme protezi değişimi / çıkarılması | PLA 100 | — | YENİ | protez değişimi; protez çıkarma; kapsül / breast implant removal; implant revision |
| 15 | `breast-reduction` | Breast reduction | Meme küçültme | PLA 100 | — | YENİ | meme küçültme; meme kucultme / breast reduction |
| 16 | `brow-lift` | Brow / forehead lift | Kaş kaldırma / alın germe | PLA 100 | — | YENİ | kaş kaldırma; alın germe / brow lift; forehead lift |
| 17 | `chin-jaw-contouring` | Chin / jawline | Çene estetiği | PLA 90 | — | YENİ | çene estetiği; cene; çene ucu / chin implant; jawline contouring |
| 18 | `chronic-wound` | Non-healing wound | İyileşmeyen yara | PLA 50 | Yara bakımı / Genel Cerrahi | YENİ | iyileşmeyen yara; kapanmayan yara; diyabetik ayak / non-healing wound; diabetic foot ulcer |
| 19 | `eczema` | Eczema | Egzama | **KOORD** | Dermatoloji | YENİ | egzama; egzema; kaşıntı / eczema; dermatitis |
| 20 | `fat-transfer-bbl` | Fat transfer / BBL | Yağ transferi / BBL | PLA 100 | — | YENİ | yağ enjeksiyonu; bbl; brezilya popo / fat transfer; BBL; Brazilian butt lift |
| 21 | `female-hair-loss` | Hair loss in women | Kadınlarda saç dökülmesi | HAIR 70 | Dermatoloji | YENİ | kadın saç dökülmesi; saç seyrekliği kadın / female hair loss; thinning hair women |
| 22 | `fungal-nail` | Fungal skin / nail infection | Mantar (cilt / tırnak) | **KOORD** | Dermatoloji | YENİ | tırnak mantarı; ayak mantarı / nail fungus; fungal infection |
| 23 | `lip-lift` | Lip lift | Dudak kaldırma | PLA 90 | — | YENİ | dudak kaldırma; bullhorn / lip lift |
| 24 | `lymphedema` | Lymphoedema | Lenfödem | PLA 60 | Lenfödem tedavisi | YENİ | lenfödem; lenfodem; kolda şişlik meme ameliyatı sonrası / lymphoedema; lymphedema |
| 25 | `mommy-makeover` | Mommy makeover | Doğum sonrası estetik | PLA 100 | — | YENİ | doğum sonrası estetik; mommy makeover / mommy makeover; post-pregnancy body |
| 26 | `otoplasty` | Prominent ears | Kepçe kulak | PLA 100 | — | YENİ | kepçe kulak; kepce kulak; kulak estetiği / prominent ears; otoplasty; ear pinning |
| 27 | `prp-hair` | Hair loss treatments (PRP, mesotherapy) | Saç tedavileri (PRP, mezoterapi) | HAIR 70 | Dermatoloji | YENİ | prp; saç mezoterapi; sac dokulmesi tedavi / PRP hair; hair mesotherapy |
| 28 | `psoriasis` | Psoriasis | Sedef | **KOORD** | Dermatoloji | YENİ | sedef; sedef hastalığı / psoriasis |
| 29 | `revision-rhinoplasty` | Revision rhinoplasty | Revizyon burun estetiği | PLA 100 | — | YENİ | revizyon burun; ikinci burun ameliyatı / revision rhinoplasty; nose job revision |
| 30 | `rosacea` | Rosacea / facial redness | Gül hastalığı / yüz kızarıklığı | **KOORD** | Dermatoloji | YENİ | gül hastalığı; rozasea; yüz kızarıklığı / rosacea; facial redness |
| 31 | `skin-cancer` | Skin cancer / melanoma | Cilt kanseri / melanom | ONC 80 · PLA 40 | Dermatoloji | YENİ | cilt kanseri; melanom; bazal hücreli / skin cancer; melanoma; basal cell |
| 32 | `skin-laser-rejuvenation` | Skin rejuvenation (laser, peels) | Cilt yenileme (lazer, peeling) | PLA 50 | Dermatoloji | YENİ | cilt gençleştirme; lazer; peeling; leke tedavisi / skin rejuvenation; laser resurfacing; chemical peel |
| 33 | `tattoo-removal` | Tattoo removal | Dövme silme | **KOORD** | Dermatoloji | YENİ | dövme silme; dovme sildirme / tattoo removal |
| 34 | `vitiligo-pigmentation` | Pigmentation / vitiligo | Leke / vitiligo | **KOORD** | Dermatoloji | YENİ | yüzde leke; güneş lekesi; vitiligo; ala / pigmentation; dark spots; melasma; vitiligo |
| 35 | `warts` | Warts | Siğil | **KOORD** | Dermatoloji | YENİ | siğil; sigil / warts |

## Ağız ve diş — `dental`

Konu: **20** · kırmızı bayrak: 0 · yeni: 10 · koordinatöre giden: 0

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `bite-problems` | Bite / jaw alignment problems | Çene-diş kapanış bozukluğu | ORT 100 | — | mevcut | kapanış bozukluğu; alt çene önde; derin kapanış; çapraz kapanış / overbite; underbite; malocclusion |
| 2 | `braces-crooked-teeth` | Braces / crooked teeth | Diş teli / çapraşık diş | ORT 100 | — | mevcut | diş teli; braket; çapraşıklık; eğri dişler / braces; crowded teeth; crooked teeth |
| 3 | `clear-aligners` | Clear aligners | Şeffaf plak | ORT 100 | — | mevcut | şeffaf plak; görünmez tel; invisalign; şeffaf plak tedavisi / aligners; invisible braces; invisalign |
| 4 | `dental-abscess` | Dental abscess | Diş apsesi | DEN 100 | — | mevcut | diş iltihabı; yüzde şişlik; apse; dişten yüzüm şişti / tooth infection; abscess; swollen face from tooth |
| 5 | `dental-implant` | Dental implant | İmplant | DEN 100 | — | mevcut | diş eksikliği; vidalı diş; implant; diş implantı / tooth implant; implants; missing tooth |
| 6 | `gum-recession` | Gum recession / gum disease | Diş eti çekilmesi / diş eti hastalığı | DEN 100 | — | mevcut | diş eti kanaması; periodontit; diş eti çekilmesi; diş eti iltihabı / gum disease; bleeding gums; periodontitis |
| 7 | `root-canal` | Root canal treatment | Kanal tedavisi | DEN 100 | — | mevcut | kanal; endodonti; dişin siniri; sinir tedavisi / endodontics; root canal; nerve treatment |
| 8 | `smile-design` | Smile design / veneers | Gülüş tasarımı / kaplama | DEN 100 | — | mevcut | zirkonyum; lamina; hollywood gülüşü; porselen kaplama / veneers; hollywood smile; zirconia crowns |
| 9 | `teeth-whitening` | Teeth whitening | Diş beyazlatma | DEN 100 | — | mevcut | beyazlatma; bleaching; sarı dişler; dişlerde leke / bleaching; whitening; yellow teeth |
| 10 | `toothache` | Toothache / cavity | Diş ağrısı / çürük | DEN 100 | — | mevcut | dişim ağrıyor; diş çürüğü; diş dolgusu; dişim sızlıyor / tooth pain; cavity; tooth decay |
| 11 | `all-on-4` | Full-mouth implants (All-on-4) | Tüm ağız implant (All-on-4) | DEN 100 | — | YENİ | tüm ağız implant; all on 4; sabit protez / all-on-4; full mouth implants |
| 12 | `bad-breath` | Bad breath | Ağız kokusu | DEN 60 | Diş / Gastroenteroloji | YENİ | ağız kokusu; agiz kokusu / bad breath; halitosis |
| 13 | `bone-graft-sinus-lift` | Bone graft / sinus lift | Kemik tozu / sinüs kaldırma | DEN 100 | — | YENİ | kemik tozu; sinüs lift / bone graft; sinus lift |
| 14 | `crowns-bridges` | Crowns / bridges | Kaplama / köprü | DEN 100 | — | YENİ | kaplama; köprü; diş kaplama; porselen / crowns; bridges; dental crown |
| 15 | `dentures` | Dentures | Protez diş | DEN 100 | — | YENİ | takma diş; protez diş / dentures; false teeth |
| 16 | `gummy-smile` | Gummy smile | Diş eti gülüşü | DEN 70 | — | YENİ | diş eti görünümü; gummy smile / gummy smile; gum contouring |
| 17 | `sensitive-broken-teeth` | Sensitive or broken teeth | Hassas / kırık diş | DEN 100 | — | YENİ | diş hassasiyeti; kırık diş; diş kırıldı / sensitive teeth; broken tooth; chipped tooth |
| 18 | `teeth-grinding-tmj` | Teeth grinding / jaw joint | Diş sıkma / çene eklemi | DEN 70 | Ağız-Diş-Çene Cerrahisi | YENİ | diş sıkma; diş gıcırdatma; çene eklemi; cene agrisi / teeth grinding; bruxism; TMJ; jaw pain |
| 19 | `tooth-extraction` | Tooth extraction | Diş çekimi | DEN 100 | — | YENİ | diş çekimi; dis cekimi; diş çektirmek / tooth extraction; pull a tooth |
| 20 | `wisdom-tooth` | Wisdom tooth | Yirmilik diş | DEN 100 | — | YENİ | yirmilik; gömülü diş; 20lik / wisdom tooth; impacted tooth |

## Eklem, kemik ve kas — `joints-bones`

Konu: **14** · kırmızı bayrak: 0 · yeni: 12 · koordinatöre giden: 12

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `hip-shoulder-pain` | Hip / shoulder pain | Kalça / omuz ağrısı | **KOORD** | Ortopedi | mevcut | kalça protezi; donuk omuz; kalça ağrısı; omuz ağrısı / hip replacement; frozen shoulder; hip pain |
| 2 | `knee-pain` | Knee pain | Diz ağrısı | **KOORD** | Ortopedi | mevcut | menisküs; diz kireçlenmesi; dizim ağrıyor; diz protezi / knee arthritis; meniscus tear; my knee hurts |
| 3 | `bone-tumor` | Bone tumour | Kemik tümörü | ONC 40 | Ortopedik Onkoloji | YENİ | kemik tümörü; kemikte kitle / bone tumour; bone tumor |
| 4 | `fibromyalgia` | Widespread muscle pain | Yaygın kas ağrısı / fibromiyalji | **KOORD** | FTR / Romatoloji | YENİ | fibromiyalji; her yerim ağrıyor; kas ağrısı / fibromyalgia; muscle pain all over |
| 5 | `foot-ankle` | Foot / ankle problems | Ayak / ayak bileği sorunları | **KOORD** | Ortopedi | YENİ | topuk dikeni; halluks valgus; ayak bileği / heel spur; bunion; ankle problems |
| 6 | `fracture-follow-up` | Fracture follow-up | Kırık takibi | **KOORD** | Ortopedi | YENİ | kırık; alçı; kemik kırığı / fracture follow-up; broken bone |
| 7 | `hand-wrist` | Hand / wrist problems | El / el bileği sorunları | PLA 40 | El Cerrahisi / Ortopedi | YENİ | tetik parmak; el bileği ağrısı; gangliyon / trigger finger; wrist pain; ganglion |
| 8 | `hip-replacement` | Hip replacement | Kalça protezi | **KOORD** | Ortopedi | YENİ | kalça protezi; kalca protezi / hip replacement |
| 9 | `knee-replacement` | Knee replacement | Diz protezi | **KOORD** | Ortopedi | YENİ | diz protezi; diz ameliyatı / knee replacement |
| 10 | `meniscus-ligament-tear` | Meniscus / ligament tear | Menisküs / bağ yırtığı | **KOORD** | Ortopedi | YENİ | menisküs yırtığı; çapraz bağ; bag yirtigi / meniscus tear; ACL tear; ligament injury |
| 11 | `osteoarthritis` | Osteoarthritis | Kireçlenme | **KOORD** | Ortopedi / FTR | YENİ | kireçlenme; kirecleme; eklem kireçlenmesi / osteoarthritis; wear and tear arthritis |
| 12 | `rheumatoid-arthritis` | Rheumatoid arthritis / joint inflammation | Romatizma / eklem iltihabı | **KOORD** | Romatoloji | YENİ | romatizma; romatoid artrit; eklem iltihabı / rheumatoid arthritis; inflammatory arthritis |
| 13 | `shoulder-pain` | Shoulder pain | Omuz ağrısı | **KOORD** | Ortopedi | YENİ | omuz ağrısı; omuz agrisi; donuk omuz; rotator / shoulder pain; frozen shoulder; rotator cuff |
| 14 | `sports-injury` | Sports injury | Spor yaralanması | **KOORD** | Ortopedi / Spor Hekimliği | YENİ | spor sakatlığı; spor yaralanmasi; burkulma / sports injury; sprain |

## Genel kontrol — `general-checkup`

Konu: **9** · kırmızı bayrak: 0 · yeni: 6 · koordinatöre giden: 9

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `general-checkup` | General check-up | Check-up | **KOORD** | İç Hastalıkları | mevcut | genel sağlık kontrolü; check-up; kan tahlili; tüm vücut kontrolü / health check; check-up; full body check |
| 2 | `longevity` | Longevity / healthy ageing | Sağlıklı yaşlanma (longevity) | **KOORD** | İç Hastalıkları | mevcut | yaşlanma karşıtı; uzun yaşam; anti-aging; longevity / healthy aging; anti-aging; anti-ageing |
| 3 | `second-opinion` | Second opinion | İkinci görüş | **KOORD** | İlgili uzmanlık (koordinatör) | mevcut | başka doktor görüşü; ikinci doktor görüşü; tanımı kontrol ettirmek; tedavi planına bakılması / medical second opinion; another doctor's opinion; review my diagnosis |
| 4 | `genetic-testing` | Genetic testing | Genetik test | **KOORD** | Tıbbi Genetik | YENİ | genetik test; brca; kalıtsal / genetic testing; BRCA |
| 5 | `mens-checkup` | Men's check-up | Erkek check-up | **KOORD** | Üroloji / İç Hastalıkları | YENİ | erkek checkup; erkek kontrolü / men's health check |
| 6 | `pre-surgery-assessment` | Pre-operative assessment | Ameliyat öncesi değerlendirme | **KOORD** | Anesteziyoloji / İç Hastalıkları | YENİ | ameliyat öncesi kontrol; anestezi değerlendirmesi / pre-operative assessment |
| 7 | `sports-medicine-check` | Sports health check | Sporcu sağlık kontrolü | **KOORD** | Spor Hekimliği / Kardiyoloji | YENİ | sporcu checkup; efor testi / sports medical; exercise test |
| 8 | `travel-vaccines` | Vaccines / travel health | Aşı / seyahat sağlığı | **KOORD** | İç Hastalıkları / Enfeksiyon | YENİ | aşı; seyahat aşısı; asi / vaccines; travel health |
| 9 | `womens-checkup` | Women's check-up | Kadın check-up | **KOORD** | Kadın Hastalıkları / İç Hastalıkları | YENİ | kadın checkup; kadın kontrolü / women's health check |

## Kanser (tanı aldım / ikinci görüş) — `cancer`

Konu: **14** · kırmızı bayrak: 0 · yeni: 10 · koordinatöre giden: 2

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `cancer-screening` | Cancer screening | Kanser taraması | GAS 50 · ONC 50 | — | mevcut | kanser kontrolü; kanser taraması; tümör belirteçleri; erken teşhis / cancer check; cancer screening; tumour markers |
| 2 | `cancer-surgery-opinion` | Cancer surgery / second opinion | Kanser ameliyatı / ikinci görüş | ONC 100 | — | mevcut | tümör ameliyatı; kanser ameliyatı; onkoloji ikinci görüş; kanser tedavi planı / tumour surgery; tumor surgery; cancer operation |
| 3 | `soft-tissue-lump` | Lump under the skin | Deri altında kitle / şişlik | ONC 70 · PLA 30 | — | mevcut | yumru; lipom; deri altında şişlik; yağ bezesi / lipoma; lump; bump under skin |
| 4 | `swollen-lymph-nodes` | Swollen lymph nodes | Lenf bezi büyümesi | ONC 50 | Hematoloji | mevcut | boyunda bez; lenf nodu; koltuk altında bez; kasıkta bez / swollen glands; lymph node; lump in neck |
| 5 | `cancer-follow-up` | Cancer follow-up after treatment | Kanser tedavisi sonrası takip | ONC 60 | Tıbbi Onkoloji | YENİ | kanser takibi; tedavi sonrası kontrol / cancer follow-up; surveillance |
| 6 | `cancer-of-unknown-origin` | Metastasis / unknown primary | Metastaz / kaynağı belirsiz kanser | ONC 70 | Tıbbi Onkoloji | YENİ | metastaz; yayılım; kaynağı belli değil / metastasis; cancer of unknown primary |
| 7 | `chemo-radiotherapy` | Chemotherapy / radiotherapy questions | Kemoterapi / radyoterapi | **KOORD** | Tıbbi Onkoloji / Radyasyon Onkolojisi | YENİ | kemoterapi; radyoterapi; ışın tedavisi; ilaç tedavisi kanser / chemotherapy; radiotherapy; cancer drug treatment |
| 8 | `lymphoma-leukemia` | Lymphoma / leukaemia | Lenfoma / lösemi | **KOORD** | Hematoloji | YENİ | lenfoma; lösemi; kan kanseri / lymphoma; leukaemia; blood cancer |
| 9 | `neuroendocrine-tumor` | Neuroendocrine tumour | Nöroendokrin tümör | ONC 80 · GAS 40 | — | YENİ | nöroendokrin tümör; net tümör / neuroendocrine tumour; NET |
| 10 | `peritoneal-cancer-hipec` | Peritoneal cancer / HIPEC | Periton kanseri / HIPEC | ONC 100 | — | YENİ | hipec; karın zarı kanseri; sıcak kemoterapi / HIPEC; peritoneal cancer |
| 11 | `sarcoma` | Sarcoma | Sarkom | ONC 90 | — | YENİ | sarkom; yumuşak doku kanseri / sarcoma; soft tissue cancer |
| 12 | `testicular-cancer` | Testicular cancer | Testis kanseri | ONC 50 | Üroloji | YENİ | testis kanseri / testicular cancer |
| 13 | `thyroid-cancer` | Thyroid cancer | Tiroid kanseri | ONC 80 | Endokrin Cerrahi | YENİ | tiroid kanseri; papiller / thyroid cancer; papillary carcinoma |
| 14 | `tumour-ablation` | Tumour ablation / embolisation | Tümör yakma / embolizasyon | IR 90 · ONC 40 | — | YENİ | tümör yakma; ablasyon; kemoembolizasyon; tace / tumour ablation; chemoembolisation; TACE |

## Ruh sağlığı — `mental-wellbeing`

Konu: **10** · kırmızı bayrak: 1 · yeni: 8 · koordinatöre giden: 10

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `sleep-problems` | Sleep problems | Uyku sorunları | **KOORD** | Psikiyatri / Uyku bozuklukları | mevcut | uykusuzluk; horlama; uyuyamıyorum; uyku apnesi / insomnia; snoring; can't sleep |
| 2 | `stress-anxiety` | Stress / anxiety | Stres / kaygı | **KOORD** | Psikiyatri | mevcut | panik atak; depresyon; kaygı bozukluğu; anksiyete / panic attacks; low mood; anxiety |
| 3 | `addiction` | Addiction (alcohol / substances) | Bağımlılık (alkol / madde) | **KOORD** | Psikiyatri (Bağımlılık) | YENİ | alkol bağımlılığı; madde bağımlılığı; bagimlilik / addiction; alcohol dependence |
| 4 | `adhd` | ADHD / attention problems | DEHB / dikkat sorunu | **KOORD** | Psikiyatri | YENİ | dikkat eksikliği; dehb; hiperaktivite / ADHD; attention deficit |
| 5 | `burnout-stress` | Burnout | Tükenmişlik | **KOORD** | Psikiyatri / Psikoloji | YENİ | tükenmişlik; tukenmislik; iş stresi / burnout; work stress |
| 6 | `depression` | Depression | Depresyon | **KOORD** | Psikiyatri | YENİ | depresyon; mutsuzluk; çökkünlük / depression; feeling down; low mood |
| 7 | `eating-disorder` | Eating disorder | Yeme bozukluğu | **KOORD** | Psikiyatri | YENİ | yeme bozukluğu; anoreksiya; bulimiya / eating disorder; anorexia; bulimia |
| 8 | `grief-trauma` | Trauma / grief | Travma / yas | **KOORD** | Psikiyatri / Psikoloji | YENİ | travma; yas; travma sonrası stres / trauma; grief; PTSD |
| 9 | `ocd` | Obsessive thoughts (OCD) | Takıntı (OKB) | **KOORD** | Psikiyatri | YENİ | takıntı; okb; obsesif / OCD; obsessive thoughts |
| 10 | `panic-attacks` | Panic attacks | Panik atak | **KOORD** | Psikiyatri | YENİ | panik atak; panik atak geçiriyorum / panic attacks |
| 11 | `rf-suicidal-thoughts` | Suicidal thoughts | İntihar düşüncesi | KIRMIZI BAYRAK | — | mevcut | kendimi öldürmek; yaşamak istemiyorum; intihar; ölmek istiyorum / suicidal; want to die; kill myself |

## Çocuk (şimdilik koordinatör; veli kuralı) — `children` (YENİ BÖLGE)

Konu: **14** · kırmızı bayrak: 1 · yeni: 15 · koordinatöre giden: 14

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `child-allergy` | My child: allergy / eczema | Çocuğum: alerji / egzama | **KOORD** | Çocuk Alerjisi | YENİ | çocukta alerji; bebek egzaması / child allergy; baby eczema |
| 2 | `child-bedwetting` | My child: bedwetting / urine | Çocuğum: altını ıslatma | **KOORD** | Çocuk Ürolojisi / Nefroloji | YENİ | altını ıslatma; gece işeme / bedwetting; enuresis |
| 3 | `child-cough-asthma` | My child: cough / asthma | Çocuğum: öksürük / astım | **KOORD** | Çocuk Göğüs Hastalıkları | YENİ | çocuk öksürüğü; çocukta astım / child cough; child asthma |
| 4 | `child-dental` | My child: teeth | Çocuğum: diş | **KOORD** | Çocuk Diş Hekimliği (Pedodonti) | YENİ | çocuk dişi; süt dişi; pedodonti / children's teeth; milk teeth |
| 5 | `child-development` | My child: development / autism | Çocuğum: gelişim / otizm | **KOORD** | Çocuk Nörolojisi / Çocuk Psikiyatrisi | YENİ | otizm; konuşma gecikmesi; gelişim geriliği / autism; speech delay; developmental delay |
| 6 | `child-ent` | My child: tonsils / ears | Çocuğum: bademcik / kulak | **KOORD** | KBB | YENİ | çocuk bademcik; geniz eti; çocuk kulak / child tonsils; adenoids; child ear infection |
| 7 | `child-fever-infection` | My child: fever / infections | Çocuğum: ateş / sık hastalanma | **KOORD** | Çocuk Sağlığı | YENİ | çocuğumun ateşi; çocuk sık hasta; bebek ateş / my child has fever; child infections |
| 8 | `child-growth` | My child: growth / puberty | Çocuğum: büyüme / ergenlik | **KOORD** | Çocuk Endokrinolojisi | YENİ | boy uzaması; büyüme geriliği; erken ergenlik / child growth; short stature; puberty |
| 9 | `child-mental` | My child: behaviour / emotions | Çocuğum: davranış / duygusal | **KOORD** | Çocuk Psikiyatrisi | YENİ | çocuk davranış sorunu; çocuk kaygı / child behaviour; child anxiety |
| 10 | `child-orthopedics` | My child: bones / walking | Çocuğum: kemik / yürüme | **KOORD** | Çocuk Ortopedisi | YENİ | düztaban; çarpık bacak; kalça çıkığı / flat feet; bow legs; hip dysplasia |
| 11 | `child-stomach` | My child: stomach / bowel | Çocuğum: karın ağrısı / kabızlık | **KOORD** | Çocuk Gastroenterolojisi | YENİ | çocuk karın ağrısı; çocukta kabızlık / child stomach ache; child constipation |
| 12 | `child-surgery` | My child: hernia / undescended testis | Çocuğum: fıtık / inmemiş testis | **KOORD** | Çocuk Cerrahisi | YENİ | çocuk fıtık; inmemiş testis; çocuk sünnet / child hernia; undescended testicle |
| 13 | `child-weight` | My child: weight | Çocuğum: kilo | **KOORD** | Çocuk Sağlığı / Çocuk Endokrinolojisi | YENİ | çocuk kilo; çocukta obezite; kilo alamıyor / child weight; childhood obesity |
| 14 | `newborn-baby` | Newborn / baby follow-up | Yenidoğan / bebek takibi | **KOORD** | Çocuk Sağlığı (Neonatoloji) | YENİ | bebek takibi; yenidoğan sarılığı; bebek aşı / newborn check; baby jaundice |
| 15 | `rf-child-breathing` | Child with breathing difficulty | Çocukta nefes güçlüğü | KIRMIZI BAYRAK | Acil (112) | YENİ | çocuğum nefes alamıyor; bebek morardı; hırıltılı nefes çocuk / child can't breathe; baby turning blue |

## Diğer — `other`

Konu: **6** · kırmızı bayrak: 4 · yeni: 6 · koordinatöre giden: 5

| # | slug | EN | TR | Eşleme | targetSpecialtyHint | Durum | Örnek eş anlamlılar (TR / EN) |
|---|---|---|---|---|---|---|---|
| 1 | `dialysis-access` | Dialysis fistula / access problems | Diyaliz fistülü sorunları | IR 100 | — | mevcut | fistül tıkanması; diyaliz damar yolu; av fistül; fistül çalışmıyor / av fistula; dialysis access; blocked fistula |
| 2 | `something-else` | Something else | Başka bir konu | **KOORD** | — | mevcut |  /  |
| 3 | `infectious-disease` | Infections (incl. sexually transmitted) | Enfeksiyon hastalıkları | **KOORD** | Enfeksiyon Hastalıkları | YENİ | enfeksiyon; cinsel yolla bulaşan; hiv; zührevi / infectious disease; STI; HIV |
| 4 | `medical-tourism-planning` | Treatment in Istanbul — planning | İstanbul'da tedavi planlama | **KOORD** | Koordinatör | YENİ | tedavi planı; istanbul'a gelmek; konaklama / treatment planning; travel for treatment |
| 5 | `second-opinion-surgery` | Surgery recommended — second opinion | Ameliyat önerildi, ikinci görüş | **KOORD** | İlgili uzmanlık (koordinatör belirler) | YENİ | ameliyat önerildi; ikinci görüş ameliyat / surgery recommended; second opinion |
| 6 | `sleep-medicine` | Sleep disorders (beyond insomnia) | Uyku bozuklukları | **KOORD** | Uyku Bozuklukları / Nöroloji | YENİ | narkolepsi; huzursuz bacak; gündüz uyuklama / narcolepsy; restless legs; daytime sleepiness |
| 7 | `rf-severe-allergy` | Severe allergic reaction | Ciddi alerjik reaksiyon | KIRMIZI BAYRAK | — | mevcut | dilim şişti; boğazım kapanıyor; anafilaksi; dudaklarım şişti / throat swelling; anaphylaxis; tongue swelling |
| 8 | `rf-severe-bleeding` | Severe bleeding | Şiddetli kanama | KIRMIZI BAYRAK | — | mevcut | durmayan kanama; kan kusma; kan kusuyorum; çok kan kaybediyorum / heavy bleeding; vomiting blood; bleeding won't stop |
| 9 | `rf-poisoning` | Poisoning | Zehirlenme | KIRMIZI BAYRAK | Acil (112) | YENİ | zehirlendi; ilaç içti; çamaşır suyu içti; mantar zehirlenmesi / poisoning; swallowed pills; overdose |
| 10 | `rf-severe-burn` | Severe burn | Ağır yanık | KIRMIZI BAYRAK | Acil (112) | YENİ | ağır yanık; büyük yanık; kaynar su döküldü / severe burn; large burn |
