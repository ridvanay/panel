"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, UserCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeading } from "@/components/admin/page-heading";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/api/error";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  COORDINATOR_LANGUAGES,
  createCoordinator,
  listCoordinatorCandidates,
  listCoordinators,
  updateCoordinator,
  type Coordinator,
  type CoordinatorCandidate,
} from "@/lib/api/service-desk-admin";
import { languageName } from "./service-desk-format";
import { ServiceDeskNav } from "./service-desk-nav";

/** "Ayşe Yılmaz" -> "Ayşe Y." (unvan yok); tek sözcük olduğu gibi kalır. */
export function defaultDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  const last = parts[parts.length - 1]!;
  return `${parts[0]} ${last.charAt(0).toLocaleUpperCase("tr-TR")}.`;
}

function LanguageCheckboxes({
  idPrefix,
  value,
  onChange,
  legend,
}: {
  idPrefix: string;
  value: string[];
  onChange: (next: string[]) => void;
  legend: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {COORDINATOR_LANGUAGES.map((code) => {
          const id = `${idPrefix}-${code}`;
          return (
            <label key={code} htmlFor={id} className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input
                id={id}
                type="checkbox"
                className="h-4 w-4 accent-[var(--primary)]"
                checked={value.includes(code)}
                onChange={(e) => onChange(e.target.checked ? [...value, code] : value.filter((c) => c !== code))}
              />
              {languageName(code)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function upcomingConflictMessage(err: ApiClientError): string {
  const count = err.details?.count?.[0] ?? err.details?.consultations?.[0];
  return count
    ? `Bu koordinatörün ${count} gelecek görüşmesi var. Önce bu görüşmeleri iptal edin, sonra pasifleştirin.`
    : "Bu koordinatörün gelecek görüşmeleri var. Önce bu görüşmeleri iptal edin, sonra pasifleştirin.";
}

function errorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === "COORDINATOR_HAS_UPCOMING_CONSULTATIONS") return upcomingConflictMessage(err);
    if (err.code === "COORDINATOR_NOT_ELIGIBLE") return "Bu kullanıcı koordinatör olamaz (doktor profili olan kullanıcılar koordinatör yapılamaz).";
  }
  return friendlyErrorMessage(err);
}

/** `/admin/service-desk/coordinators` — atama, görünen ad, diller ve aktif/pasif. */
export function CoordinatorsManager() {
  const [coordinators, setCoordinators] = useState<Coordinator[] | null>(null);
  const [candidates, setCandidates] = useState<CoordinatorCandidate[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [list, cands] = await Promise.all([listCoordinators(), listCoordinatorCandidates()]);
      setCoordinators(list);
      setCandidates(cands);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ilk yükleme
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeading icon={Users} title="Koordinatörler" description="Online görüşmeleri yürüten hasta koordinatörleri. Aday olarak yalnızca doktor profili olmayan aktif editör ve müdür hesapları listelenir." />
      <ServiceDeskNav />
      {loadError && (
        <Alert variant="error">
          <span className="flex flex-wrap items-center gap-3">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{loadError}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
              Yeniden dene
            </Button>
          </span>
        </Alert>
      )}
      {coordinators === null && !loadError && (
        <div className="space-y-3" role="status" aria-busy="true" data-testid="coordinators-loading">
          <span className="sr-only">Yükleniyor</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {coordinators !== null && (
        <>
          <AddCoordinatorCard candidates={candidates} onAdded={() => void load()} />
          <Card className="space-y-3">
            <h2 className="admin-h2">Atanmış koordinatörler</h2>
            {coordinators.length === 0 ? (
              <EmptyState icon={UserCheck} title="Henüz koordinatör yok" description="Yukarıdan bir kullanıcıyı koordinatör yapın. Rezervasyonu açmak için en az bir aktif koordinatör gerekir." />
            ) : (
              <ul className="divide-y divide-border" aria-label="Koordinatörler">
                {coordinators.map((c) => (
                  <CoordinatorRow key={c.id} coordinator={c} onChanged={() => void load()} />
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function AddCoordinatorCard({ candidates, onAdded }: { candidates: CoordinatorCandidate[]; onAdded: () => void }) {
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(id: string) {
    setUserId(id);
    const cand = candidates.find((c) => c.id === id);
    setDisplayName(cand ? defaultDisplayName(cand.name) : "");
  }

  async function submit() {
    if (!userId) {
      setError("Bir kullanıcı seçin.");
      return;
    }
    if (languages.length === 0) {
      setError("En az bir dil seçin.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await createCoordinator({ userId, displayName: displayName.trim() || undefined, languages });
      toast.success("Koordinatör eklendi.");
      setUserId("");
      setDisplayName("");
      setLanguages(["en"]);
      onAdded();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="space-y-4" data-testid="coordinator-add-card">
      <h2 className="admin-h2 flex items-center gap-2">
        <UserPlus className="h-4 w-4" aria-hidden="true" />
        Koordinatör yap
      </h2>
      {error && <Alert variant="error">{error}</Alert>}
      {candidates.length === 0 ? (
        <p className="admin-text-secondary" data-testid="coordinator-no-candidates">
          Uygun aday yok. Önce Kullanıcılar sayfasından aktif bir editör hesabı oluşturun (doktor profili olmayan).
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="coordinator-user" label="Kullanıcı" required>
              {(p) => (
                <Select {...p} value={userId} onChange={(e) => pick(e.target.value)}>
                  <option value="">Seçin</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.email})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="coordinator-display-name" label="Görünen ad" hint="Hasta ve odada &quot;Patient Coordinator · Ad S.&quot; olarak görünür; unvan yazmayın.">
              {(p) => <Input {...p} maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
            </Field>
          </div>
          <LanguageCheckboxes idPrefix="coordinator-new-lang" legend="Konuştuğu diller" value={languages} onChange={setLanguages} />
          <Button type="button" loading={saving} onClick={() => void submit()}>
            Koordinatör yap
          </Button>
        </>
      )}
    </Card>
  );
}

function CoordinatorRow({ coordinator, onChanged }: { coordinator: Coordinator; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(coordinator.displayName);
  const [languages, setLanguages] = useState<string[]>(coordinator.languages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(input: { displayName?: string; languages?: string[]; isActive?: boolean }, success: string) {
    setError(null);
    setSaving(true);
    try {
      await updateCoordinator(coordinator.id, input);
      toast.success(success);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-3 py-3" data-testid={`coordinator-row-${coordinator.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <bdi>{coordinator.displayName}</bdi>
            <Badge tone={coordinator.isActive ? "success" : "neutral"}>{coordinator.isActive ? "Aktif" : "Pasif"}</Badge>
          </p>
          <p className="text-xs text-foreground/60">
            {coordinator.user?.name ? `${coordinator.user.name} - ` : ""}
            {coordinator.user?.email ?? ""}
          </p>
          <p className="text-xs text-foreground/60">Diller: {coordinator.languages.length ? coordinator.languages.map(languageName).join(", ") : "-"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" aria-label={`${coordinator.displayName} düzenle`} onClick={() => setEditing((v) => !v)}>
            {editing ? "Vazgeç" : "Düzenle"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={coordinator.isActive ? "outline" : "default"}
            loading={saving && !editing}
            aria-label={`${coordinator.displayName} ${coordinator.isActive ? "pasifleştir" : "aktifleştir"}`}
            onClick={() => void patch({ isActive: !coordinator.isActive }, coordinator.isActive ? "Koordinatör pasifleştirildi." : "Koordinatör aktifleştirildi.")}
          >
            {coordinator.isActive ? "Pasifleştir" : "Aktifleştir"}
          </Button>
        </div>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {editing && (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <Field id={`coordinator-name-${coordinator.id}`} label="Görünen ad">
            {(p) => <Input {...p} maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />}
          </Field>
          <LanguageCheckboxes idPrefix={`coordinator-lang-${coordinator.id}`} legend="Konuştuğu diller" value={languages} onChange={setLanguages} />
          <Button
            type="button"
            size="sm"
            loading={saving}
            onClick={() => {
              if (!displayName.trim()) {
                setError("Görünen ad boş olamaz.");
                return;
              }
              void patch({ displayName: displayName.trim(), languages }, "Koordinatör güncellendi.");
            }}
          >
            Kaydet
          </Button>
        </div>
      )}
    </li>
  );
}
