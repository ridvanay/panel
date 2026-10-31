# Paket Y — API kontratı (frontend için)

Bütün yanıtlar `{ data: ... }` zarfında gelir; frontend `apiFetch` bunu açar. Uçların tamamı `/api/v1` altındadır. Herkese açık `POST` ve `DELETE` istekleri yalnızca sitenin kendi origin'inden kabul edilir (`assertSameSiteOrigin`); tarayıcıdan normal çağrı yeterli.

## Herkese açık

### `GET /doctors/:slug?locale=` (mevcut uç; iki yeni alan)

- `hospitalName: string | null`. Boşsa gösterilmez.
- `faq: { question: string; answer: string }[]`. İstenen dilde gelir; çeviri yoksa kanonik dilde. Doluysa sayfaya `FAQPage` JSON-LD eklenir.

### `GET /doctors/:slug/showcase?locale=`

```ts
{
  procedures: { id; title; description; duration; anesthesia; hospitalStay; recovery; relatedCareTopicIds: string[] }[]; // fiyat yok
  media: (
    | { id; kind: "photo"; category; title; description; alt; url; width: number|null; height: number|null }
    | { id; kind: "video"; category; title; description; alt; videoProvider: "youtube"|"vimeo"; videoId; thumbnailUrl: string|null; embedUrl: string }
  )[];
}
```

- `category` değerleri: `about | clinic | procedure | interview | before-after`. `before-after` öğeleri ayar kapalıyken sunucudan zaten gelmez.
- **Video:** Önce yalnızca `thumbnailUrl` gösterilir. YouTube için `i.ytimg.com`; Vimeo için `null`, bu durumda yer tutucu gösterilir. Kullanıcı "Oynat"a basınca `iframe src={embedUrl}` yüklenir. `embedUrl` YouTube'da `youtube-nocookie.com`, Vimeo'da `dnt=1` içerir. Oynat'a basmadan iframe olmamalı ve youtube-nocookie'ye istek gitmemeli.

### `GET /doctors/:slug/reviews?locale=&sort=newest|highest&language=&page=`

```ts
{
  summary: {
    count: number;
    average: number | null;                       // 3'ten az onaylıysa null → ortalama gösterilmez
    distribution: { "1"..."5": number } | null;   // average null ise bu da null
  };
  languages: { code; count }[];   // dil filtresi için
  page; pageSize: 10; total;
  items: {
    id; authorDisplay; displayMode: "initials"|"first_initial"|"anonymous"|"custom";
    country: string|null;           // ISO-2; ad Intl.DisplayNames ile gösterilir
    language; rating; title; body;
    translation: { title: string|null; body } | null;   // ?locale dilinde yönetici çevirisi → "Show translation" anahtarı
    verified: boolean;              // true ise "Verified patient" rozeti
    publishedAt; doctorReply: string|null;
  }[];
}
```

- `displayMode` `anonymous` ise ya da `authorDisplay` boşsa "Anonim hasta" gösterilir (sözlük).
- **`Review` ve `AggregateRating` JSON-LD EKLENMEZ.**

### `GET /reviews/featured?locale=` (anasayfa karuseli)

`{ summary (aynı kural), items: [...review item, doctor: { name; slug } | null] }`. `items` boşsa bölüm görünmez.

### Davet bağlantısıyla yorum

- `GET /reviews/invite/:token` → `{ doctorName }`. Geçersiz, kullanılmış ya da süresi dolmuş token → 404.
- `POST /reviews/invite/:token`
  - Gövde: `{ rating: 1-5, title: 3-120, body: 30-1500, displayMode: "initials"|"first_initial"|"anonymous", publishConsent: true }`
  - Başarı: 201 `{ id, status: "pending" }`.
  - Hata: 404 (geçersiz), 409 (zaten yorum var).
- Sayfa: `/[lang]/review/[token]`.

## Hasta portalı (oturum zorunlu; yalnızca kendi booking'i)

- `GET /patient/bookings/:bookingId/review` → `{ eligible: boolean, review: { id, status, rating, title, createdAt } | null }`.
- `POST /patient/bookings/:bookingId/review`: gövde davet formuyla aynı. Hata: 409 zaten var, 422 görüşme tamamlanmadı.
- `DELETE /patient/reviews/:id` → 204. "Yorumumu sil"; yorum anonimleştirilir.

## Admin

### Yorum moderasyonu (ADMIN/MANAGER) — `/admin/testimonials`

- `GET /?status=&doctorId=&page=` → `{ total, page, pageSize: 25, counts: { pending?, approved?, ... }, items: AdminTestimonial[] }`.
- `POST /`: manuel ekleme. Gövde `{ doctorId?, specialtyId?, authorDisplay, country?, language, rating, title, body, source: "manual_with_consent"|"imported", consentEvidenceNote (min 10, zorunlu), consentAt? }`.
- `POST /:id/status` `{ status: "approved"|"rejected"|"hidden" }`.
- `POST /:id/redact` `{ field: "title"|"body", snippet }`: parça `█` ile maskelenir. Metin başka şekilde **düzenlenemez**; düzenleme alanı yoktur.
- `PATCH /:id` `{ translations?: { "<dil>": { title, body } }, featuredOnHome?, doctorReply? }`.
- `POST /:id/remove`: hasta isteğiyle anonimleştirme.

`AdminTestimonial` alanları:

```
id, doctorId, doctorName, specialtyId, bookingId, authorDisplay, displayMode, country, language,
rating, title, body, translations, source, verified, consentAt, consentEvidenceNote, status,
moderatedAt, redactionCount, featuredOnHome, publishedAt, doctorReply, anonymizedAt, createdAt
```

### Hekim vitrini (ADMIN/MANAGER) — `/admin/telehealth/doctors/:doctorId`

**İşlemler** (`/procedures`): `GET`, `POST`, `PUT /:id`, `DELETE /:id`.

```
{ translations: { "<dil>": { title (zorunlu), description, duration, anesthesia, hospitalStay, recovery } },
  relatedCareTopicIds: uuid[], sortOrder, isPublished }
```

**Medya** (`/media`): `GET`, `POST`, `PUT /:id`, `DELETE /:id`.

```
{ kind: "photo"|"video", mediaId? (photo), videoProvider?: "youtube"|"vimeo", videoId?,
  category, translations: { "<dil>": { title, description, alt } }, showsPatient,
  patientConsentConfirmed, consentNote, isPublished, sortOrder }
```

Kurallar:
- Fotoğrafta `mediaId` ve en az bir dilde `alt` zorunlu.
- YouTube kimliği 11 karakter, Vimeo kimliği sayısal.
- `before-after` kategorisi ya da `showsPatient=true` olan öğe, `patientConsentConfirmed` olmadan yayınlanamaz (422). Onay kutusu işaretliyse `consentNote` zorunlu.
- Admin formunda şu not bulunur: "Büyük videoları sunucuya yüklemeyin; YouTube/Vimeo'ya yükleyip bağlantısını girin."

### Önce/sonra ayarı — `/admin/telehealth/settings/doctor-media`

- `GET` → `{ beforeAfterEnabled }`
- `PUT { beforeAfterEnabled }`: yalnızca ADMIN. Varsayılan `false`.

### Hekim kaydı (mevcut `POST/PATCH /admin/telehealth/doctors`)

Yeni alanlar:
- `hospitalName?: string|null` (≤160)
- `faq?: { question ≤200, answer ≤2000 }[]` (en çok 20, HTML yok)

## Randevu

`POST /appointments/bookings` gövdesine `locale?: string` eklenir: hastanın **aktif site dili** (`[lang]`). Booking wizard bunu gönderir. Randevu kurallarına etkisi yoktur.
