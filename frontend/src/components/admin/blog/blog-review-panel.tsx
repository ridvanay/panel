"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Clock, Plus, Trash2 } from "lucide-react";
import * as telehealthApi from "@/lib/api/telehealth";
import * as matcherApi from "@/lib/api/matcher";
import type { AdminCareTopic } from "@/lib/api/matcher";
import type { BlogFaqItem, BlogMedicalReviewStatus, BlogReference, DoctorProfile, Specialty } from "@/lib/api/types";
import type { BlogReviewState } from "@/lib/blog/admin-review-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const STATUS_LABEL: Record<BlogMedicalReviewStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "primary" }> = {
  pending: { label: "Onay bekliyor", tone: "warning" },
  approved: { label: "Onaylandı", tone: "success" },
  changes_requested: { label: "Değişiklik istendi", tone: "danger" },
  not_required: { label: "Hekim onayı gerekmiyor", tone: "neutral" },
};

function doctorName(d: DoctorProfile): string {
  return `${d.title} ${d.displayName ?? d.fullName}`.trim();
}

/** Admin hekim listesinin tüm sayfaları (en çok 10 × 100): tek sayfa, çok hekim olduğunda atanmış hekimi dışarıda bırakırdı. */
async function loadAllDoctors(): Promise<DoctorProfile[]> {
  const all: DoctorProfile[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i += 1) {
    const page = await telehealthApi.listAdminDoctors({ limit: 100, ...(cursor ? { cursor } : {}) });
    all.push(...page.items);
    cursor = page.meta?.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return all;
}

function topicLabel(topic: AdminCareTopic): string {
  const t = topic.translations;
  return t.tr?.label || t.en?.label || Object.values(t)[0]?.label || topic.slug;
}

export interface BlogReviewPanelProps {
  value: BlogReviewState;
  onChange: (patch: Partial<BlogReviewState>) => void;
  /** Kayıtlı inceleme durumu (yeni yazıda "pending"). */
  currentStatus: BlogMedicalReviewStatus;
  reviewNote?: string | null;
  lastReviewedAt?: string | null;
  /** Seçili kategori tıbbi mi? `null` = kategori yok/bilinmiyor. */
  categoryIsMedical: boolean | null;
  isAdmin: boolean;
  /** Etkin dil sekmesi — anahtar çıkarımları/SSS yalnızca bu dilin metnini düzenler. */
  localeLabel: string;
  takeaways: string[];
  faq: BlogFaqItem[];
  onTakeawaysChange: (list: string[]) => void;
  onFaqChange: (list: BlogFaqItem[]) => void;
  readingMinutes: number;
  /** API alan hataları (ör. `medicalReviewStatus`). */
  fieldErrors: Record<string, string>;
}

/**
 * Paket Z1 (admin) — blog editörü: uzmanlık, care topic, gözden geçiren hekim, inceleme durumu, okuma süresi,
 * öne çıkarma, "Key takeaways", SSS ve kaynaklar. Veri listeleri (uzmanlık/hekim/konu) yüklenemezse (yetki ya da
 * modül kapalı) form yine çalışır; ilgili alan uyarı gösterir.
 */
export function BlogReviewPanel(props: BlogReviewPanelProps) {
  const { value, onChange, currentStatus, fieldErrors } = props;
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [topics, setTopics] = useState<AdminCareTopic[]>([]);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [topicSearch, setTopicSearch] = useState("");
  const [doctorsLoaded, setDoctorsLoaded] = useState(false);
  // Listede olmayan (pasif/arşivli ya da çok sayıda hekim yüzünden sayfalara sığmayan) atanmış hekim.
  const [assignedDoctor, setAssignedDoctor] = useState<DoctorProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const failed: string[] = [];
      const [s, d, c] = await Promise.all([
        telehealthApi.listAdminSpecialties().catch(() => (failed.push("uzmanlıklar"), [] as Specialty[])),
        loadAllDoctors().catch(() => (failed.push("hekimler"), [] as DoctorProfile[])),
        matcherApi.listAdminCareTopics().catch(() => (failed.push("bakım konuları"), [] as AdminCareTopic[])),
      ]);
      if (cancelled) return;
      setSpecialties(Array.isArray(s) ? s : []);
      setDoctors(Array.isArray(d) ? d : []);
      setTopics(Array.isArray(c) ? c : []);
      setDoctorsLoaded(true);
      setLoadWarning(failed.length ? `Yüklenemedi: ${failed.join(", ")}. Bu alanlar için yetkiniz olmayabilir.` : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDoctors = useMemo(() => doctors.filter((d) => d.isActive !== false && !d.archivedAt), [doctors]);
  const reviewerId = value.reviewerDoctorId;
  useEffect(() => {
    if (!doctorsLoaded || !reviewerId || doctors.some((d) => d.id === reviewerId)) return;
    let cancelled = false;
    (async () => {
      try {
        const doctor = await telehealthApi.getAdminDoctor(reviewerId);
        if (!cancelled && doctor) setAssignedDoctor(doctor);
      } catch {
        // Hekim getirilemezse yalnızca kimlik gösterilir; değer yine de KORUNUR.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doctorsLoaded, reviewerId, doctors]);
  const assignedMissing = reviewerId && !activeDoctors.some((d) => d.id === reviewerId);
  const assignedSource = assignedMissing ? (doctors.find((d) => d.id === reviewerId) ?? (assignedDoctor?.id === reviewerId ? assignedDoctor : null)) : null;
  const selectedTopics = topics.filter((t) => value.careTopicIds.includes(t.id));
  const topicMatches = useMemo(() => {
    const q = topicSearch.trim().toLocaleLowerCase("tr");
    return topics
      .filter((t) => t.isActive && !value.careTopicIds.includes(t.id))
      .filter((t) => !q || topicLabel(t).toLocaleLowerCase("tr").includes(q) || t.slug.includes(q))
      .slice(0, 30);
  }, [topics, topicSearch, value.careTopicIds]);

  const status = STATUS_LABEL[currentStatus];
  const canNotRequired = props.isAdmin && props.categoryIsMedical === false;

  return (
    <Card className="space-y-6" data-testid="blog-review-panel">
      <div>
        <h2 className="text-base font-semibold text-foreground">Tıbbi inceleme ve konu</h2>
        <p className="mt-1 admin-text-secondary">Yazı, gözden geçiren hekim onayı olmadan yayınlanamaz.</p>
      </div>
      {loadWarning && <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">{loadWarning}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="specialtyId" label="Uzmanlık" error={fieldErrors.specialtyId}>
          {(inputProps) => (
            <Select {...inputProps} value={value.specialtyId} onChange={(e) => onChange({ specialtyId: e.target.value })}>
              <option value="">Seçilmedi</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="reviewerDoctorId" label="Gözden geçiren hekim" error={fieldErrors.reviewerDoctorId}>
          {(inputProps) => (
            <Select {...inputProps} value={value.reviewerDoctorId} onChange={(e) => onChange({ reviewerDoctorId: e.target.value })}>
              <option value="">Seçilmedi</option>
              {assignedMissing && (
                <option value={reviewerId}>
                  {assignedSource ? `${doctorName(assignedSource)} (aktif değil)` : "Atanmış hekim (aktif değil / bulunamadı)"}
                </option>
              )}
              {activeDoctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {doctorName(d)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div data-testid="blog-review-status" className="space-y-3 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">İnceleme durumu</span>
          <Badge tone={status.tone}>{status.label}</Badge>
          {props.lastReviewedAt && (
            <span className="inline-flex items-center gap-1 text-xs text-foreground/60">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Son onay: {new Date(props.lastReviewedAt).toLocaleDateString("tr-TR")}
            </span>
          )}
        </div>
        {currentStatus === "changes_requested" && props.reviewNote && (
          <div className="rounded-md bg-danger/5 p-3 text-sm text-foreground" data-testid="blog-review-note">
            <p className="text-xs font-medium text-danger">Hekimin notu</p>
            <p className="mt-1 whitespace-pre-line">{props.reviewNote}</p>
          </div>
        )}
        <Field
          id="statusWrite"
          label="Durumu değiştir"
          hint={canNotRequired ? undefined : "“Hekim onayı gerekmiyor” yalnızca yönetici tarafından ve tıbbi olmayan bir kategoride seçilebilir."}
          error={fieldErrors.medicalReviewStatus}
        >
          {(inputProps) => (
            <Select {...inputProps} value={value.statusWrite} onChange={(e) => onChange({ statusWrite: e.target.value as BlogReviewState["statusWrite"] })}>
              <option value="">Değiştirme</option>
              <option value="pending">Onay bekliyor (hekime gönder)</option>
              {canNotRequired && <option value="not_required">Hekim onayı gerekmiyor</option>}
            </Select>
          )}
        </Field>
        <p className="flex items-center gap-1 text-xs text-foreground/60">
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
          “Onaylandı” ve “Değişiklik istendi” durumlarını yalnızca atanan hekim, doktor panelinden verir.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">Bakım konuları (care topic)</p>
        {selectedTopics.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Seçili konular">
            {selectedTopics.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => onChange({ careTopicIds: value.careTopicIds.filter((id) => id !== t.id) })}
                  aria-label={`${topicLabel(t)} konusunu kaldır`}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  {topicLabel(t)}
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Input aria-label="Konu ara" placeholder="Konu ara…" value={topicSearch} onChange={(e) => setTopicSearch(e.target.value)} />
        {topicMatches.length > 0 && (
          <ul className="max-h-40 overflow-y-auto rounded-md border border-border">
            {topicMatches.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => value.careTopicIds.length < 20 && onChange({ careTopicIds: [...value.careTopicIds, t.id] })}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-start text-sm hover:bg-surface-muted"
                >
                  <span>{topicLabel(t)}</span>
                  <Plus className="h-3.5 w-3.5 text-foreground/50" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-foreground/60">En fazla 20 konu seçilebilir.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-foreground">Öne çıkan yazı</p>
          <p className="text-xs text-foreground/60">Blog ana sayfasındaki “Latest” bloğunda gösterilir.</p>
        </div>
        <Switch checked={value.isFeatured} onCheckedChange={(checked) => onChange({ isFeatured: checked })} aria-label="Öne çıkan yazı" />
      </div>

      <p className="text-sm text-foreground/70" data-testid="blog-reading-preview">
        Tahmini okuma süresi ({props.localeLabel}): <strong className="text-foreground">{props.readingMinutes} dk</strong>
      </p>

      <ListEditor
        title={`Key takeaways (${props.localeLabel})`}
        hint="En fazla 10 madde; düz metin."
        addLabel="Madde ekle"
        items={props.takeaways}
        max={10}
        onChange={props.onTakeawaysChange}
        empty=""
        render={(item, set) => <Input aria-label="Madde" maxLength={400} value={item} onChange={(e) => set(e.target.value)} />}
      />

      <ListEditor
        title={`SSS / FAQ (${props.localeLabel})`}
        hint="En fazla 20 soru; düz metin."
        addLabel="Soru ekle"
        items={props.faq}
        max={20}
        onChange={props.onFaqChange}
        empty={{ question: "", answer: "" }}
        render={(item, set) => (
          <div className="grid flex-1 gap-2">
            <Input aria-label="Soru" placeholder="Soru" maxLength={300} value={item.question} onChange={(e) => set({ ...item, question: e.target.value })} />
            <Textarea aria-label="Cevap" placeholder="Cevap" rows={3} maxLength={3000} value={item.answer} onChange={(e) => set({ ...item, answer: e.target.value })} />
          </div>
        )}
      />

      <ListEditor
        title="Kaynaklar (References)"
        hint="En fazla 30 kaynak; bağlantı https ile başlamalı. Tüm dillerde ortaktır."
        addLabel="Kaynak ekle"
        items={value.references}
        max={30}
        onChange={(references) => onChange({ references })}
        empty={{ title: "", publisher: "", url: "", accessedAt: "" } as BlogReference}
        render={(item, set) => (
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <Input aria-label="Kaynak başlığı" placeholder="Başlık" maxLength={300} value={item.title} onChange={(e) => set({ ...item, title: e.target.value })} />
            <Input aria-label="Yayıncı" placeholder="Yayıncı" maxLength={200} value={item.publisher} onChange={(e) => set({ ...item, publisher: e.target.value })} />
            <Input aria-label="Kaynak bağlantısı" type="url" placeholder="https://…" value={item.url} onChange={(e) => set({ ...item, url: e.target.value })} />
            <Input aria-label="Erişim tarihi" type="date" value={item.accessedAt} onChange={(e) => set({ ...item, accessedAt: e.target.value })} />
          </div>
        )}
      />
    </Card>
  );
}

function ListEditor<T>({
  title,
  hint,
  addLabel,
  items,
  max,
  onChange,
  empty,
  render,
}: {
  title: string;
  hint: string;
  addLabel: string;
  items: T[];
  max: number;
  onChange: (items: T[]) => void;
  empty: T;
  render: (item: T, set: (next: T) => void) => React.ReactNode;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-foreground">{title}</legend>
      <p className="text-xs text-foreground/60">{hint}</p>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2">
            {render(item, (next) => onChange(items.map((current, i) => (i === index ? next : current))))}
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`${index + 1}. satırı sil`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" disabled={items.length >= max} onClick={() => onChange([...items, empty])}>
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </Button>
    </fieldset>
  );
}
