import { type Page, expect } from "@playwright/test";

/**
 * qa-agent — Grid görevi (2026-09-14) Görev 1 (`booking-wizard.tsx`) — bu dosya İKİNCİ kez
 * güncelleniyor. Eski hâli (bkz. git geçmişi) `IdentityStepDialog`'u (bir `Dialog`/`role="dialog"`)
 * scope alıyordu; frontend-agent bu turda o modalı TAMAMEN KALDIRDI — "Hasta & Kimlik" artık
 * `/doctors/[slug]` sihirbazının 3. ADIMI, `booking-identity-step.tsx`'in kök `<form
 * data-testid="booking-identity-step">`'u İÇİNDE, sayfanın kendi akışında render edilir (DIALOG
 * DEĞİL). Alan `id`/`label`'ları (`identityNumber`/"T.C. Kimlik Numarası", "Gün"/"Ay"/"Yıl",
 * `identityConsent`) BİREBİR KORUNDU — bu dosya yalnızca SCOPE'u `dialog` yerine `booking-identity-
 * step` `data-testid`'ine çevirir.
 *
 * İKİNCİ, daha büyük bir mimari fark: eski akışta ad-soyad/e-posta ayrı bir üst formda dolduruluyor,
 * "Randevu Oluştur" tıklanınca modal AÇILIYORDU. Yeni akışta "Ad soyad"/"E-posta" alanları da AYNI
 * `booking-identity-step.tsx` formunun İÇİNDEDİR (`booking-wizard.tsx`'in 2. adımdan "Devam Et" ile
 * 3. adıma GEÇİŞİ zaten kendi başına tetikler, ayrı bir "Randevu Oluştur" butonu YOKTUR) — bu yüzden
 * `fillBookingIdentityStep()` şimdi `patientName`/`patientEmail`'i de doldurur.
 *
 * Sağ sütundaki "Hizmet Özeti" panelinin (`doctor-service-summary.tsx`) TEK "Devam Et" butonu HEM
 * adım 2→3 geçişini HEM adım 3'ün gerçek `POST /appointments/bookings` gönderimini (bu formun
 * `<form>`'unu `requestSubmit()` ile tetikleyerek) yapar — `continueBookingWizard()` bu butonu
 * tıklar, hangi adımda olduğuna bakmaksızın (davranış tamamen `booking-wizard.tsx`'in
 * `handleContinueClick()`'ine bağlıdır, bu yardımcı KENDİ adım mantığını İCAT ETMEZ).
 *
 * qa-agent bulgusu (bu turda, düzeltildi) — `doctor-service-summary.tsx` "Devam Et" butonunu İKİ
 * YERDE render eder: masaüstü sticky panel (`<aside>` içi) VE mobil sabit alt çubuk (`lg:hidden`,
 * CSS ile gizlenir ama koşullu RENDER edilmez). Alt çubuğun kök `div`'i `aria-hidden={!barVisible}`
 * taşır — panel scroll'la görünüm dışına ÇIKMADIĞI sürece (bu dosyanın tüm çağıranlarının tipik
 * akışında panel HER ZAMAN görünür durur) bu `aria-hidden` `true` kalır ve Playwright'ın erişilebilirlik
 * ağacı tabanlı `getByRole` sorgusu o butonu OTOMATİK DIŞLAR — yine de savunmacı olmak için `.first()`
 * kullanılır (iki buton da erişilebilir hâle gelse dahi DOM sırasında İLK olan masaüstü panelin
 * butonudur).
 */
const VALID_TEST_TR_IDENTITY_NUMBER = "10000000146";

export interface FillBookingIdentityStepOptions {
  /** Varsayılan "QA E2E Test Hastası". */
  patientName?: string;
  patientEmail: string;
  /** Varsayılan 1990 (yetişkin, `MIN_IDENTITY_AGE_YEARS=18` sınırının rahatça üzerinde). */
  birthYear?: number;
  /** Varsayılan 1 (Ocak). */
  birthMonth?: number;
  /** Varsayılan 1. */
  birthDay?: number;
  identityNumber?: string;
}

/**
 * "Hasta & Kimlik" adımının (`data-testid="booking-identity-step"`) GÖRÜNÜR olmasını bekler,
 * ad-soyad/e-posta + T.C. sekmesini (varsayılan aktif sekme) geçerli bir kimlik numarası + yetişkin
 * doğum tarihi + KVKK onayıyla doldurur — "Devam Et"e TIKLAMAZ, çağıran taraf hata senaryoları için
 * `canContinue`/buton durumunu ayrıca doğrulayabilsin diye. Tam akış için `continueBookingWizard()`
 * ile BİRLİKTE kullanılır (bkz. `submitBookingIdentityStep()`).
 */
export async function fillBookingIdentityStep(page: Page, opts: FillBookingIdentityStepOptions): Promise<void> {
  const form = page.getByTestId("booking-identity-step");
  await expect(form).toBeVisible({ timeout: 15_000 });

  // qa-agent bulgusu (bu turda, kök nedeni bulunup düzeltildi) — `{ exact: true }` BURADA
  // KULLANILAMAZ: "Ad soyad"/"E-posta" `Field`'ları `required` olduğundan `label`'ın İÇİNDE
  // `aria-hidden="true"` bir "*" `<span>`'i VAR (`components/ui/field.tsx`); bu span görsel/erişilebilirlik
  // açısından "gizli" olsa da Playwright'ın `getByLabel` eşleştirmesi `<label>` KÖKÜNÜN HAM
  // `textContent`'ini kullanır (`aria-hidden`'ı YOK SAYMAZ) — yani gerçek etiket metni "Ad soyad*"/
  // "E-posta*"dır, `exact: true` "Ad soyad"/"E-posta" (yıldızsız) ile ASLA eşleşmez (0 eleman,
  // ilk koşumda GÖZLEMLENDİ: `fill()` sessizce elemanın "belirmesini" bekleyip zaman aşımına düşüyordu
  // — DOM'da alan GERÇEKTEN vardı/doluydu görünüyordu, sorun SEÇİCİDEYDİ). Doğru düzeltme: `exact`
  // YERİNE ÇAPALANMIŞ (başlangıç-sabit) bir regex — hem "*" son ekiyle eşleşir HEM KVKK onay
  // metnindeki alt-dize ("...ad-soyad, e-posta, ...", TİRELİ, "Ad soyad"/"E-posta" İLE ZATEN
  // eşleşmiyordu ama regex yine de daha SAĞLAM) ile KARIŞMAZ.
  await form.getByLabel(/^Ad soyad/).fill(opts.patientName ?? "QA E2E Test Hastası");
  await form.getByLabel(/^E-posta/).fill(opts.patientEmail);

  await form.getByLabel("T.C. Kimlik Numarası").fill(opts.identityNumber ?? VALID_TEST_TR_IDENTITY_NUMBER);
  await form.getByLabel("Gün").selectOption(String(opts.birthDay ?? 1));
  // `exact: true` ZORUNLU — "Ay" alt-dize araması KVKK onay metnindeki "Ayd*ınlatma*" ile KARIŞIR
  // (eski `telehealth-identity-ui.ts`'teki AYNI qa-agent bulgusu, dialog KALKTIKTAN SONRA da geçerli
  // kaldı — metin `booking-identity-step.tsx`'e AYNEN taşındı). "Gün"/"Ay"/"Yıl" `aria-label` İLE
  // etiketlenir (`Field`/`required` SARMALAYICISI YOK) — asterisk sorunu bu üç alanı ETKİLEMEZ.
  await form.getByLabel("Ay", { exact: true }).selectOption(String(opts.birthMonth ?? 1));
  await form.getByLabel("Yıl").selectOption(String(opts.birthYear ?? 1990));
  // `Checkbox` gerçek etkileşimli kökü `id="identityConsent"` DEĞİL (base-ui deseni, `label[for=]`
  // tıklaması her tarayıcıda checkbox'ı değiştirir — `telehealth-public-booking.spec.ts`'in eski
  // `label[for="consent"]` deseniyle AYNI ilke).
  await form.locator('label[for="identityConsent"]').click();
}

/** Sağ "Hizmet Özeti" panelinin TEK "Devam Et" butonuna tıklar — bkz. dosya başı yorumu (İKİ
 * render konumu, `.first()` + `aria-hidden` ile ayrıştırılır). Adım 2'de "en az 1 slot seçili",
 * adım 3'te "kimlik formu geçerli" koşulu sağlanmadan `disabled` kalır — çağıran taraf bu fonksiyonu
 * çağırmadan ÖNCE ilgili koşulu KENDİSİ sağlamalıdır (bu yardımcı doğrulama mantığını İCAT ETMEZ). */
export async function continueBookingWizard(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: "Devam Et" }).first();
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
}

/** `fillBookingIdentityStep()` + `continueBookingWizard()` — GERÇEK `POST /appointments/bookings`
 * çağrısını tetikler (booking'in başarıyla oluşana/adım 4'e geçene kadar BEKLEMEZ, çağıran taraf
 * sonucu — booking özeti VEYA `422` alan hatası — kendi assertion'ıyla doğrular). */
export async function submitBookingIdentityStep(page: Page, opts: FillBookingIdentityStepOptions): Promise<void> {
  await fillBookingIdentityStep(page, opts);
  await continueBookingWizard(page);
}
