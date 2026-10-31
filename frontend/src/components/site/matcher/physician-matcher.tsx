"use client";

import { cloneElement, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Baby,
  Blocks,
  Bone,
  Brain,
  CircleHelp,
  ClipboardCheck,
  Droplets,
  Ear,
  Eye,
  Flower2,
  Heart,
  HeartPulse,
  Languages,
  MessageCircle,
  PersonStanding,
  Phone,
  Ribbon,
  Search,
  Siren,
  Smile,
  Sparkles,
  Thermometer,
  Utensils,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { DualSlotLabel } from "@/components/site/telehealth/dual-time";
import { usePatientTimeZoneState } from "@/components/site/telehealth/use-patient-time-zone";
import { useLocalizePath } from "@/context/locale-alternates-context";
import { useMatcherStrings } from "@/lib/i18n/use-matcher-strings";
import { fmt } from "@/lib/i18n/use-portal-strings";
import { countryForTimeZone, countryName, formatLongDate } from "@/lib/country-display";
import { COUNTRY_DIAL_CODES } from "@/lib/country-codes";
import { fetchLegalPagesClient, resolveExplicitConsentPage, resolveKvkkNoticePage } from "@/lib/legal-pages";
import { ApiClientError } from "@/lib/api/error";
import {
  MATCHER_BODY_AREAS,
  getMatcherCatalog,
  getMatcherWhatsappDigits,
  recommendPhysicians,
  reportMatcherProgress,
  reportMatcherSearchPick,
  requestMatcherCallback,
  searchMatcherTopics,
  submitMatcher,
  type MatcherBodyArea,
  type MatcherCatalog,
  type MatcherDuration,
  type MatcherPreference,
  type MatcherPriorDiagnosis,
  type MatcherRecommendation,
  type MatcherSearchHit,
  type MatcherTopic,
} from "@/lib/api/matcher";
import { MATCHER_FREE_TEXT_MAX, MATCHER_MAX_TOPICS, bookingHref, emergencyNumberFor, prepareTopicIndex, searchTopics, topicsInText, trackMatcher } from "./matcher-helpers";
import { cn } from "@/lib/utils";

/**
 * Paket W — "Find my physician" sihirbazı (sayfa `/[lang]/find-a-physician` ve sayfa içi modal).
 * TANI KOYMAZ: yalnızca uzmanlık ve hekim önerir. Adım bilgisi URL'de (`?step=` / modalda `?finder=`),
 * geri tuşu çalışır; KİŞİSEL VERİ URL'YE GİRMEZ (şikayet, ad, iletişim yalnızca bellek + POST gövdesi).
 * Adımlar: 1 şikayet → 2 kimin için/süre → 3 tercihler → 4 iletişim → 5 sonuç. Admin ayarı
 * `contactRequired=false` ise 4. adım sonuçtan sonra ve opsiyoneldir.
 */

const BODY_AREA_ICONS: Record<MatcherBodyArea, LucideIcon> = {
  "general-symptoms": Thermometer,
  head: Brain,
  ent: Ear,
  eyes: Eye,
  "neck-spine": PersonStanding,
  chest: HeartPulse,
  "heart-vessels": Heart,
  abdomen: Utensils,
  "hormones-metabolism": Activity,
  "pelvis-urology": Droplets,
  women: Baby,
  "skin-aesthetic": Sparkles,
  dental: Smile,
  "joints-bones": Bone,
  "general-checkup": ClipboardCheck,
  cancer: Ribbon,
  "mental-wellbeing": Flower2,
  children: Blocks,
  other: CircleHelp,
};

/** Paket W-ek — bölge açılınca ilk bu kadar konu çip olarak görünür; kalanı "Daha fazla göster". */
const AREA_TOPIC_PREVIEW = 12;
const SEARCH_DEBOUNCE_MS = 200;

const SITE_LANGUAGES = ["tr", "en", "de", "fr", "es", "ru", "ar", "ro", "sr-latn"];
const TOTAL_STEPS = 5;

type Step = 1 | 2 | 3 | 4 | 5;

interface ContactForm {
  name: string;
  ageMode: "age" | "year";
  age: string;
  guardianName: string;
  email: string;
  phoneCountry: string;
  phoneNumber: string;
  country: string;
  consentHealth: boolean;
  /** Çocuk konusu seçildiyse zorunlu: "veli/vasi olarak dolduruyorum". */
  guardianDeclaration: boolean;
  consentContact: boolean;
  website: string;
}

export function PhysicianMatcher({
  mode,
  initialQuery = "",
  onClose,
  onStepPush,
}: {
  mode: "page" | "modal";
  initialQuery?: string;
  onClose?: () => void;
  /** Modal: her adım geçmişe eklendiğinde (kapanışta geçmişi geri sarmak için). */
  onStepPush?: () => void;
}) {
  const { m, lang, intlLocale } = useMatcherStrings();
  const localize = useLocalizePath();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const stepParam = mode === "page" ? "step" : "finder";
  const tz = usePatientTimeZoneState({ suggest: false });

  const [catalog, setCatalog] = useState<MatcherCatalog | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openArea, setOpenArea] = useState<MatcherBodyArea | null>(null);
  const [showAllAreaTopics, setShowAllAreaTopics] = useState(false);
  const [serverSearch, setServerSearch] = useState<{ q: string; hits: MatcherSearchHit[] } | null>(null);
  const [showFreeText, setShowFreeText] = useState(false);
  const [freeText, setFreeText] = useState("");
  const [redFlagOpen, setRedFlagOpen] = useState(false);
  const [redFlagAck, setRedFlagAck] = useState(false);
  const [forWhom, setForWhom] = useState<"self" | "relative">("self");
  const [duration, setDuration] = useState<MatcherDuration | null>(null);
  const [prior, setPrior] = useState<MatcherPriorDiagnosis | null>(null);
  const [preference, setPreference] = useState<MatcherPreference | null>(null);
  const [preferredLanguage, setPreferredLanguage] = useState(lang);
  const [countryChoice, setCountryChoice] = useState<string | null>(null);
  const [form, setForm] = useState<ContactForm>({
    name: "",
    ageMode: "age",
    age: "",
    guardianName: "",
    email: "",
    phoneCountry: "",
    phoneNumber: "",
    country: "",
    consentHealth: false,
    consentContact: false,
    guardianDeclaration: false,
    website: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stepError, setStepError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recommendation, setRecommendation] = useState<MatcherRecommendation | null>(null);
  const [submission, setSubmission] = useState<{ id: string; number: number; token: string } | null>(null);
  const [callbackPending, setCallbackPending] = useState(false);
  const [callbackDone, setCallbackDone] = useState(false);
  const [maxReached, setMaxReached] = useState<Step>(1);
  const [whatsapp, setWhatsapp] = useState("");
  const [legalLinks, setLegalLinks] = useState<{ notice: string | null; consent: string | null } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Katalog (aktif dil + EN eş anlamlıları).
  useEffect(() => {
    let cancelled = false;
    getMatcherCatalog(lang)
      .then((c) => !cancelled && setCatalog(c))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [lang]);

  const contactRequired = catalog?.contactRequired ?? true;
  const topics = useMemo(() => catalog?.topics ?? [], [catalog]);
  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const selected = selectedIds.map((id) => topicById.get(id)).filter((t): t is MatcherTopic => !!t);

  // Adım URL'den; erişilmemiş adıma doğrudan gelinirse (yenileme vb.) ulaşılan en son adım gösterilir.
  const urlStep = Number(searchParams.get(stepParam) ?? "1");
  const requested = (Number.isInteger(urlStep) && urlStep >= 1 && urlStep <= TOTAL_STEPS ? urlStep : 1) as Step;
  const step: Step = requested > maxReached ? maxReached : requested;

  // URL ile ekran ayrışmasın: erişilmemiş adım istenirse (yenileme/derin bağlantı) URL de düzeltilir.
  useEffect(() => {
    if (requested <= maxReached || !searchParams.has(stepParam)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set(stepParam, String(maxReached));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [requested, maxReached, searchParams, stepParam, router, pathname]);

  const goTo = useCallback(
    (next: Step) => {
      setMaxReached((prev) => (next > prev ? next : prev));
      const params = new URLSearchParams(searchParams.toString());
      params.set(stepParam, String(next));
      router.push(`${pathname}?${params.toString()}`, { scroll: mode === "page" });
      onStepPush?.();
    },
    [searchParams, stepParam, router, pathname, mode, onStepPush]
  );

  // Adım değişince odak başlığa (ekran okuyucu yeni adımı duyurur); ilk açılışta modalda arama kutusuna.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (mode === "modal") searchRef.current?.focus();
      return;
    }
    headingRef.current?.focus();
    headingRef.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
  }, [step, mode]);

  // Anonim adım sayacı + CRM olayı (onay varsa) — her adım bir kez.
  const reported = useRef(new Set<number>());
  useEffect(() => {
    if (reported.current.has(step)) return;
    reported.current.add(step);
    reportMatcherProgress(String(step) as "1");
    trackMatcher(step === 1 ? "matcher_start" : "matcher_step", { step });
  }, [step]);

  const detectedCountry = countryChoice ?? (countryForTimeZone(tz.timeZone) || tz.ipHint?.countryCode || "");
  const country = form.country || detectedCountry;

  // ---- Adım 1 ----
  const topicIndex = useMemo(() => prepareTopicIndex(topics), [topics]);
  const deferredQuery = useDeferredValue(query);
  const deferredFreeText = useDeferredValue(freeText);
  const localMatches = useMemo(() => searchTopics(topicIndex, deferredQuery), [topicIndex, deferredQuery]);
  const trimmedQuery = deferredQuery.trim();
  // Paket W-ek — sunucu araması (9 dilin eş anlamlıları + yazım hatası toleransı); gelene kadar yerel sonuçlar.
  useEffect(() => {
    if (trimmedQuery.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchMatcherTopics(trimmedQuery, lang)
        .then((res) => {
          if (!cancelled) setServerSearch({ q: trimmedQuery, hits: res.results });
        })
        .catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, lang]);
  const serverHits = serverSearch && serverSearch.q === trimmedQuery ? serverSearch.hits : null;
  const matchedTermById = useMemo(() => new Map((serverHits ?? []).filter((h) => h.matched).map((h) => [h.id, h.matched!])), [serverHits]);
  const matches = useMemo(
    () => (serverHits ? serverHits.map((h) => topicById.get(h.id)).filter((t): t is MatcherTopic => !!t) : localMatches),
    [serverHits, topicById, localMatches]
  );
  const listOpen = trimmedQuery.length >= 2 && matches.length > 0;
  // Bölge çipleri: popülerlik (son 90 gün seçim) azalan; eşitlikte katalog sırası. Seçili konular her zaman görünür.
  const areaTopics = useMemo(() => {
    if (!openArea) return [];
    return topics
      .map((topic, index) => ({ topic, index }))
      .filter(({ topic }) => topic.bodyArea === openArea && !topic.isRedFlag)
      .sort((a, b) => (b.topic.popularity ?? 0) - (a.topic.popularity ?? 0) || a.index - b.index)
      .map(({ topic }) => topic);
  }, [topics, openArea]);
  const visibleAreaTopics = showAllAreaTopics
    ? areaTopics
    : [...areaTopics.slice(0, AREA_TOPIC_PREVIEW), ...areaTopics.slice(AREA_TOPIC_PREVIEW).filter((t) => selectedIds.includes(t.id))];
  const textMatches = useMemo(() => (deferredFreeText.trim().length >= 3 ? topicsInText(topicIndex, deferredFreeText) : []), [topicIndex, deferredFreeText]);
  const textRedFlags = textMatches.filter((t) => t.isRedFlag);
  const textSuggestions = textMatches.filter((t) => !t.isRedFlag && !selectedIds.includes(t.id)).slice(0, 4);

  function toggleTopic(topic: MatcherTopic) {
    setStepError(null);
    if (selectedIds.includes(topic.id)) {
      setSelectedIds(selectedIds.filter((id) => id !== topic.id));
      return;
    }
    if (selectedIds.length >= MATCHER_MAX_TOPICS) {
      setStepError(m.maxTopics);
      return;
    }
    setSelectedIds([...selectedIds, topic.id]);
    if (topic.isRedFlag) openRedFlag();
  }

  function openRedFlag() {
    setRedFlagOpen(true);
    reportMatcherProgress("red_flag");
  }

  function chooseFromList(topic: MatcherTopic) {
    if (!selectedIds.includes(topic.id)) reportMatcherSearchPick(topic.slug);
    toggleTopic(topic);
    setQuery("");
    setActiveIndex(-1);
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && matches.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp" && matches.length > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const topic = matches[activeIndex] ?? (matches.length === 1 ? matches[0] : undefined);
      if (topic) chooseFromList(topic);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
      setActiveIndex(-1);
    }
  }

  function continueFromStep1() {
    if (selected.length === 0 && freeText.trim().length < 3) {
      setStepError(m.needTopic);
      return;
    }
    const hasRedFlag = selected.some((t) => t.isRedFlag) || textRedFlags.length > 0;
    if (hasRedFlag && !redFlagAck) {
      openRedFlag();
      return;
    }
    setStepError(null);
    goTo(2);
  }

  // ---- Öneri ----
  const recommendTopicIds = selected.filter((t) => !t.isRedFlag).map((t) => t.id);

  async function loadRecommendation(): Promise<MatcherRecommendation | null> {
    if (recommendTopicIds.length === 0) {
      const empty: MatcherRecommendation = { redFlag: false, redFlagTopicSlugs: [], coordinator: true, interpreterIncluded: false, topicSlugs: [], specialties: [], doctors: [] };
      setRecommendation(empty);
      return empty;
    }
    const rec = await recommendPhysicians({ topicIds: recommendTopicIds, preferredLanguage, locale: lang, preference: preference ?? undefined });
    setRecommendation(rec);
    trackMatcher("matcher_result", { doctors: rec.doctors.length, coordinator: rec.coordinator });
    if (rec.coordinator) reportMatcherProgress("no_match");
    return rec;
  }

  async function continueFromStep3() {
    if (!preference) {
      setStepError(m.required);
      return;
    }
    setStepError(null);
    if (contactRequired) {
      goTo(4);
      return;
    }
    setBusy(true);
    try {
      await loadRecommendation();
      goTo(5);
    } catch {
      setStepError(m.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  // Aydınlatma metni ve açık rıza metni bağlantıları (uyumluluk incelemesi: veri toplanmadan önce).
  useEffect(() => {
    let cancelled = false;
    fetchLegalPagesClient(lang).then((pages) => {
      if (cancelled) return;
      const notice = resolveKvkkNoticePage(pages);
      const consent = resolveExplicitConsentPage(pages);
      setLegalLinks({ notice: notice ? localize(`/${notice.slug}`) : null, consent: consent ? localize(`/${consent.slug}`) : null });
    });
    return () => {
      cancelled = true;
    };
  }, [lang, localize]);

  const ageValue = Number(form.age);
  const age = form.age.trim() && Number.isFinite(ageValue) ? (form.ageMode === "age" ? ageValue : new Date().getFullYear() - ageValue) : null;
  const under18 = age !== null && age >= 0 && age < 18;
  // Kullanıcı kararı (2026-10-31): çocuk bölgesinden konu seçildiyse yaşa bakılmaksızın veli adı + beyan zorunlu.
  const childTopic = selected.some((t) => t.bodyArea === "children");
  const guardianRequired = under18 || childTopic;

  function validateContact(contactAllowed: boolean): Record<string, string> {
    const e: Record<string, string> = {};
    // İletişim izni yoksa hiçbir kişisel veri gönderilmez/kaydedilmez — alanlar zorunlu değil.
    if (!contactAllowed) return e;
    if (form.name.trim().length < 2) e.name = m.required;
    if (age === null || age < 0 || age > 120) e.age = m.required;
    if (guardianRequired && form.guardianName.trim().length < 2) e.guardianName = m.required;
    if (childTopic && !form.guardianDeclaration) e.guardianDeclaration = m.required;
    if (!form.email.trim() && !form.phoneNumber.trim()) e.email = m.contactOneRequired;
    if (form.phoneNumber.trim() && !/^[+0-9 ()-]{6,20}$/.test(form.phoneNumber.trim())) e.phoneNumber = m.invalidPhone;
    return e;
  }

  async function submitContact(withCallback: boolean) {
    // Geri tuşuyla 4. adıma dönülürse talep TEKRAR gönderilmez.
    if (submission) {
      goTo(5);
      return;
    }
    const contactAllowed = form.consentContact || withCallback;
    const e = validateContact(contactAllowed);
    setErrors(e);
    if (Object.keys(e).length > 0) {
      const first = Object.keys(e)[0];
      const id =
        first === "age"
          ? "matcher-age"
          : first === "guardianName"
            ? "matcher-guardian"
            : first === "guardianDeclaration"
              ? "matcher-guardian-declaration"
              : first === "phoneNumber"
                ? "matcher-phone"
                : `matcher-${first}`;
      document.getElementById(id)?.focus();
      return;
    }
    setBusy(true);
    setStepError(null);
    try {
      const phoneCountry = form.phoneCountry || country || undefined;
      // Kullanıcı kararı: iletişim izni yoksa ad/telefon/e-posta ve sağlık bilgileri GÖNDERİLMEZ (yalnızca anonim sayaç).
      const result = !contactAllowed
        ? await submitMatcher({
            website: form.website || undefined,
            locale: lang,
            forWhom,
            preference: preference ?? "either",
            preferredLanguage,
            topicIds: [],
            redFlagAcknowledged: redFlagAck,
            consentHealth: false,
            consentContact: false,
          })
        : await submitMatcher({
        website: form.website || undefined,
        locale: lang,
        name: form.name.trim(),
        ...(form.ageMode === "age" ? { age: ageValue } : { birthYear: ageValue }),
        ...(guardianRequired ? { guardianName: form.guardianName.trim() } : {}),
        ...(childTopic ? { guardianDeclaration: form.guardianDeclaration } : {}),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.phoneNumber.trim() ? { phoneNumber: form.phoneNumber.trim(), phoneCountry } : {}),
        ...(country ? { country } : {}),
        ...(tz.timeZone ? { timeZone: tz.timeZone } : {}),
        forWhom,
        ...(duration ? { duration } : {}),
        ...(prior ? { priorDiagnosis: prior } : {}),
        preference: preference ?? "either",
        preferredLanguage,
        topicIds: selectedIds,
        ...(freeText.trim() ? { freeText: freeText.trim().slice(0, MATCHER_FREE_TEXT_MAX) } : {}),
        redFlagAcknowledged: redFlagAck,
        consentHealth: form.consentHealth,
        consentContact: form.consentContact || withCallback,
        callback: withCallback,
      });
      if (result.stored) setSubmission(result);
      if (withCallback && result.stored) setCallbackDone(true);
      trackMatcher("matcher_submit", { callback: withCallback });
      if (!recommendation) await loadRecommendation();
      goTo(5);
    } catch (err) {
      if (err instanceof ApiClientError && err.details) {
        const mapped: Record<string, string> = {};
        for (const key of Object.keys(err.details)) mapped[key] = key === "email" ? m.contactOneRequired : key === "phoneNumber" ? m.invalidPhone : m.required;
        setErrors(mapped);
      }
      setStepError(m.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  // ---- Adım 5 ----
  useEffect(() => {
    if (step !== 5 || whatsapp) return;
    let cancelled = false;
    getMatcherWhatsappDigits(lang).then((digits) => !cancelled && setWhatsapp(digits));
    return () => {
      cancelled = true;
    };
  }, [step, whatsapp, lang]);

  async function askCallback() {
    if (!submission) {
      // İletişim bilgisi yok (opsiyonel mod): iletişim adımı geri arama isteğiyle açılır.
      setCallbackPending(true);
      goTo(4);
      return;
    }
    setBusy(true);
    try {
      await requestMatcherCallback(submission.id, submission.token);
      setCallbackDone(true);
    } catch {
      setStepError(m.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  const languageName = useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([intlLocale], { type: "language" });
    } catch {
      names = null;
    }
    return (code: string) => {
      try {
        return names?.of(code === "sr-latn" ? "sr-Latn" : code) ?? code;
      } catch {
        return code;
      }
    };
  }, [intlLocale]);

  // ---- Render ----
  if (loadError) return <Alert variant="error">{m.errorGeneric}</Alert>;
  if (!catalog) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{m.loading}</span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const stepTitles = [m.stepNames.topic, m.stepNames.details, m.stepNames.preferences, m.stepNames.contact, m.stepNames.result];

  const footer = (onContinue: () => void, label = m.continue, disabled = false) => (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 flex items-center gap-2 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
      {step > 1 && (
        <Button type="button" variant="outline" onClick={() => goTo((step - 1) as Step)} className="min-h-11">
          <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
          {m.back}
        </Button>
      )}
      <Button type="button" onClick={onContinue} loading={busy} disabled={disabled} className="min-h-11 flex-1 sm:flex-none" data-testid="matcher-continue">
        {label}
        <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      </Button>
    </div>
  );

  const radioGroup = <T extends string>(name: string, label: string, value: T | null, options: [T, string][], onChange: (v: T) => void) => (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-semibold text-foreground">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(([v, text]) => (
          <label
            key={v}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--site-radius)] border px-3 py-2 text-sm transition-colors motion-reduce:transition-none",
              value === v ? "border-[var(--site-primary)] bg-[var(--site-primary)]/5" : "border-border hover:bg-surface-muted"
            )}
          >
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="accent-[var(--site-primary)]" />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="relative" data-testid="physician-matcher" data-step={step}>
      {/* İlerleme */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between text-xs text-foreground/70">
          <span>{fmt(m.progress, { current: step, total: TOTAL_STEPS })}</span>
          <span className="font-medium text-foreground">{stepTitles[step - 1]}</span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={TOTAL_STEPS}
          aria-valuenow={step}
          aria-valuetext={`${fmt(m.progress, { current: step, total: TOTAL_STEPS })} — ${stepTitles[step - 1]}`}
          aria-label={m.pageTitle}
        >
          <div className="h-full rounded-full bg-[var(--site-primary)] transition-all duration-300 motion-reduce:transition-none" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      <div key={step} className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
        {step === 1 && (
          <section aria-labelledby="matcher-step-title" className="space-y-5">
            <div>
              <h2 id="matcher-step-title" ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold text-foreground outline-none sm:text-2xl">
                {m.step1Title}
              </h2>
              <p className="mt-1 text-sm text-foreground/70">{m.step1Hint}</p>
              <p className="mt-2 text-xs text-foreground/60" data-testid="matcher-privacy-note">
                {m.privacyNote}{" "}
                {legalLinks?.notice && (
                  <Link href={legalLinks.notice} target="_blank" className="font-medium text-[var(--site-link,var(--site-primary))] underline">
                    {m.privacyNoticeLink}
                  </Link>
                )}
              </p>
            </div>

            <div className="relative">
              <label htmlFor="matcher-search" className="sr-only">
                {m.searchLabel}
              </label>
              <Search className="pointer-events-none absolute start-3 top-6 h-5 w-5 -translate-y-1/2 text-foreground/50" aria-hidden="true" />
              <input
                id="matcher-search"
                ref={searchRef}
                type="text"
                role="combobox"
                aria-expanded={listOpen}
                aria-controls={listOpen ? "matcher-search-results" : undefined}
                aria-activedescendant={listOpen && activeIndex >= 0 ? `matcher-option-${activeIndex}` : undefined}
                aria-autocomplete="list"
                autoComplete="off"
                value={query}
                onKeyDown={onSearchKeyDown}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(-1);
                }}
                placeholder={m.heroPlaceholder}
                className="h-12 w-full rounded-[var(--site-radius)] border border-border bg-background ps-10 pe-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]"
                data-testid="matcher-search"
              />
              {listOpen && (
                <ul id="matcher-search-results" role="listbox" aria-label={m.searchLabel} className="mt-2 divide-y divide-border overflow-hidden rounded-[var(--site-radius)] border border-border bg-background">
                  {matches.map((topic, i) => (
                    <li
                      key={topic.id}
                      id={`matcher-option-${i}`}
                      role="option"
                      aria-selected={i === activeIndex}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseFromList(topic)}
                      className={cn("flex cursor-pointer flex-col items-start gap-0.5 px-3 py-2 text-start hover:bg-surface-muted", i === activeIndex && "bg-surface-muted")}
                      data-testid="matcher-search-option"
                    >
                      <span className="text-sm font-medium text-foreground">{topic.label}</span>
                      {matchedTermById.has(topic.id) && <span className="text-xs text-foreground/60">{fmt(m.searchMatchedTerm, { term: matchedTermById.get(topic.id)! })}</span>}
                      {topic.description && <span className="text-xs text-foreground/60">{topic.description}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p role="status" className={cn("text-sm text-foreground/70", trimmedQuery.length >= 2 && matches.length === 0 ? "mt-2" : "sr-only")} data-testid="matcher-no-results">
                {trimmedQuery.length >= 2 ? (matches.length === 0 ? m.noSearchResults : `${matches.length}`) : ""}
              </p>
              {trimmedQuery.length >= 2 && matches.length === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowFreeText(true);
                    if (!freeText.trim()) setFreeText(query.trim().slice(0, MATCHER_FREE_TEXT_MAX));
                    setQuery("");
                  }}
                  className="mt-1 text-sm font-medium text-[var(--site-link,var(--site-primary))] underline underline-offset-4"
                  data-testid="matcher-no-results-write"
                >
                  {m.noSearchResultsWrite}
                </button>
              )}
            </div>

            {selected.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">{m.selectedTitle}</h3>
                <ul className="flex flex-wrap gap-2" data-testid="matcher-selected">
                  {selected.map((topic) => (
                    <li key={topic.id}>
                      <button
                        type="button"
                        onClick={() => toggleTopic(topic)}
                        aria-label={fmt(m.removeTopic, { label: topic.label })}
                        className={cn(
                          "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium",
                          topic.isRedFlag ? "bg-red-600 text-white" : "bg-[var(--site-primary)] text-white"
                        )}
                      >
                        {topic.label}
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{m.bodyAreasTitle}</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {MATCHER_BODY_AREAS.filter((area) => topics.some((t) => t.bodyArea === area && !t.isRedFlag)).map((area) => {
                  const Icon = BODY_AREA_ICONS[area];
                  const open = openArea === area;
                  return (
                    <button
                      key={area}
                      type="button"
                      aria-expanded={open}
                      aria-controls={`matcher-area-${area}`}
                      onClick={() => {
                        setOpenArea(open ? null : area);
                        setShowAllAreaTopics(false);
                      }}
                      className={cn(
                        "flex min-h-14 items-center gap-2 rounded-[var(--site-radius)] border p-3 text-start text-sm font-medium transition-colors motion-reduce:transition-none",
                        open ? "border-[var(--site-primary)] bg-[var(--site-primary)]/5 text-foreground" : "border-border bg-surface text-foreground hover:bg-surface-muted"
                      )}
                      data-testid={`matcher-area-${area}`}
                    >
                      <Icon className="h-5 w-5 shrink-0 text-[var(--site-primary)]" aria-hidden="true" />
                      {m.bodyAreas[area]}
                    </button>
                  );
                })}
              </div>
              {openArea && (
                <div id={`matcher-area-${openArea}`} className="mt-3 rounded-[var(--site-radius)] border border-border p-3">
                  <div className="flex flex-wrap gap-2">
                    {visibleAreaTopics.map((topic) => (
                      <button
                        key={topic.id}
                        type="button"
                        aria-pressed={selectedIds.includes(topic.id)}
                        onClick={() => toggleTopic(topic)}
                        title={topic.description}
                        className={cn(
                          "min-h-9 rounded-full border px-3 text-sm transition-colors motion-reduce:transition-none",
                          selectedIds.includes(topic.id) ? "border-[var(--site-primary)] bg-[var(--site-primary)] text-white" : "border-border bg-background text-foreground hover:bg-surface-muted"
                        )}
                        data-testid="matcher-chip"
                      >
                        {topic.label}
                      </button>
                    ))}
                  </div>
                  {areaTopics.length > AREA_TOPIC_PREVIEW && (
                    <button
                      type="button"
                      aria-expanded={showAllAreaTopics}
                      onClick={() => setShowAllAreaTopics((v) => !v)}
                      className="mt-3 text-sm font-medium text-[var(--site-link,var(--site-primary))] underline-offset-4 hover:underline"
                      data-testid="matcher-show-more"
                    >
                      {showAllAreaTopics ? m.showFewerTopics : fmt(m.showMoreTopics, { count: areaTopics.length - AREA_TOPIC_PREVIEW })}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              {!showFreeText ? (
                <button type="button" onClick={() => setShowFreeText(true)} className="text-sm font-medium text-[var(--site-link,var(--site-primary))] underline-offset-4 hover:underline">
                  {m.freeTextToggle}
                </button>
              ) : (
                <div className="space-y-2">
                  <label htmlFor="matcher-free-text" className="block text-sm font-semibold text-foreground">
                    {m.freeTextLabel}
                  </label>
                  <textarea
                    id="matcher-free-text"
                    rows={3}
                    maxLength={MATCHER_FREE_TEXT_MAX}
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    aria-describedby="matcher-free-text-help"
                    className="w-full rounded-[var(--site-radius)] border border-border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]"
                    data-testid="matcher-free-text"
                  />
                  <p id="matcher-free-text-help" className="flex justify-between text-xs text-foreground/60">
                    <span>{m.freeTextHelp}</span>
                    <span aria-live="polite">{fmt(m.freeTextCounter, { count: freeText.length })}</span>
                  </p>
                  {textSuggestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-foreground/70">{m.suggestionsFromText}</span>
                      {textSuggestions.map((topic) => (
                        <button key={topic.id} type="button" onClick={() => toggleTopic(topic)} className="rounded-full border border-dashed border-[var(--site-primary)] px-3 py-1 text-[var(--site-primary)]">
                          + {topic.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {stepError && <Alert variant="warning">{stepError}</Alert>}
            {footer(continueFromStep1)}
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="matcher-step-title" className="space-y-5">
            <h2 id="matcher-step-title" ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold text-foreground outline-none sm:text-2xl">
              {m.step2Title}
            </h2>
            {radioGroup("forWhom", m.forWhomLabel, forWhom, [["self", m.forWhom.self], ["relative", m.forWhom.relative]], setForWhom)}
            {radioGroup<MatcherDuration>("duration", m.durationLabel, duration, (["lt1w", "1to4w", "1to6m", "gt6m"] as const).map((d) => [d, m.durations[d]]), setDuration)}
            {radioGroup<MatcherPriorDiagnosis>("prior", m.priorLabel, prior, (["yes", "no", "unknown"] as const).map((d) => [d, m.prior[d]]), setPrior)}
            {stepError && <Alert variant="warning">{stepError}</Alert>}
            {footer(() => {
              if (!duration || !prior) {
                setStepError(m.required);
                return;
              }
              setStepError(null);
              goTo(3);
            })}
          </section>
        )}

        {step === 3 && (
          <section aria-labelledby="matcher-step-title" className="space-y-5">
            <h2 id="matcher-step-title" ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold text-foreground outline-none sm:text-2xl">
              {m.step3Title}
            </h2>
            {radioGroup<MatcherPreference>("preference", m.preferenceLabel, preference, (["online", "in_person", "either"] as const).map((p) => [p, m.preferences[p]]), setPreference)}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1 text-sm">
                <span className="font-semibold text-foreground">{m.languageLabel}</span>
                <select value={preferredLanguage} onChange={(e) => setPreferredLanguage(e.target.value)} className="h-11 w-full rounded-[var(--site-radius)] border border-border bg-background px-3">
                  {SITE_LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {languageName(code)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-semibold text-foreground">{m.countryLabel}</span>
                <select value={detectedCountry} onChange={(e) => setCountryChoice(e.target.value)} className="h-11 w-full rounded-[var(--site-radius)] border border-border bg-background px-3">
                  <option value="">—</option>
                  {COUNTRY_DIAL_CODES.map(([code]) => (
                    <option key={code} value={code}>
                      {countryName(code, intlLocale)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="space-y-1 text-sm sm:col-span-2">
                <span className="font-semibold text-foreground">{m.timeZoneLabel}</span>
                <p className="text-foreground/70" dir="ltr">
                  {tz.timeZone ?? "—"}
                </p>
              </div>
            </div>
            {stepError && <Alert variant="warning">{stepError}</Alert>}
            {footer(() => void continueFromStep3())}
          </section>
        )}

        {step === 4 && (
          <section aria-labelledby="matcher-step-title" className="space-y-4">
            <div>
              <h2 id="matcher-step-title" ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold text-foreground outline-none sm:text-2xl">
                {contactRequired ? m.step4Title : m.step4OptionalTitle}
              </h2>
              {!contactRequired && <p className="mt-1 text-sm text-foreground/70">{m.step4OptionalIntro}</p>}
            </div>
            {submission && <Alert variant="info">{fmt(m.requestNumber, { number: submission.number })}</Alert>}
            {/* Honeypot — insanlar görmez. */}
            <div aria-hidden="true" className="sr-only">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </label>
            </div>
            <Field label={m.nameLabel} error={errors.name} id="matcher-name">
              <input id="matcher-name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
            </Field>
            <fieldset className="space-y-1 text-sm">
              <legend className="font-semibold text-foreground">{m.ageModeLabel}</legend>
              <div className="flex gap-2">
                <select
                  aria-label={m.ageModeLabel}
                  value={form.ageMode}
                  onChange={(e) => setForm({ ...form, ageMode: e.target.value as "age" | "year" })}
                  className="h-11 rounded-[var(--site-radius)] border border-border bg-background px-2"
                >
                  <option value="age">{m.ageModeAge}</option>
                  <option value="year">{m.ageModeYear}</option>
                </select>
                <input
                  aria-label={form.ageMode === "age" ? m.ageModeAge : m.ageModeYear}
                  inputMode="numeric"
                  value={form.age}
                  onChange={(e) => setForm({ ...form, age: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                  className={cn(inputClass, "max-w-40")}
                  data-testid="matcher-age"
                />
              </div>
              {errors.age && <span className="block text-xs text-danger">{errors.age}</span>}
            </fieldset>
            {guardianRequired && (
              <>
                <Alert variant="info">{childTopic ? m.childGuardianNote : m.under18Note}</Alert>
                <Field label={m.guardianLabel} error={errors.guardianName} id="matcher-guardian">
                  <input id="matcher-guardian" value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} className={inputClass} />
                </Field>
                {childTopic && (
                  <div className="space-y-1 text-sm">
                    <label className="flex items-start gap-2">
                      <input
                        id="matcher-guardian-declaration"
                        type="checkbox"
                        className="mt-1 accent-[var(--site-primary)]"
                        checked={form.guardianDeclaration}
                        onChange={(e) => setForm({ ...form, guardianDeclaration: e.target.checked })}
                        aria-invalid={!!errors.guardianDeclaration}
                        data-testid="matcher-guardian-declaration"
                      />
                      <span>{m.guardianDeclarationLabel}</span>
                    </label>
                    {errors.guardianDeclaration && <span className="block text-xs text-danger">{errors.guardianDeclaration}</span>}
                  </div>
                )}
              </>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={m.emailLabel} error={errors.email} id="matcher-email">
                <input id="matcher-email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} dir="ltr" />
              </Field>
              <div className="space-y-1 text-sm">
                <label htmlFor="matcher-phone" className="block font-semibold text-foreground">
                  {m.phoneLabel}
                </label>
                <div className="flex gap-2" dir="ltr">
                  <select
                    aria-label={m.phoneCountryLabel}
                    value={form.phoneCountry || country}
                    onChange={(e) => setForm({ ...form, phoneCountry: e.target.value })}
                    className="h-11 w-28 rounded-[var(--site-radius)] border border-border bg-background px-2"
                  >
                    {COUNTRY_DIAL_CODES.map(([code, dial]) => (
                      <option key={code} value={code}>
                        {code} +{dial}
                      </option>
                    ))}
                  </select>
                  <input id="matcher-phone" type="tel" autoComplete="tel-national" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} className={inputClass} />
                </div>
                {errors.phoneNumber && <span className="block text-xs text-danger">{errors.phoneNumber}</span>}
              </div>
            </div>
            <div className="space-y-3 rounded-[var(--site-radius)] border border-border bg-surface p-3 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 accent-[var(--site-primary)]" checked={form.consentHealth} onChange={(e) => setForm({ ...form, consentHealth: e.target.checked })} data-testid="matcher-consent-health" />
                <span>
                  {guardianRequired ? m.consentHealthGuardian : m.consentHealth}{" "}
                  {legalLinks?.consent && (
                    <Link href={legalLinks.consent} target="_blank" className="font-medium text-[var(--site-link,var(--site-primary))] underline">
                      {m.consentHealthLink}
                    </Link>
                  )}
                  {legalLinks?.notice && (
                    <>
                      {" · "}
                      <Link href={legalLinks.notice} target="_blank" className="font-medium text-[var(--site-link,var(--site-primary))] underline">
                        {m.privacyNoticeLink}
                      </Link>
                    </>
                  )}
                  <span className="mt-1 block text-xs text-foreground/60">{m.consentHealthHint}</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1 accent-[var(--site-primary)]" checked={form.consentContact} onChange={(e) => setForm({ ...form, consentContact: e.target.checked })} data-testid="matcher-consent-contact" />
                <span>{m.consentContact}</span>
              </label>
              {!form.consentContact && !callbackPending && (
                <p className="text-xs text-foreground/60" data-testid="matcher-no-contact-note">
                  {m.noContactNote}
                </p>
              )}
            </div>
            {stepError && <Alert variant="warning">{stepError}</Alert>}
            {footer(() => void submitContact(callbackPending), contactRequired ? m.submit : m.submitOptional)}
          </section>
        )}

        {step === 5 && recommendation && (
          <section aria-labelledby="matcher-step-title" className="space-y-6" data-testid="matcher-result">
            <h2 id="matcher-step-title" ref={headingRef} tabIndex={-1} className="font-heading text-xl font-semibold text-foreground outline-none sm:text-2xl">
              {m.step5Title}
            </h2>
            {submission && submission.number > 0 && <p className="text-sm text-foreground/70">{fmt(m.requestNumber, { number: submission.number })}</p>}

            {recommendation.coordinator || recommendation.doctors.length === 0 ? (
              <div className="rounded-[var(--site-radius)] border border-border bg-surface p-5" data-testid="matcher-no-match">
                <h3 className="font-heading text-lg font-semibold text-foreground">{m.noMatchTitle}</h3>
                <p className="mt-1 text-sm text-foreground/70">{submission ? m.noMatchText : m.noMatchNeedContact}</p>
                {!submission && (
                  <Button type="button" className="mt-3 min-h-11" onClick={() => void askCallback()}>
                    {m.coordinatorCall}
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{m.specialtiesTitle}</h3>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {recommendation.specialties.map((s) => (
                      <li key={s.id} className="rounded-[var(--site-radius)] border border-border bg-surface p-3">
                        <p className="font-medium text-foreground">{s.name}</p>
                        {s.description && <p className="mt-1 line-clamp-3 text-xs text-foreground/70">{s.description}</p>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{m.physiciansTitle}</h3>
                  <ul className="grid gap-4 lg:grid-cols-3">
                    {recommendation.doctors.map((d, index) => (
                      <li key={d.id} className="flex flex-col rounded-[var(--site-radius)] border border-border bg-surface p-4 shadow-sm" data-testid="matcher-doctor-card">
                        <div className="flex items-center gap-3">
                          {d.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- harici medya URL'si (avatar), boyut sabit
                            <img src={d.avatarUrl} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-surface-muted text-lg font-semibold text-foreground/60" aria-hidden="true">
                              {d.displayName.charAt(0)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">
                              {d.title} {d.displayName}
                            </p>
                            {d.specialtyName && <p className="text-xs text-foreground/70">{d.specialtyName}</p>}
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-foreground/70">{fmt(m.speaks, { languages: d.languages.map(languageName).join(", ") })}</p>
                        {recommendation.interpreterIncluded && (
                          <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-[var(--site-primary)]/10 px-2.5 py-1 text-xs font-medium text-[var(--site-primary)]" data-testid="matcher-interpreter-badge">
                            <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                            {m.interpreterBadge}
                          </span>
                        )}
                        <div className="mt-3">
                          <p className="mb-1 text-xs font-semibold text-foreground">{m.nextSlots}</p>
                          {d.slots.length === 0 ? (
                            <p className="text-xs text-foreground/60">{m.noSlots}</p>
                          ) : (
                            <ul className="space-y-1">
                              {d.slots.map((slot) => (
                                <li key={slot.startsAt} className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1 text-xs">
                                  <span className="text-foreground/70">{formatLongDate(slot.startsAt, tz.timeZone ?? "Europe/Istanbul", intlLocale)}</span>
                                  <DualSlotLabel iso={slot.startsAt} timeZone={tz.timeZone ?? "Europe/Istanbul"} intlLocale={intlLocale} />
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div className="mt-4 flex flex-col gap-2">
                          <Link
                            href={bookingHref(localize, d.slug, d.matchedSpecialtySlug)}
                            onClick={() => trackMatcher("matcher_book_click", { position: index + 1 })}
                            className="inline-flex min-h-11 items-center justify-center rounded-[var(--site-radius)] bg-[var(--site-primary)] px-4 text-center text-sm font-semibold text-white hover:opacity-90"
                            data-testid="matcher-book"
                          >
                            {fmt(m.book, { name: d.displayName })}
                          </Link>
                          <Link href={localize(`/physicians/${encodeURIComponent(d.slug)}`)} className="text-center text-sm font-medium text-[var(--site-link,var(--site-primary))] hover:underline">
                            {m.viewProfile}
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            <div className="flex flex-wrap gap-2">
              {callbackDone ? (
                <Alert variant="success">{m.callbackDone}</Alert>
              ) : (
                <div className="flex flex-col gap-1">
                  <Button type="button" variant="outline" className="min-h-11" loading={busy} onClick={() => void askCallback()} data-testid="matcher-callback" aria-describedby="matcher-callback-note">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    {m.coordinatorCall}
                  </Button>
                  {submission && (
                    <span id="matcher-callback-note" className="max-w-xs text-xs text-foreground/60">
                      {m.callbackConsentNote}
                    </span>
                  )}
                </div>
              )}
              {whatsapp && (
                <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--site-radius)] border border-border px-4 text-sm font-medium hover:bg-surface-muted">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {m.whatsapp}
                </a>
              )}
              <Button type="button" variant="ghost" className="min-h-11" onClick={() => goTo(1)}>
                {m.changeAnswers}
              </Button>
              {mode === "modal" && onClose && (
                <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>
                  {m.close}
                </Button>
              )}
            </div>
            {stepError && <Alert variant="warning">{stepError}</Alert>}
          </section>
        )}
      </div>

      <p className="mt-6 border-t border-border pt-3 text-xs text-foreground/60" data-testid="matcher-disclaimer">
        {m.disclaimer}
      </p>

      {redFlagOpen && (
        <RedFlagScreen
          countryCode={country}
          intlLocale={intlLocale}
          onContinue={() => {
            setRedFlagAck(true);
            setRedFlagOpen(false);
            reportMatcherProgress("red_flag_continue");
          }}
        />
      )}
    </div>
  );
}

const inputClass = "h-11 w-full rounded-[var(--site-radius)] border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-primary)]";

function Field({ label, error, id, children }: { label: string; error?: string; id: string; children: React.ReactElement<{ "aria-invalid"?: boolean; "aria-describedby"?: string }> }) {
  const child = error ? cloneElement(children, { "aria-invalid": true, "aria-describedby": `${id}-error` }) : children;
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor={id} className="block font-semibold text-foreground">
        {label}
      </label>
      {child}
      {error && (
        <span id={`${id}-error`} role="alert" className="block text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}

/** Tam ekran acil uyarısı — ülkeye göre numara vurgulanır; "Acil değil, devam et" onayı kayda geçer. */
function RedFlagScreen({ countryCode, intlLocale, onContinue }: { countryCode: string; intlLocale: string; onContinue: () => void }) {
  const { m } = useMatcherStrings();
  const number = emergencyNumberFor(countryCode);
  const continueRef = useRef<HTMLButtonElement>(null);
  const callRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    callRef.current?.focus();
    // Escape uyarıyı (ve modalı) kapatmasın; Tab yalnızca iki eylem arasında dolaşsın (odak tuzağı).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      } else if (e.key === "Tab") {
        const items = [callRef.current, continueRef.current].filter((el): el is HTMLAnchorElement | HTMLButtonElement => !!el);
        const index = items.indexOf(document.activeElement as HTMLAnchorElement | HTMLButtonElement);
        e.preventDefault();
        items[(index + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, []);
  return createPortal(
    <div role="alertdialog" aria-modal="true" aria-labelledby="matcher-redflag-title" aria-describedby="matcher-redflag-text" className="fixed inset-0 z-[100] flex items-center justify-center bg-red-700 p-4 text-white" data-testid="matcher-red-flag">
      <div className="w-full max-w-lg space-y-5 text-center">
        <Siren className="mx-auto h-14 w-14" aria-hidden="true" />
        <h2 id="matcher-redflag-title" className="font-heading text-2xl font-bold sm:text-3xl">
          {m.redFlagTitle}
        </h2>
        <p id="matcher-redflag-text" className="text-base leading-relaxed">
          {m.redFlagText}
        </p>
        <div className="rounded-xl bg-white/10 p-4">
          <p className="text-sm">{countryCode ? fmt(m.redFlagYourCountry, { country: countryName(countryCode, intlLocale) }) : m.redFlagOtherCountry}</p>
          <a
            ref={callRef}
            href={`tel:${number}`}
            className="mt-2 inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-white px-6 text-2xl font-bold text-red-700 focus-visible:outline-4 focus-visible:outline-white"
            data-testid="matcher-emergency-number"
          >
            <Phone className="h-6 w-6" aria-hidden="true" />
            {fmt(m.redFlagCall, { number })}
          </a>
          {countryCode && <p className="mt-2 text-xs opacity-80">{m.redFlagOtherCountry}</p>}
        </div>
        <div className="space-y-1">
          <button
            ref={continueRef}
            type="button"
            onClick={onContinue}
            className="min-h-11 rounded-lg border border-white/70 px-4 text-sm font-semibold underline-offset-4 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
            data-testid="matcher-red-flag-continue"
          >
            {m.redFlagContinue}
          </button>
          <p className="text-xs opacity-80">{m.redFlagContinueNote}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
