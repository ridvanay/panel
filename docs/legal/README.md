# Yasal metinler (TR + EN)

Bu klasördeki metinler sitedeki yasal sayfaların içeriğidir. Sayfalara `backend/scripts/publish-legal-pages.ts` scripti ile yüklenir (Paket J).

| Dosya | Sitedeki sayfa (slug) |
| --- | --- |
| `kvkk-aydinlatma-metni.tr.md` / `.en.md` | `kvkk-aydinlatma-metni-2` |
| `acik-riza-metni.tr.md` / `.en.md` | `acik-riza-metni-2` |
| `kullanim-kosullari.tr.md` / `.en.md` | `kullanim-kosullari-2` |
| `mesafeli-hizmet-sozlesmesi.tr.md` / `.en.md` | `distance-service-agreement` |

## Yer tutucular

Metinlerde `{{...}}` biçiminde yer tutucular var. Bunların değerleri `values.json` dosyasına yazılır. Değeri boş kalan bir yer tutucu varken script **gerçek yükleme yapmaz**.

| Yer tutucu | Ne yazılacak |
| --- | --- |
| `SIRKET_UNVANI` | Şirketin resmi unvanı (veri sorumlusu) |
| `ADRES` | Açık adres |
| `TELEFON` | İletişim telefonu |
| `SUNUCU_KONUMU` | Sunucu firması ve ülke. Örnek TR metni: "Almanya (Hetzner)". Örnek EN metni: "Germany (Hetzner)". Yurt dışıysa hukuk danışmanı aktarım dayanağını eklemeli. |

`SUNUCU_KONUMU` iki dilde farklı yazıldığı için `values.json` her yer tutucuyu `tr` ve `en` olarak ayrı tutar.

## Durum

- **Bölüm 7, "Görüşmelerin kalite kontrolü":** Hukuk danışmanı onayladı. Saklama süresi 2 yıl, başvuru adresi info@wmhealthistanbul.com.
- **Metinlerin geri kalanı:** Taslak. Yayımlanmadan önce hukuk danışmanı tamamını okumalı. Özellikle şu konulara bakmalı:
  - sağlık verisinin hukuki dayanağı
  - yurt dışı aktarım
  - uzaktan sağlık hizmeti mevzuatı (Uzaktan Sağlık Hizmetlerinin Sunumu Hakkında Yönetmelik) kapsamında izin ve yetki durumu
  - cayma hakkı istisnası
  - yurt dışındaki tüketiciler
