# Paket Z2: Konu planı kuralları (kullanıcı kararları, 2026-11-01)

Bu kurallar `2026-10-30-Z-blog-yenileme-100-yazi.md` dosyasındaki Z2 bölümüne eklenir. Çelişki olursa bu dosya geçerlidir.

## Sıra
1. Önce **Z1-ek** (`2026-11-01-Z1-ek-blog-tasarim.md`) bitecek, raporlanacak ve canlıya alınacak.
2. Konu planı ondan sonra hazırlanır: `docs/prompts/2026-10-30-Z-konu-plani.md`. Plan onaylanmadan yazı yazılmaz.

## Canlı veri (2026-11-01 sorgu sonuçları)
Ham sorgu çıktısı kullanıcı tarafından ayrıca iletilir. Özet:
- **Aktif hekimler (8).** "test" profili canlıda pasife alındı, **hiçbir yerde kullanılmaz.**

  | Hekim (slug) | Unvan | Uzmanlık |
  |---|---|---|
  | kamil-ozdil | Prof. Dr. | gastroenterology |
  | ayse-zehra-ozdemir-kaya | Assoc. Prof. Dr. | ivf-and-reproductive-health |
  | ali-firat | Prof. Dr. | interventional-radiology-specialist |
  | hakan-sofu | Prof. Dr. | obesity-and-metabolic-surgery |
  | vahit-mutlu (kurucu) | Assoc. Prof. Dr. | obesity-and-metabolic-surgery |
  | kadir-kolcuoglu | Dr. | orthodontist |
  | hasan-tuna-turkmen | Op. Dr. | plastic-and-aesthetic-surgery |
  | dogukan-yildirim | Prof. Dr. | surgical-oncology |

- **Aktif hekimi olmayan uzmanlıklar:** dentalcare, hair-transplantation, neurosurgery, thoracic-surgery, ercp, esd, poem.
- **Aktif paketler:** executive-check-up, cardiac-check-up, cancer-screening, womens-check-up, longevity-assessment, dermal-filler-botox, dental-check-cleaning, therapeutic-massage.

## Kurallar
- Yazılar yalnızca **aktif hekimi olan** uzmanlıklarda yazılır. Her yazının inceleyen hekimi o uzmanlıktan olur. Hekim yükü dengeli dağıtılır; kurucu dahil hiçbir hekime yığılmaz.
- **ERCP, ESD, POEM** ve diğer gastro işlemleri gastroenteroloji hekimine (kamil-ozdil) atanır.
- **Diş:** Şimdilik yalnızca ortodonti kapsamı (diş teli, şeffaf plak, ısırık/çene hizası); inceleyen hekim kadir-kolcuoglu.
- Hekimi olmayan uzmanlıklar için yazı yok: saç ekimi, beyin cerrahisi, göğüs cerrahisi, nöroloji vb. "Beklemede" bölümündekiler bu kuralın istisnasıdır.
- **Paket bağlantıları:** executive-check-up, cancer-screening, longevity-assessment, womens-check-up, dermal-filler-botox.
  - cardiac-check-up ve dental-check-cleaning bağlantıları yalnızca "Beklemede" yazılarında kullanılır.
  - therapeutic-massage için yazı planlanmaz ve bağlantı verilmez; tıbbi rehber kapsamına girmiyor.
- **"Health travel to Istanbul"** rehberleri en çok 15 tane olur ve tıbbi olmayan kategoride (`isMedical=false`) yer alır.
- `isRedFlag=true` olan bakım konuları yazılara bağlanmaz.
- Bakım konusu (`careTopicIds`) yalnızca o yazının uzmanlığıyla eşleşen ve `isActive=true` olan konulardan seçilir.

## "Beklemede" bölümü (100'e dahil değil, şimdi yazılmaz)
Planın sonunda ayrı bir bölüm olur. Hekim eklenince açılır.
- **Kardiyoloji (8–10 başlık).** İnceleyen hekim: "kardiyolog (eklenecek)". Paket bağlantısı cardiac-check-up.
- **Genel diş (8–10 başlık):** implant, kanal, beyazlatma, gülüş tasarımı vb. İnceleyen hekim: "diş hekimi (eklenecek)". Paket bağlantısı dental-check-cleaning.
