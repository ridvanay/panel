"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ListChecks, Plus, Save, Search, Trash2 } from "lucide-react";
import * as matcherApi from "@/lib/api/matcher";
import { MATCHER_BODY_AREAS, type AdminCareTopic, type AdminCareTopicInput, type MatcherBodyArea, type MatcherPreview, type MatcherReport } from "@/lib/api/matcher";
import { listAdminSpecialties } from "@/lib/api/telehealth";
import type { Specialty } from "@/lib/api/types";
import { matcherStrings as trStrings } from "@/lib/i18n/matcher-dictionaries/tr";
import { PageHeading } from "@/components/admin/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

/**
 * Paket W — "Eşleştirme kataloğu": şikayet/ihtiyaç konuları (9 dil etiket/açıklama/eş anlamlı), uzmanlık
 * ağırlıkları, kırmızı bayrak, aktif/pasif; canlı önizleme ("bu terimi yazınca şu uzmanlıklar çıkar");
 * raporlar (en çok seçilenler, eşleşmeyen terimler, adım bazında terk) ve ayarlar. Yazma yalnızca ADMIN.
 * Sihirbaz TANI KOYMAZ; hekimi olmayan uzmanlık öneri anında kodda düşülür.
 */
const LANGS = ["tr", "en", "de", "fr", "es", "ru", "ar", "ro", "sr-latn"] as const;
const AREA_LABEL: Record<MatcherBodyArea, string> = trStrings.bodyAreas as Record<MatcherBodyArea, string>;

function isoDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export default function AdminMatcherPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN";
  const [topics, setTopics] = useState<AdminCareTopic[] | null>(null);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [area, setArea] = useState<MatcherBodyArea | "">("");
  const [editing, setEditing] = useState<AdminCareTopic | "new" | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [rows, specs] = await Promise.all([matcherApi.listAdminCareTopics(), listAdminSpecialties()]);
      setTopics(rows);
      setSpecialties(specs);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (topics ?? []).filter(
      (t) =>
        (!area || t.bodyArea === area) &&
        (!q || t.slug.includes(q) || Object.values(t.translations).some((tr) => tr.label.toLowerCase().includes(q) || tr.synonyms.some((s) => s.toLowerCase().includes(q))))
    );
  }, [topics, filter, area]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeading
        icon={ListChecks}
        title="Eşleştirme kataloğu"
        description='"Hekimimi bul" sihirbazının şikayet/ihtiyaç konuları ve uzmanlık ağırlıkları. Sihirbaz tanı koymaz; yalnızca uzmanlık ve hekim önerir. Hekimi olmayan uzmanlık önerilmez (ağırlık kalır, hekim atanınca devreye girer).'
      />
      {loadError && <Alert variant="error">{loadError}</Alert>}

      <PreviewCard />

      <Card className="space-y-3" data-testid="matcher-catalog">
        <div className="flex flex-wrap items-end gap-2">
          <h2 className="admin-h2 me-auto">Konular {topics && <span className="text-sm font-normal text-foreground/60">({visible.length}/{topics.length})</span>}</h2>
          <Input aria-label="Konu ara" placeholder="Ara (slug, etiket, eş anlamlı)" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56" />
          <select aria-label="Vücut bölgesi" value={area} onChange={(e) => setArea(e.target.value as MatcherBodyArea | "")} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
            <option value="">Tüm bölgeler</option>
            {MATCHER_BODY_AREAS.map((a) => (
              <option key={a} value={a}>
                {AREA_LABEL[a]}
              </option>
            ))}
          </select>
          {canEdit && (
            <Button type="button" size="sm" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Yeni konu
            </Button>
          )}
        </div>
        {topics === null && !loadError ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-primary" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-foreground/60">
                  <th className="py-1 pe-2">Konu (TR)</th>
                  <th className="pe-2">Bölge</th>
                  <th className="pe-2">Uzmanlık ağırlıkları</th>
                  <th className="pe-2">Durum</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.id} className="border-t border-border align-top" data-testid="matcher-topic-row">
                    <td className="py-2 pe-2">
                      <p className="font-medium">{t.translations.tr?.label ?? t.translations.en?.label ?? t.slug}</p>
                      <p className="font-mono text-xs text-foreground/50">{t.slug}</p>
                    </td>
                    <td className="pe-2">{AREA_LABEL[t.bodyArea] ?? t.bodyArea}</td>
                    <td className="pe-2 text-xs">
                      {t.isRedFlag ? (
                        <span className="text-red-600">Kırmızı bayrak — eşlenmez</span>
                      ) : t.weights.length === 0 ? (
                        <span className="text-foreground/60">Koordinatör yolu</span>
                      ) : (
                        t.weights.map((w) => `${w.specialtyName} ${w.weight}`).join(" · ")
                      )}
                    </td>
                    <td className="pe-2">
                      <div className="flex flex-wrap gap-1">
                        {t.isRedFlag && (
                          <Badge tone="warning" size="sm">
                            Acil
                          </Badge>
                        )}
                        <Badge tone={t.isActive ? "success" : "neutral"} size="sm">
                          {t.isActive ? "Aktif" : "Pasif"}
                        </Badge>
                      </div>
                    </td>
                    <td className="text-end">
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(t)}>
                        {canEdit ? "Düzenle" : "Gör"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && (
        <TopicEditor
          key={editing === "new" ? "new" : editing.id}
          topic={editing === "new" ? null : editing}
          specialties={specialties}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}

      <ReportCard />
      <SettingsCard canEdit={canEdit} />
    </div>
  );
}

function emptyTranslations(): AdminCareTopicInput["translations"] {
  return Object.fromEntries(LANGS.map((l) => [l, { label: "", description: "", synonyms: [] }]));
}

function TopicEditor({
  topic,
  specialties,
  canEdit,
  onClose,
  onSaved,
}: {
  topic: AdminCareTopic | null;
  specialties: Specialty[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<AdminCareTopicInput>(() => ({
    slug: topic?.slug ?? "",
    bodyArea: topic?.bodyArea ?? "other",
    translations: { ...emptyTranslations(), ...(topic?.translations ?? {}) },
    isRedFlag: topic?.isRedFlag ?? false,
    isActive: topic?.isActive ?? true,
    sortOrder: topic?.sortOrder ?? 0,
    weights: topic?.weights.map((w) => ({ specialtyId: w.specialtyId, weight: w.weight })) ?? [],
  }));
  const [lang, setLang] = useState<(typeof LANGS)[number]>("tr");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const text = form.translations[lang] ?? { label: "", description: "", synonyms: [] };

  function setText(patch: Partial<typeof text>) {
    setForm({ ...form, translations: { ...form.translations, [lang]: { ...text, ...patch } } });
  }

  async function save() {
    setSaving(true);
    setErrors({});
    // Boş dilleri gönderme (EN zorunlu, sunucu doğrular).
    const translations = Object.fromEntries(Object.entries(form.translations).filter(([, v]) => v.label.trim()));
    const input = { ...form, translations, weights: form.isRedFlag ? [] : form.weights };
    try {
      if (topic) await matcherApi.updateAdminCareTopic(topic.id, input);
      else await matcherApi.createAdminCareTopic(input);
      toast.success("Konu kaydedildi.");
      onSaved();
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4" data-testid="matcher-topic-editor">
      <div className="flex items-center justify-between">
        <h2 className="admin-h2">{topic ? "Konuyu düzenle" : "Yeni konu"}</h2>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Kapat
        </Button>
      </div>
      <fieldset disabled={!canEdit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Slug</span>
            <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            {errors.slug && <span className="text-xs text-danger">{errors.slug}</span>}
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Vücut bölgesi</span>
            <select value={form.bodyArea} onChange={(e) => setForm({ ...form, bodyArea: e.target.value as MatcherBodyArea })} className="h-9 w-full rounded-md border border-border bg-background px-2">
              {MATCHER_BODY_AREAS.map((a) => (
                <option key={a} value={a}>
                  {AREA_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Sıra</span>
            <Input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} />
          </label>
        </div>
        <div className="flex flex-wrap gap-6 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={(v: boolean) => setForm({ ...form, isActive: v })} aria-label="Aktif" />
            Aktif
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={form.isRedFlag} onCheckedChange={(v: boolean) => setForm({ ...form, isRedFlag: v })} aria-label="Kırmızı bayrak" />
            Kırmızı bayrak (acil uyarısı; uzmanlığa eşlenmez)
          </label>
        </div>

        <div>
          <div role="tablist" aria-label="Dil" className="flex flex-wrap gap-1">
            {LANGS.map((code) => (
              <button
                key={code}
                type="button"
                role="tab"
                aria-selected={lang === code}
                onClick={() => setLang(code)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  lang === code ? "bg-primary text-primary-foreground" : "bg-surface-muted text-foreground/70",
                  !form.translations[code]?.label.trim() && lang !== code && "opacity-60"
                )}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="mt-3 grid gap-3" dir={lang === "ar" ? "rtl" : "ltr"}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Etiket {lang === "en" && "(zorunlu)"}</span>
              <Input value={text.label} onChange={(e) => setText({ label: e.target.value })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Açıklama (tek cümle, tanı/tedavi vaadi yok)</span>
              <Input value={text.description} onChange={(e) => setText({ description: e.target.value })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Eş anlamlılar (her satıra bir terim; halk ağzı dahil)</span>
              <Textarea rows={4} value={text.synonyms.join("\n")} onChange={(e) => setText({ synonyms: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
            </label>
          </div>
          {errors.translations && <span className="text-xs text-danger">{errors.translations}</span>}
        </div>

        {!form.isRedFlag && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Uzmanlık ağırlıkları (1–100; boşsa koordinatör yolu)</p>
            {form.weights.map((w, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Uzmanlık"
                  value={w.specialtyId}
                  onChange={(e) => setForm({ ...form, weights: form.weights.map((x, j) => (j === i ? { ...x, specialtyId: e.target.value } : x)) })}
                  className="h-9 min-w-56 rounded-md border border-border bg-background px-2 text-sm"
                >
                  {specialties.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.slug})
                    </option>
                  ))}
                </select>
                <Input
                  aria-label="Ağırlık"
                  type="number"
                  min={1}
                  max={100}
                  value={w.weight}
                  onChange={(e) => setForm({ ...form, weights: form.weights.map((x, j) => (j === i ? { ...x, weight: Math.max(1, Math.min(100, Number(e.target.value) || 1)) } : x)) })}
                  className="w-24"
                />
                <Button type="button" size="sm" variant="ghost" onClick={() => setForm({ ...form, weights: form.weights.filter((_, j) => j !== i) })} aria-label="Ağırlığı kaldır">
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={specialties.length === 0}
              onClick={() => setForm({ ...form, weights: [...form.weights, { specialtyId: specialties.find((s) => !form.weights.some((w) => w.specialtyId === s.id))?.id ?? specialties[0]!.id, weight: 50 }] })}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Uzmanlık ekle
            </Button>
            {errors.weights && <span className="block text-xs text-danger">{errors.weights}</span>}
          </div>
        )}
      </fieldset>
      {canEdit && (
        <div className="flex flex-wrap justify-between gap-2">
          {topic ? (
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Sil
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" loading={saving} onClick={() => void save()}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Kaydet
          </Button>
        </div>
      )}
      {topic && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Konu silinsin mi?"
          description="Konu ve uzmanlık ağırlıkları silinir. Geçmiş taleplerdeki kayıtlar yalnızca kimlik olarak kalır. Geçici gizlemek için 'Aktif' anahtarını kapatın."
          confirmText="Sil"
          cancelText="Vazgeç"
          destructive
          onConfirm={() =>
            void matcherApi
              .deleteAdminCareTopic(topic.id)
              .then(() => {
                toast.success("Konu silindi.");
                onSaved();
              })
              .catch((err) => toast.error(friendlyErrorMessage(err)))
          }
        />
      )}
    </Card>
  );
}

function PreviewCard() {
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("tr");
  const [preview, setPreview] = useState<MatcherPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!q.trim()) return;
    setError(null);
    try {
      setPreview(await matcherApi.previewMatcher(q.trim(), lang));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  return (
    <Card className="space-y-3" data-testid="matcher-preview">
      <h2 className="admin-h2">Canlı önizleme</h2>
      <p className="admin-text-secondary">Bir terim yazın: hangi konular eşleşir ve en iyi eşleşen konu hangi uzmanlıkları önerir?</p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <Input aria-label="Önizleme terimi" placeholder="ör. mide yanması, Sodbrennen" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        <select aria-label="Dil" value={lang} onChange={(e) => setLang(e.target.value)} className="h-9 rounded-md border border-border bg-background px-2 text-sm">
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline">
          <Search className="h-4 w-4" aria-hidden="true" />
          Önizle
        </Button>
      </form>
      {error && <Alert variant="error">{error}</Alert>}
      {preview && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-foreground/60">Eşleşen konular</p>
            {preview.topics.length === 0 ? (
              <p className="text-sm text-foreground/60">Eşleşme yok.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {preview.topics.map((t) => (
                  <li key={t.id}>
                    {t.isRedFlag && <AlertTriangle className="me-1 inline h-4 w-4 text-red-600" aria-label="Kırmızı bayrak" />}
                    {t.label} <span className="font-mono text-xs text-foreground/50">{t.slug}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-foreground/60">Önerilecek uzmanlıklar (ilk konuya göre)</p>
            {preview.specialties.length === 0 ? (
              <p className="text-sm text-foreground/60">Koordinatör yolu.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {preview.specialties.map((s) => (
                  <li key={s.id} className={cn(!(s.hasDoctors && s.passesThreshold) && "text-foreground/50 line-through")}>
                    {s.name} — {s.score}
                    {!s.hasDoctors && <span className="ms-1 text-xs no-underline">(hekim yok — önerilmez)</span>}
                    {s.hasDoctors && !s.passesThreshold && <span className="ms-1 text-xs">(eşik 40 altı)</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

const STEP_LABELS: Record<string, string> = { "1": "1 · Şikayet", "2": "2 · Kimin için/süre", "3": "3 · Tercihler", "4": "4 · İletişim", "5": "5 · Sonuç" };
const RED_FLAG_LABELS: Record<string, string> = { shown: "Acil uyarısı gösterildi", continued: '"Acil değil, devam et"', selected: "Kırmızı bayrak seçildi (öneride)", free_text: "Serbest metinde kırmızı bayrak" };

function ReportCard() {
  const [from, setFrom] = useState(isoDay(-30));
  const [to, setTo] = useState(isoDay(0));
  const [report, setReport] = useState<MatcherReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      setReport(await matcherApi.getMatcherReport(from, to));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    }
  }

  return (
    <Card className="space-y-3" data-testid="matcher-report">
      <h2 className="admin-h2">Raporlar</h2>
      <p className="admin-text-secondary">Anonim sayaçlar (kişi verisi yok). Eşleşmeyen terimler yalnızca en az 3 kez geçtiyse gösterilir.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Başlangıç</span>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Bitiş</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button type="button" onClick={() => void run()}>
          Göster
        </Button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {report && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div>
            <h3 className="mb-1 text-sm font-semibold">En çok seçilen konular</h3>
            <ol className="list-decimal space-y-0.5 ps-5 text-sm">
              {report.topTopics.length === 0 ? <li className="list-none text-foreground/60">Kayıt yok.</li> : report.topTopics.map((t) => <li key={t.key}>{t.label} — {t.count}</li>)}
            </ol>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Eşleşmeyen serbest metin terimleri</h3>
            <ul className="space-y-0.5 text-sm">
              {report.unmatchedTerms.length === 0 ? <li className="text-foreground/60">Kayıt yok.</li> : report.unmatchedTerms.map((t) => <li key={t.key}>{t.key} — {t.count}</li>)}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">Adım bazında terk</h3>
            <table className="w-full text-sm">
              <tbody>
                {report.funnel.map((f) => (
                  <tr key={f.step} className="border-t border-border">
                    <td className="py-1">{STEP_LABELS[f.step] ?? f.step}</td>
                    <td className="text-end">{f.reached}</td>
                    <td className="text-end text-foreground/60">{f.dropOffRate === null ? "" : `%${f.dropOffRate} terk`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.redFlags.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-foreground/70">
                {report.redFlags.map((r) => (
                  <li key={r.key}>
                    {RED_FLAG_LABELS[r.key] ?? r.key}: {r.count}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function SettingsCard({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<matcherApi.MatcherSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    matcherApi
      .getMatcherSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  if (!settings) return null;
  return (
    <Card className="space-y-3" data-testid="matcher-settings">
      <h2 className="admin-h2">Ayarlar</h2>
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={settings.contactRequired} disabled={!canEdit} onCheckedChange={(v: boolean) => setSettings({ ...settings, contactRequired: v })} aria-label="İletişim adımı zorunlu" />
        İletişim adımı zorunlu (kapalıysa sonuçlardan sonra ve isteğe bağlı)
      </label>
      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span>Sağlık verisi saklama süresi (gün)</span>
        <Input type="number" min={30} max={3650} disabled={!canEdit} value={settings.retentionDays} onChange={(e) => setSettings({ ...settings, retentionDays: Number(e.target.value) || 365 })} className="w-28" />
      </label>
      <p className="admin-text-secondary">Süre dolunca talebin sağlık alanları (konular, serbest metin, yaş, süre, öneriler) anonimleştirilir. İletişim bilgileri CRM talep saklama kuralına tabidir.</p>
      {canEdit && (
        <div className="flex justify-end">
          <Button
            type="button"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                setSettings(await matcherApi.updateMatcherSettings(settings));
                toast.success("Ayarlar kaydedildi.");
              } catch (err) {
                toast.error(friendlyErrorMessage(err));
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            Kaydet
          </Button>
        </div>
      )}
    </Card>
  );
}
