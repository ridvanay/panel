import { type Page, expect } from "@playwright/test";

/**
 * qa-agent — `.claude/architect-scope-doctor-portfolio-identity-console.md` (**[DPI]**) §2.6 —
 * booking formunun ("Ad soyad"/"E-posta") "Randevu Oluştur" submit'i artık booking'i DOĞRUDAN
 * OLUŞTURMAZ, `IdentityStepDialog`'u (`identity-step-dialog.tsx`) AÇAR; GERÇEK
 * `POST /appointments/bookings` çağrısı yalnızca bu modalın "Devam Et"iyle tetiklenir.
 *
 * qa-agent bulgusu (regresyon, bu turda tespit edildi): `telehealth-public-booking.spec.ts`
 * (madde 8) ve `telehealth-multi-slot-booking.spec.ts` bu turdan ÖNCE yazılmıştı ve İKİ konuda
 * ARTIK YANLIŞ varsayım taşıyordu — (a) buton adı "Randevuyu Onayla" DEĞİL artık "Randevu
 * Oluştur"dur, (b) KVKK onay kutusu (`label[for="consent"]`) ana formda ARTIK YOKTUR, `identity-
 * step-dialog.tsx`'in İÇİNE (`id="identityConsent"`) TAŞINMIŞTIR. Bu bilinçli, onaylanmış bir UI
 * akışı değişikliğidir ([DPI] §2.6, backend/frontend-agent TAMAMLADI, security/compliance PASS) —
 * bug DEĞİLDİR; bu dosya SADECE mevcut e2e testlerini YENİ akışa uyarlar (proje kökü CLAUDE.md
 * "qa-agent: kıran değişiklikleri e2e'de günceller" — kendi test kod tabanı, uygulama kodu
 * DEĞİL). Her iki spec dosyası da bu paylaşılan yardımcıyı kullanacak şekilde güncellendi.
 *
 * `support/telehealth-fixtures.ts::VALID_TEST_TR_IDENTITY` İLE AYNI test TCKN'si (`10000000146`,
 * gerçek sağlama toplamını GEÇER, repdigit DEĞİL) — istemci tarafı `isValidTurkishIdentityNumber`
 * kopyası (`lib/telehealth-identity.ts`) bunu da doğrular, bu yüzden "Devam Et" butonu GERÇEKTEN
 * etkinleşir (sahte/rastgele bir numarayla test SESSİZCE modalda TAKILI kalırdı).
 */
const VALID_TEST_TR_IDENTITY_NUMBER = "10000000146";

export interface FillIdentityStepDialogOptions {
  /** Varsayılan 1990 (yetişkin, `MIN_IDENTITY_AGE_YEARS=18` sınırının rahatça üzerinde). */
  birthYear?: number;
  /** Varsayılan 1 (Ocak). */
  birthMonth?: number;
  /** Varsayılan 1. */
  birthDay?: number;
  identityNumber?: string;
}

/**
 * "Kimlik Bilgileri" modalının GÖRÜNÜR olmasını bekler, T.C. sekmesini (varsayılan aktif sekme)
 * geçerli bir kimlik numarası + yetişkin doğum tarihi + KVKK onayıyla doldurur — modalı KAPATMAZ
 * ("Devam Et"e TIKLAMAZ), çağıran taraf hata senaryoları için `canContinue`/rozet durumunu ayrıca
 * doğrulayabilsin diye. Tam akış için `submitIdentityStepDialog()` ile BİRLİKTE kullanılır.
 */
export async function fillIdentityStepDialogTrTab(page: Page, opts: FillIdentityStepDialogOptions = {}): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Kimlik Bilgileri" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  // qa-agent bulgusu (kendi testinde, düzeltildi) — `page.getByLabel("Ay")` DIALOG'a SCOPE
  // EDİLMEDEN çağrılırsa `AvailabilityCalendar`'ın "Önceki ay"/"Sonraki ay" `aria-label`'lı
  // düğmeleriyle (alt-dize eşleşmesi) STRICT MODE ihlaline düşer — modal AÇIKKEN takvim ARKA
  // PLANDA hâlâ DOM'dadır. Tüm alanlar bu yüzden `dialog` KÖKÜNDEN sorgulanır.
  // qa-agent bulgusu (kendi testinde, İKİNCİ bir düzeltme) — `exact: true` "T.C. Kimlik Numarası"/
  // "Gün"/"Yıl" alanlarında (`required` `Field`'ların `aria-hidden` "*" işaretiyle birlikte) hiçbir
  // eşleşme BULAMAYIP sessizce 120sn zaman aşımına düşüyordu — yalnızca kısa/tehlikeli alt-dizeye
  // sahip "Ay" İÇİN `exact: true` KORUNUR, diğerleri normal (varsayılan alt-dize) eşleşmeye döner.
  await dialog.getByLabel("T.C. Kimlik Numarası").fill(opts.identityNumber ?? VALID_TEST_TR_IDENTITY_NUMBER);
  await dialog.getByLabel("Gün").selectOption(String(opts.birthDay ?? 1));
  // `exact: true` ZORUNLU — KVKK onay metni "Ayd*ınlatma*" ile BAŞLAR, `exact` OLMAYAN alt-dize
  // araması "Ay" seçicisini KVKK onay kutusuyla (`aria-labelledby`) KARIŞTIRIR (ilk koşumda
  // GÖZLEMLENDİ: strict-mode ihlali, 5 eşleşme).
  await dialog.getByLabel("Ay", { exact: true }).selectOption(String(opts.birthMonth ?? 1));
  await dialog.getByLabel("Yıl").selectOption(String(opts.birthYear ?? 1990));
  // `Checkbox` gerçek etkileşimli kökü `id="identityConsent"` DEĞİL (`telehealth-public-
  // booking.spec.ts`'teki `label[for="consent"]` İLE AYNI base-ui deseni, bkz. o dosyanın
  // dosya-başı yorumu) — ilişkili `<label>`'a tıklamak her tarayıcıda checkbox'ı değiştirir.
  await dialog.locator('label[for="identityConsent"]').click();
}

/** `fillIdentityStepDialogTrTab()` + "Devam Et" — GERÇEK `POST /appointments/bookings` çağrısını
 * tetikler (modal başarıyla kapanana kadar BEKLEMEZ, çağıran taraf sonucu — booking özeti VEYA
 * `422` alan hatası — kendi assertion'ıyla doğrular). */
export async function submitIdentityStepDialog(page: Page, opts: FillIdentityStepDialogOptions = {}): Promise<void> {
  await fillIdentityStepDialogTrTab(page, opts);
  await expect(page.getByRole("dialog", { name: "Kimlik Bilgileri" }).getByRole("button", { name: "Devam Et" })).toBeEnabled();
  await page.getByRole("dialog", { name: "Kimlik Bilgileri" }).getByRole("button", { name: "Devam Et" }).click();
}
