"use client";

import type { DoctorCvEntry, DoctorProfile, DoctorPublication } from "@/lib/api/types";
import { DoctorAboutEditor } from "@/components/site/telehealth/doctor-about-editor";
import { DoctorCvEntriesEditor } from "@/components/site/telehealth/doctor-cv-entries-editor";
import { DoctorPublicationsEditor } from "@/components/site/telehealth/doctor-publications-editor";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * 2026-10-18 (Paket A4) — doktorun "Profilim" formu (`doctor-profile-panel.tsx`) ile admin doktor
 * formlarının (`app/admin/telehealth/doctors/new` ve `[doctorId]`) ORTAK CV alanları. Zengin metin/
 * dizi editörleri RHF dışında `useState` ile yönetildiğinden (proje deseni) bileşenler kontrollüdür.
 */

export const DOCTOR_LANGUAGE_OPTIONS = ["tr", "en", "de", "fr", "es", "ar"] as const;

export interface DoctorCvFormValue {
  subSpecialty: string;
  /** `<input type="number">` metni — boş = `null`. */
  practiceStartYear: string;
  aboutHtml: string;
  cvEntries: DoctorCvEntry[];
  publications: DoctorPublication[];
}

export type DoctorCvFieldErrors = Partial<Record<"subSpecialty" | "practiceStartYear", string>>;

export function emptyDoctorCvValue(): DoctorCvFormValue {
  return { subSpecialty: "", practiceStartYear: "", aboutHtml: "", cvEntries: [], publications: [] };
}

export function doctorCvValueFromProfile(
  doctor: Pick<DoctorProfile, "subSpecialty" | "practiceStartYear" | "aboutHtml" | "cvEntries" | "publications">
): DoctorCvFormValue {
  return {
    subSpecialty: doctor.subSpecialty ?? "",
    practiceStartYear: doctor.practiceStartYear != null ? String(doctor.practiceStartYear) : "",
    aboutHtml: doctor.aboutHtml ?? "",
    cvEntries: doctor.cvEntries,
    publications: doctor.publications,
  };
}

/** İstek gövdesi parçası — boş metinler `null`, yıl sayıya çevrilir. Backend aynı alanları sanitize eder. */
export function toDoctorCvPayload(value: DoctorCvFormValue) {
  const subSpecialty = value.subSpecialty.trim();
  const aboutHtml = value.aboutHtml.trim();
  const year = value.practiceStartYear.trim();
  return {
    subSpecialty: subSpecialty ? subSpecialty : null,
    aboutHtml: aboutHtml ? aboutHtml : null,
    practiceStartYear: year ? Number(year) : null,
    cvEntries: value.cvEntries,
    publications: value.publications,
  };
}

const PUBLICATION_FIELD_LABELS: Record<string, string> = {
  kind: "Tür",
  title: "Başlık",
  venue: "Dergi/Kongre/Kitap Adı",
  authors: "Yazarlar",
  year: "Yıl",
  doi: "DOI",
  url: "URL",
};

const CV_ENTRY_FIELD_LABELS: Record<string, string> = {
  kind: "Tür",
  title: "Başlık",
  organization: "Kurum",
  location: "Konum",
  startYear: "Başlangıç Yılı",
  endYear: "Bitiş Yılı",
  description: "Açıklama",
};

/**
 * Sunucu `cvEntries.0.doi` gibi dizin-içi anahtarlarla döner (bkz. backend `flattenZodIssues`) —
 * dizi editörleri RHF'e register edilmediği için okunabilir Türkçe metne çevrilip listelenir.
 */
export function describeArrayItemError(field: string, message: string): string | null {
  const match = field.match(/^(publications|cvEntries)\.(\d+)\.(.+)$/);
  if (!match) return null;
  const [, listKey, indexStr, subField] = match;
  const index = Number(indexStr) + 1;
  const listLabel = listKey === "publications" ? "Yayın" : "Özgeçmiş";
  const fieldLabels = listKey === "publications" ? PUBLICATION_FIELD_LABELS : CV_ENTRY_FIELD_LABELS;
  return `${listLabel} ${index} - ${fieldLabels[subField!] ?? subField}: ${message}`;
}

export function describeArrayItemErrors(fieldErrors: Record<string, string>): string[] {
  return Object.entries(fieldErrors)
    .map(([field, message]) => describeArrayItemError(field, message))
    .filter((message): message is string => message !== null);
}

/** Alt branş + mesleğe başlama yılı — çağıranın "Kurumsal Bilgiler" kartına yerleşir. */
export function DoctorCvBasicFields({
  value,
  onChange,
  errors = {},
}: {
  value: DoctorCvFormValue;
  onChange: (patch: Partial<DoctorCvFormValue>) => void;
  errors?: DoctorCvFieldErrors;
}) {
  return (
    <>
      <Field id="subSpecialty" label="Alt Branş / Bağlı Merkez (opsiyonel)" error={errors.subSpecialty}>
        {(inputProps) => (
          <Input
            {...inputProps}
            maxLength={120}
            placeholder="Örn. Girişimsel Kardiyoloji"
            value={value.subSpecialty}
            onChange={(e) => onChange({ subSpecialty: e.target.value })}
          />
        )}
      </Field>
      <Field
        id="practiceStartYear"
        label="Mesleğe Başlama Yılı (opsiyonel)"
        error={errors.practiceStartYear}
        hint="Deneyim rozeti bu yıldan otomatik hesaplanır."
      >
        {(inputProps) => (
          <Input
            {...inputProps}
            type="number"
            min={1950}
            max={new Date().getUTCFullYear()}
            value={value.practiceStartYear}
            onChange={(e) => onChange({ practiceStartYear: e.target.value })}
          />
        )}
      </Field>
    </>
  );
}

/** Hakkında (zengin metin) + özgeçmiş + yayınlar — her biri `sectionClassName` ile sarılan ayrı bölüm. */
export function DoctorCvRichSections({
  value,
  onChange,
  sectionClassName,
}: {
  value: DoctorCvFormValue;
  onChange: (patch: Partial<DoctorCvFormValue>) => void;
  sectionClassName: string;
}) {
  return (
    <>
      <div className={sectionClassName}>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Doktor Hakkında (uzun biyografi)</h2>
          <p className="text-xs text-foreground/50">“Doktor Hakkında” sekmesinde kısa özetin altında gösterilir.</p>
        </div>
        <DoctorAboutEditor content={value.aboutHtml} onChange={(aboutHtml) => onChange({ aboutHtml })} />
      </div>

      <div className={sectionClassName}>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Özgeçmiş</h2>
          <p className="text-xs text-foreground/50">Eğitim, deneyim, sertifika, üyelik ve ödüller — eklendiği SIRAYLA gösterilir.</p>
        </div>
        <DoctorCvEntriesEditor entries={value.cvEntries} onChange={(cvEntries) => onChange({ cvEntries })} />
      </div>

      <div className={sectionClassName}>
        <div>
          <h2 className="text-sm font-semibold text-foreground">Bilimsel Yayınlar</h2>
          <p className="text-xs text-foreground/50">Makale, bildiri, kitap bölümü ve diğer yayınlar — türüne göre gruplanarak gösterilir.</p>
        </div>
        <DoctorPublicationsEditor publications={value.publications} onChange={(publications) => onChange({ publications })} />
      </div>
    </>
  );
}

/** Konuşulan diller — kontrollü onay kutuları (en fazla 6, backend `LANGUAGES_SCHEMA`). */
export function DoctorLanguagesField({ value, onChange, error }: { value: string[]; onChange: (next: string[]) => void; error?: string }) {
  return (
    <div>
      <span className="block text-sm font-medium text-foreground">
        Konuşulan Diller <span className="text-danger">*</span>
      </span>
      <div className="mt-1.5 flex flex-wrap gap-3">
        {DOCTOR_LANGUAGE_OPTIONS.map((lang) => (
          <label key={lang} className="flex items-center gap-1.5 text-sm text-foreground/80">
            <input
              type="checkbox"
              checked={value.includes(lang)}
              onChange={(e) => onChange(e.target.checked ? [...value, lang] : value.filter((v) => v !== lang))}
            />
            {lang.toUpperCase()}
          </label>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
