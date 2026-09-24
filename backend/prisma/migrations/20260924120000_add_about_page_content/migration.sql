-- "Hakkımızda" (About Us) sayfasının CMS kaydı — YALNIZCA VERİ ekleyen migration (şema değişikliği YOK).
-- Tek bir SQL ifadesidir.
--
-- Varsayılan dilden BAĞIMSIZDIR — varsayılan dil `locales` tablosundan (`isDefault = true`) okunur:
--   * Varsayılan dil `en` → ana alanlar (title, blocks, seoTitle, seoDescription) İngilizce,
--     `translations.tr` Türkçe.
--   * Varsayılan dil `tr` → ana alanlar Türkçe, `translations.en` İngilizce.
--   * Varsayılan dil `en`/`tr` dışında bir dilse (veya tanımlı değilse) HİÇBİR ŞEY eklenmez.
--
-- Ne ekler (yalnızca yukarıdaki koşul sağlanırsa):
--   * `pages` tablosuna `slug = 'about'` olan TEK bir kayıt: PUBLISHED, editMode = TEMPLATE, blocks =
--     tek bir `about-page` bloğu. İçerik, frontend sözlüklerinin
--     (`frontend/src/lib/i18n/site-dictionaries/{tr,en}/about.ts`) bu migration yazıldığı andaki
--     metinleriyle birebir aynıdır (eşitlik birim testiyle korunur: `tests/unit/about-page-migration.test.ts`).
--   * Yalnızca bu kayıt GERÇEKTEN eklendiyse: etkin olan `en` ve `tr` dilleri için `content_slugs`
--     satırları (slug `about`).
--
-- Güvenlik (idempotent, ezmez, silmez):
--   * `slug = 'about'` olan bir sayfa ZATEN varsa (çöp kutusundakiler dahil) HİÇBİR ŞEY yapmaz.
--   * UPDATE / DELETE içermez; `pages` ve `content_slugs` dışında hiçbir tabloya yazmaz
--     (`locales` yalnızca OKUNUR).
--   * `content_slugs` çakışmasında (aynı dilde başka bir içerik `about` slug'ını kullanıyorsa)
--     `ON CONFLICT DO NOTHING` — sayfa yine çalışır, yalnızca o dilin slug satırı eklenmez.
--   * Etkin olmayan / tanımlı olmayan dil için slug satırı eklenmez (FK hatası oluşmaz).
--
-- Geri alma: kayıt admin → Sayfalar'dan silinebilir; sayfa o durumda sözlük metinlerine döner.
-- Bu migration `_prisma_migrations`'a kaydedildiği için bir daha çalışmaz.

WITH content AS (
  SELECT
    $about_tr${
  "title": "Hakkımızda",
  "blocks": [
    {
      "id": "about-page-root",
      "type": "about-page",
      "data": {
        "hero": {
          "eyebrow": "WM Health Hakkında",
          "title": "Kaliteli sağlık hizmeti, sınırların ötesinde daha erişilebilir.",
          "body": "Dr. Vahit Mutlu önderliğinde kurulan WM Health, farklı ülkelerden hastaları İstanbul'da ağırlıyor. Güvenli ve bilgiye dayalı bir tedavi süreci için yüksek bakım standartlarını, açık iletişimi ve özenli koordinasyonu bir araya getiriyoruz. İlk konsültasyondan sonraki adımların planlanmasına kadar, kaliteli sağlık hizmetini sınırların ötesinde daha erişilebilir kılmayı amaçlıyoruz.",
          "primaryCta": {
            "label": "Randevu Al",
            "href": "/doctors"
          },
          "secondaryCta": {
            "label": "Doktorlarımızla tanışın",
            "href": "#doctors"
          },
          "imageUrl": "",
          "imageAlt": "",
          "locationTitle": "İstanbul, Türkiye",
          "locationSubtitle": "Farklı ülkelerden hastaları ağırlıyoruz"
        },
        "treatments": {
          "enabled": true,
          "eyebrow": "Tedavi ettiklerimiz",
          "title": "Tedavi alanlarımız",
          "body": "Her hastanın ihtiyaçları farklıdır. Tedavi kararları, hastanın sağlık geçmişi ve hedefleri göz önünde bulundurularak yapılan bireysel tıbbi değerlendirmenin ardından verilir.",
          "items": [
            {
              "id": "treatment-1",
              "name": "Obezite ve metabolik cerrahi",
              "icon": "Scale"
            },
            {
              "id": "treatment-2",
              "name": "Cerrahi onkoloji",
              "icon": "Ribbon"
            },
            {
              "id": "treatment-3",
              "name": "Tüp bebek (IVF) ve üreme sağlığı",
              "icon": "Baby"
            },
            {
              "id": "treatment-4",
              "name": "Diş tedavileri",
              "icon": "Smile"
            },
            {
              "id": "treatment-5",
              "name": "Saç ekimi",
              "icon": "Scissors"
            },
            {
              "id": "treatment-6",
              "name": "Plastik, rekonstrüktif ve estetik cerrahi",
              "icon": "Sparkles"
            }
          ]
        },
        "approach": {
          "enabled": true,
          "eyebrow": "Yaklaşımımız",
          "title": "Neden WM Health?",
          "items": [
            {
              "id": "approach-1",
              "title": "Tıbbi Değerlendirmeye Dayalı Bakım",
              "body": "Tedavi seçenekleri, bireysel sağlık ihtiyaçlarınız doğrultusunda değerlendirilir.",
              "icon": "Stethoscope"
            },
            {
              "id": "approach-2",
              "title": "Her Adımda Açıklık",
              "body": "Önerilen tedaviyi, zaman planını ve tıbbi ekibinizle konuşmanız gereken soruları anlayın.",
              "icon": "ClipboardCheck"
            },
            {
              "id": "approach-3",
              "title": "Sınırların Ötesinde Destek",
              "body": "İstanbul'daki sağlık yolculuğunuzu, ziyaretinizden önce ve ziyaretiniz süresince rehberlik alarak planlayın.",
              "icon": "Globe"
            }
          ]
        },
        "doctors": {
          "enabled": true,
          "eyebrow": "Tıbbi ekibimiz",
          "title": "Doktorlarımızla tanışın",
          "ctaLabel": "Tüm doktorlar",
          "count": 3,
          "founderDoctorId": null,
          "founderLabel": "Kurucu"
        },
        "closing": {
          "title": "Bir konsültasyonla başlayın",
          "primaryCta": {
            "label": "Randevu Al",
            "href": "/doctors"
          },
          "secondaryCta": {
            "label": "Bize ulaşın",
            "href": "/contact"
          }
        }
      }
    }
  ],
  "seoTitle": "Hakkımızda | WM Health",
  "seoDescription": "WM Health, farklı ülkelerden hastaları İstanbul'da ağırlıyor. Tedavi alanlarımızı, yaklaşımımızı ve doktorlarımızı tanıyın."
}$about_tr$::jsonb AS tr,
    $about_en${
  "title": "About Us",
  "blocks": [
    {
      "id": "about-page-root",
      "type": "about-page",
      "data": {
        "hero": {
          "eyebrow": "About WM Health",
          "title": "Quality healthcare, more accessible across borders.",
          "body": "Founded under the leadership of Dr. Vahit Mutlu, WM Health welcomes patients from different countries to Istanbul. We bring together high standards of care, clear communication and careful coordination to support a safe and well-informed treatment journey. From the first consultation to the planning of next steps, we aim to make quality healthcare more accessible across borders.",
          "primaryCta": {
            "label": "Book a consultation",
            "href": "/doctors"
          },
          "secondaryCta": {
            "label": "Meet our doctors",
            "href": "#doctors"
          },
          "imageUrl": "",
          "imageAlt": "",
          "locationTitle": "Istanbul, Türkiye",
          "locationSubtitle": "Welcoming patients from different countries"
        },
        "treatments": {
          "enabled": true,
          "eyebrow": "What we treat",
          "title": "Our treatment areas",
          "body": "Each patient’s needs are different. Treatment decisions are made following an individual medical evaluation, with attention to the patient’s health history and goals.",
          "items": [
            {
              "id": "treatment-1",
              "name": "Obesity & metabolic surgery",
              "icon": "Scale"
            },
            {
              "id": "treatment-2",
              "name": "Surgical oncology",
              "icon": "Ribbon"
            },
            {
              "id": "treatment-3",
              "name": "IVF & reproductive health",
              "icon": "Baby"
            },
            {
              "id": "treatment-4",
              "name": "Dental care",
              "icon": "Smile"
            },
            {
              "id": "treatment-5",
              "name": "Hair transplantation",
              "icon": "Scissors"
            },
            {
              "id": "treatment-6",
              "name": "Plastic, reconstructive & aesthetic surgery",
              "icon": "Sparkles"
            }
          ]
        },
        "approach": {
          "enabled": true,
          "eyebrow": "Our approach",
          "title": "Why WM Health?",
          "items": [
            {
              "id": "approach-1",
              "title": "Care Guided by Medical Assessment",
              "body": "Treatment options are considered in light of your individual health needs.",
              "icon": "Stethoscope"
            },
            {
              "id": "approach-2",
              "title": "Clarity at Every Step",
              "body": "Understand the proposed treatment, its timeline and the questions to discuss with your medical team.",
              "icon": "ClipboardCheck"
            },
            {
              "id": "approach-3",
              "title": "Support Across Borders",
              "body": "Plan your healthcare journey in Istanbul with guidance before and during your visit.",
              "icon": "Globe"
            }
          ]
        },
        "doctors": {
          "enabled": true,
          "eyebrow": "Our medical team",
          "title": "Meet our doctors",
          "ctaLabel": "View all doctors",
          "count": 3,
          "founderDoctorId": null,
          "founderLabel": "Founder"
        },
        "closing": {
          "title": "Start with a consultation",
          "primaryCta": {
            "label": "Book a consultation",
            "href": "/doctors"
          },
          "secondaryCta": {
            "label": "Contact us",
            "href": "/contact"
          }
        }
      }
    }
  ],
  "seoTitle": "About Us | WM Health",
  "seoDescription": "WM Health welcomes patients from different countries to Istanbul. Learn about our treatment areas, our approach and our doctors."
}$about_en$::jsonb AS en
),
default_locale AS (
  SELECT "code" FROM "locales" WHERE "isDefault" = true ORDER BY "sortOrder" LIMIT 1
),
plan AS (
  SELECT
    CASE WHEN d."code" = 'en' THEN c.en ELSE c.tr END AS main,
    CASE WHEN d."code" = 'en' THEN 'tr' ELSE 'en' END AS secondary_code,
    CASE WHEN d."code" = 'en' THEN c.tr ELSE c.en END AS secondary
  FROM default_locale d
  CROSS JOIN content c
  WHERE d."code" IN ('en', 'tr')
),
inserted_page AS (
  INSERT INTO "pages" (
    "id", "title", "slug", "status", "blocks", "seoTitle", "seoDescription",
    "translations", "isLegalDocument", "editMode", "noIndex", "publishedAt", "createdAt", "updatedAt"
  )
  SELECT
    gen_random_uuid()::text,
    p.main ->> 'title',
    'about',
    'PUBLISHED',
    p.main -> 'blocks',
    p.main ->> 'seoTitle',
    p.main ->> 'seoDescription',
    jsonb_build_object(p.secondary_code, p.secondary),
    false,
    'TEMPLATE',
    false,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM plan p
  WHERE NOT EXISTS (SELECT 1 FROM "pages" WHERE "slug" = 'about')
  RETURNING "id"
)
INSERT INTO "content_slugs" ("id", "entityType", "entityId", "locale", "slug", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'PAGE', inserted_page."id", l."code", 'about', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM inserted_page
JOIN "locales" l ON l."enabled" = true AND l."code" IN ('en', 'tr')
ON CONFLICT DO NOTHING;
