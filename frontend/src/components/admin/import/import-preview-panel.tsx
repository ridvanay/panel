"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import * as importApi from "@/lib/api/import";
import * as usersAdminApi from "@/lib/api/users-admin";
import * as blogApi from "@/lib/api/blog";
import type {
  AdminUser,
  BlogCategory,
  ContentStatus,
  ImportDuplicateStrategy,
  ImportFieldMapping,
  ImportJob,
  StartImportJobRequest,
} from "@/lib/api/types";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import {
  IMPORT_DUPLICATE_STRATEGY_LABELS,
  IMPORT_PREVIEW_FIELD_STATUS_LABELS,
  IMPORT_PREVIEW_FIELD_STATUS_TONES,
} from "./import-labels";
import { allowedDuplicateStrategies } from "./import-duplicate-strategy";

const BREAKDOWN_LABELS: Record<string, string> = {
  pages: "sayfa",
  posts: "yazı",
  attachments: "medya bağlantısı",
  categories: "kategori",
  products: "ürün",
  skipped: "desteklenmeyen öğe (atlandı)",
};

/** ISO-4217 — tam liste gerekmiyor (openapi.yaml `defaultCurrency` notu), yaygın birkaçı yeterli. */
const DEFAULT_CURRENCY_OPTIONS = ["TRY", "USD", "EUR", "GBP"] as const;

function formatSampleValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Evet" : "Hayır";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface ImportPreviewPanelProps {
  job: ImportJob;
  onStarted: (job: ImportJob) => void;
}

/**
 * "İçe Aktar" akışının 2. ADIMI (onay ekranı) — yalnızca `status: PENDING` işlerde
 * gösterilir. `job.preview` (openapi `ImportJobPreview`) alan eşleştirmesi/örnekleri/
 * uyarıları taşır; burada HİÇBİR kayıt henüz yazılmamıştır. `POST .../start` çağrısı
 * `202` ile döner ve arka planda işlemeyi başlatır (bkz. ARCHITECTURE.md §10.8.1).
 */
export function ImportPreviewPanel({ job, onStarted }: ImportPreviewPanelProps) {
  const preview = job.preview;

  const showMapping = job.type === "PAGES" || job.type === "BLOG" || job.type === "USERS";
  const showDefaultStatus = job.type === "PAGES" || job.type === "BLOG" || job.type === "PRODUCTS";
  const showDefaultAuthor = job.type === "PAGES" || job.type === "BLOG" || job.type === "WORDPRESS";
  const showDefaultCategory = job.type === "BLOG";
  // YALNIZCA `PRODUCTS` — WooCommerce WXR'ı para birimini item düzeyinde TAŞIMAZ (bkz.
  // openapi.yaml `StartImportJobRequest.defaultCurrency`, ARCHITECTURE.md §10.8.9).
  const showDefaultCurrency = job.type === "PRODUCTS";
  const strategyOptions = allowedDuplicateStrategies(job.type);

  // Lazy initializer (bir kere, mount'ta) — `[jobId]/page.tsx` bu paneli `key={job.id}` ile
  // render eder, bu yüzden farklı bir işe geçildiğinde bileşen zaten yeniden mount edilir;
  // ayrı bir "job.id değişince sıfırla" effect'ine GEREK YOKTUR (bkz. React "you might not
  // need an effect" — `react-hooks/set-state-in-effect` kuralı da bunu zorunlu kılıyor).
  const [fieldMapping, setFieldMapping] = useState<ImportFieldMapping>(() => {
    if (!preview) return {};
    const initial: ImportFieldMapping = {};
    for (const field of preview.fields) {
      initial[field.sourceField] = field.targetField;
    }
    return { ...initial, ...preview.suggestedMapping };
  });
  const [duplicateStrategy, setDuplicateStrategy] = useState<ImportDuplicateStrategy>(strategyOptions[0] ?? "skip");
  const [defaultStatus, setDefaultStatus] = useState<ContentStatus>("DRAFT");
  const [defaultAuthorId, setDefaultAuthorId] = useState<string>("");
  const [defaultCategoryId, setDefaultCategoryId] = useState<string>("");
  const [defaultCurrency, setDefaultCurrency] = useState<string>("TRY");

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (showDefaultAuthor) {
      usersAdminApi
        .listAllAdminUsers()
        .then(setUsers)
        .catch(() => setUsers([]));
    }
    if (showDefaultCategory) {
      blogApi
        .listCategories()
        .then(setCategories)
        .catch(() => setCategories([]));
    }
  }, [showDefaultAuthor, showDefaultCategory]);

  if (!preview) {
    return <Alert variant="error">Bu iş için önizleme verisi bulunamadı.</Alert>;
  }

  async function handleStart() {
    setStarting(true);
    setStartError(null);
    try {
      const body: StartImportJobRequest = { duplicateStrategy };
      if (showMapping) body.fieldMapping = fieldMapping;
      if (showDefaultStatus) body.defaultStatus = defaultStatus;
      if (showDefaultAuthor && defaultAuthorId) body.defaultAuthorId = defaultAuthorId;
      if (showDefaultCategory && defaultCategoryId) body.defaultCategoryId = defaultCategoryId;
      if (showDefaultCurrency) body.defaultCurrency = defaultCurrency;
      const updated = await importApi.startImportJob(job.id, body);
      toast.success("İçe aktarma başlatıldı.");
      onStarted(updated);
    } catch (err) {
      setStartError(friendlyErrorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  const sampleColumns = Array.from(new Set(preview.samples.flatMap((sample) => Object.keys(sample))));

  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="admin-h2">Önizleme</h2>
            <p className="admin-text-secondary">
              Dosyada <strong className="text-foreground">{preview.totalCount}</strong> işlenebilir kayıt bulundu.
              Henüz hiçbir şey kaydedilmedi.
            </p>
          </div>
          {!preview.canStart && (
            <Badge tone="danger" size="lg">
              Başlatılamaz
            </Badge>
          )}
        </div>

        {!preview.canStart && (
          <Alert variant="error">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Zorunlu bir hedef alan dosyada bulunamadı. Aşağıdaki tabloda &quot;{
                IMPORT_PREVIEW_FIELD_STATUS_LABELS.missingRequired
              }&quot; olarak işaretli satırı kontrol edin.
            </span>
          </Alert>
        )}

        {preview.breakdown && (
          <div className="flex flex-wrap gap-2">
            {Object.entries(preview.breakdown)
              .filter(([, count]) => typeof count === "number")
              .map(([key, count]) => (
                <Badge key={key} tone={key === "skipped" ? "warning" : "neutral"}>
                  {count} {BREAKDOWN_LABELS[key] ?? key}
                </Badge>
              ))}
          </div>
        )}

        {preview.warnings.length > 0 && (
          <Alert variant="info">
            <p className="mb-1.5 font-medium text-foreground">Onaydan önce dikkat edilmesi gerekenler</p>
            <ul className="space-y-1">
              {preview.warnings.map((warning, index) => (
                <li key={`${warning.code}-${index}`} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <span>
                    {warning.message}
                    {typeof warning.count === "number" && ` (${warning.count})`}
                  </span>
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </Card>

      {preview.fields.length > 0 && (
        <Card className="space-y-3 p-0">
          <div className="p-4 pb-0">
            <h3 className="admin-h3">Alan Eşleştirme</h3>
            <p className="admin-text-secondary">
              {showMapping
                ? "Otomatik eşleşmeyi gerekirse aşağıdan değiştirebilirsiniz."
                : "Bu içe aktarma türünde eşleştirme sabittir, değiştirilemez."}
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kaynak Alan</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>Hedef Alan</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.fields.map((field) => (
                <TableRow key={field.sourceField}>
                  <TableCell className="font-medium text-foreground">{field.sourceField}</TableCell>
                  <TableCell>
                    <Badge tone={IMPORT_PREVIEW_FIELD_STATUS_TONES[field.status]}>
                      {IMPORT_PREVIEW_FIELD_STATUS_LABELS[field.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {showMapping ? (
                      <Select
                        aria-label={`${field.sourceField} için hedef alan`}
                        value={fieldMapping[field.sourceField] ?? ""}
                        onChange={(e) =>
                          setFieldMapping((prev) => ({
                            ...prev,
                            [field.sourceField]: e.target.value === "" ? null : e.target.value,
                          }))
                        }
                        className="w-48"
                      >
                        <option value="">— Yok say —</option>
                        {preview.targetFields.map((target) => (
                          <option key={target} value={target}>
                            {target}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <span className="text-foreground/70">{field.targetField ?? "—"}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {preview.samples.length > 0 && (
        <Card className="space-y-3 p-0">
          <div className="p-4 pb-0">
            <h3 className="admin-h3">Örnek Kayıtlar</h3>
            <p className="admin-text-secondary">Dosyanın ilk {preview.samples.length} kaydı, eşleştirme uygulanmış hâliyle.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {sampleColumns.map((col) => (
                  <TableHead key={col}>{col}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.samples.map((sample, index) => (
                <TableRow key={index}>
                  {sampleColumns.map((col) => (
                    <TableCell key={col} className="max-w-[220px] truncate" title={formatSampleValue(sample[col])}>
                      {formatSampleValue(sample[col])}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Card className="space-y-4">
        <h3 className="admin-h3">Onay Seçenekleri</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="duplicate-strategy" label="Mevcut kayıtla çakışma">
            {(inputProps) => (
              <Select
                {...inputProps}
                value={duplicateStrategy}
                disabled={strategyOptions.length <= 1}
                onChange={(e) => setDuplicateStrategy(e.target.value as ImportDuplicateStrategy)}
              >
                {strategyOptions.map((option) => (
                  <option key={option} value={option}>
                    {IMPORT_DUPLICATE_STRATEGY_LABELS[option]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {showDefaultStatus && (
            <Field
              id="default-status"
              label={
                job.type === "PRODUCTS"
                  ? "Ürünler için başlangıç durumu (tüm ürünlere uygulanır)"
                  : "Durum belirtilmeyen kayıtlar için varsayılan"
              }
            >
              {(inputProps) => (
                <Select {...inputProps} value={defaultStatus} onChange={(e) => setDefaultStatus(e.target.value as ContentStatus)}>
                  <option value="DRAFT">Taslak</option>
                  <option value="PUBLISHED">Yayında</option>
                </Select>
              )}
            </Field>
          )}

          {showDefaultCurrency && (
            <Field
              id="default-currency"
              label="Para birimi"
              hint="WooCommerce dışa aktarma dosyası para birimini taşımaz; içe aktarılan tüm ürünlere bu birim atanır."
            >
              {(inputProps) => (
                <Select {...inputProps} value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value)}>
                  {DEFAULT_CURRENCY_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {showDefaultAuthor && (
            <Field id="default-author" label="Yazarı çözümlenemeyen kayıtlar için varsayılan">
              {(inputProps) => (
                <Select {...inputProps} value={defaultAuthorId} onChange={(e) => setDefaultAuthorId(e.target.value)}>
                  <option value="">— Atanmasın —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.email})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}

          {showDefaultCategory && (
            <Field id="default-category" label="Kategorisi çözümlenemeyen yazılar için varsayılan">
              {(inputProps) => (
                <Select {...inputProps} value={defaultCategoryId} onChange={(e) => setDefaultCategoryId(e.target.value)}>
                  <option value="">— Atanmasın —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>

        {startError && <Alert variant="error">{startError}</Alert>}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          {preview.canStart && (
            <p className="mr-auto flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Başlatmaya hazır
            </p>
          )}
          <Button onClick={() => void handleStart()} loading={starting} disabled={!preview.canStart}>
            Onayla ve Başlat
          </Button>
        </div>
      </Card>
    </div>
  );
}
