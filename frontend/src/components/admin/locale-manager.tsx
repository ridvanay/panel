"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  MoreVertical,
  Plus,
} from "lucide-react";
import * as localesApi from "@/lib/api/locales";
import type { Locale } from "@/lib/api/types";
import { useT } from "@/context/i18n-context";
import { friendlyErrorMessage } from "@/lib/api/friendly-error";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface LocaleFormState {
  code: string;
  label: string;
  nativeLabel: string;
  enabled: boolean;
  hreflang: string;
}

const EMPTY_FORM: LocaleFormState = { code: "", label: "", nativeLabel: "", enabled: false, hreflang: "" };

function AddLocaleDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (locale: Locale) => void;
}) {
  const [form, setForm] = useState<LocaleFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dialog her açılışta formu sıfırlar (appearance panelindeki AYNI desen)
      setForm(EMPTY_FORM);
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    try {
      const locale = await localesApi.createLocale({
        code: form.code.trim().toLowerCase(),
        label: form.label.trim(),
        nativeLabel: form.nativeLabel.trim(),
        enabled: form.enabled,
        hreflang: form.hreflang.trim() || null,
      });
      toast.success(`"${locale.nativeLabel}" eklendi.`);
      onCreated(locale);
      onOpenChange(false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dil Ekle</DialogTitle>
          <DialogDescription>Yeni bir dil eklemek deploy/migration gerektirmez.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <Alert variant="error">
              <span className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </span>
            </Alert>
          )}
          <Field id="locale-code" label="Kod" required hint='Oluşturulduktan sonra değiştirilemez (ör. "en", "de", "en-gb").'>
            {(inputProps) => (
              <Input
                {...inputProps}
                required
                placeholder="en"
                value={form.code}
                onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
              />
            )}
          </Field>
          <Field id="locale-label" label="Etiket" required hint="Yönetim panelinde gösterilen ad (panel dilinde).">
            {(inputProps) => (
              <Input
                {...inputProps}
                required
                placeholder="İngilizce"
                value={form.label}
                onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
              />
            )}
          </Field>
          <Field id="locale-nativeLabel" label="Kendi Dilindeki Ad" required hint="Site dil değiştiricide bu gösterilir.">
            {(inputProps) => (
              <Input
                {...inputProps}
                required
                placeholder="English"
                value={form.nativeLabel}
                onChange={(e) => setForm((prev) => ({ ...prev, nativeLabel: e.target.value }))}
              />
            )}
          </Field>
          <Field id="locale-hreflang" label="hreflang override (opsiyonel)" hint='Boşsa kod kullanılır (ör. "en-GB").'>
            {(inputProps) => (
              <Input
                {...inputProps}
                value={form.hreflang}
                onChange={(e) => setForm((prev) => ({ ...prev, hreflang: e.target.value }))}
              />
            )}
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-foreground">Etkin</p>
              <p className="text-xs text-foreground/60">
                Etkinleştirilirse ANINDA public site rota uzayına girer — çeviri hazır olana kadar kapalı bırakmanız önerilir.
              </p>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm((prev) => ({ ...prev, enabled: v }))} />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            type="button"
            loading={saving}
            disabled={!form.code.trim() || !form.label.trim() || !form.nativeLabel.trim()}
            onClick={handleSubmit}
          >
            Dili Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteLocaleDialog({
  locale,
  onOpenChange,
  onDeleted,
}: {
  locale: Locale;
  onOpenChange: (open: boolean) => void;
  onDeleted: (code: string) => void;
}) {
  const [confirmInput, setConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasTranslations = (locale.translatedContentCount ?? 0) > 0;

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await localesApi.deleteLocale(locale.code);
      toast.success(`"${locale.nativeLabel}" silindi.`);
      onDeleted(locale.code);
      onOpenChange(false);
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  // Kademe A — çevrilmiş içerik yok: standart tek-tık `ConfirmDialog tone="danger"` yeterli.
  if (!hasTranslations) {
    return (
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title={`"${locale.nativeLabel}" dilini sil`}
        description={`"${locale.nativeLabel}" dili silinecek. Bu dilde yayınlanmış çeviri bulunmuyor, veri kaybı riski yok.`}
        confirmText="Sil"
        tone="danger"
        loading={deleting}
        onConfirm={handleDelete}
      />
    );
  }

  // Kademe B — çevrilmiş içerik VAR: "kod yaz-ve-onayla" deseni (design-notes-i18n.md §6.4).
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </span>
            <DialogTitle>&quot;{locale.nativeLabel}&quot; dilini kalıcı olarak sil</DialogTitle>
          </div>
        </DialogHeader>

        {error && (
          <Alert variant="error">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </span>
          </Alert>
        )}

        <Alert variant="error">
          <ul className="list-disc space-y-1 pl-4">
            <li>
              <strong>{locale.translatedContentCount} çevrilmiş içerik</strong> kalıcı olarak silinecek.
            </li>
            <li>
              <code>/{locale.code}/...</code> altındaki tüm URL&apos;ler 404 dönmeye başlayacak.
            </li>
            <li>
              Bu işlem <strong>geri alınamaz</strong>.
            </li>
          </ul>
        </Alert>

        <Field id="confirm-locale-code" label={`Onaylamak için dil kodunu yazın: "${locale.code}"`}>
          {(inputProps) => (
            <Input {...inputProps} value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} autoComplete="off" />
          )}
        </Field>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Vazgeç
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={deleting}
            disabled={confirmInput.trim().toLowerCase() !== locale.code}
            onClick={handleDelete}
          >
            Dili Kalıcı Olarak Sil
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LocaleManager() {
  const t = useT();
  const [locales, setLocales] = useState<Locale[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [makeDefaultTarget, setMakeDefaultTarget] = useState<Locale | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Locale | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await localesApi.listAdminLocales();
      setLocales([...data].sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const sorted = useMemo(() => [...locales].sort((a, b) => a.sortOrder - b.sortOrder), [locales]);
  const defaultLocale = sorted.find((l) => l.isDefault) ?? null;

  async function handleToggleEnabled(locale: Locale) {
    setBusyCode(locale.code);
    try {
      const updated = await localesApi.updateLocale(locale.code, { enabled: !locale.enabled });
      setLocales((prev) => prev.map((l) => (l.code === updated.code ? updated : l)));
      toast.success(
        updated.enabled
          ? `"${updated.nativeLabel}" etkinleştirildi.`
          : `"${updated.nativeLabel}" devre dışı bırakıldı — çeviriler korundu, /${updated.code}/... rotaları artık erişilemez.`
      );
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyCode(null);
    }
  }

  async function handleMove(locale: Locale, direction: "up" | "down") {
    const index = sorted.findIndex((l) => l.code === locale.code);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapIndex < 0 || swapIndex >= sorted.length) return;
    const other = sorted[swapIndex]!;
    setBusyCode(locale.code);
    try {
      const [updatedA, updatedB] = await Promise.all([
        localesApi.updateLocale(locale.code, { sortOrder: other.sortOrder }),
        localesApi.updateLocale(other.code, { sortOrder: locale.sortOrder }),
      ]);
      setLocales((prev) =>
        prev.map((l) => {
          if (l.code === updatedA.code) return updatedA;
          if (l.code === updatedB.code) return updatedB;
          return l;
        })
      );
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyCode(null);
    }
  }

  async function handleMakeDefault() {
    if (!makeDefaultTarget) return;
    setBusyCode(makeDefaultTarget.code);
    try {
      const updated = await localesApi.updateLocale(makeDefaultTarget.code, { isDefault: true });
      await load();
      toast.success(`"${updated.nativeLabel}" varsayılan dil yapıldı.`);
      setMakeDefaultTarget(null);
    } catch (err) {
      toast.error(friendlyErrorMessage(err));
    } finally {
      setBusyCode(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="error">
        <span className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
            Tekrar Dene
          </Button>
        </span>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" />
          {t("localeManager.addLocale")}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Sıra</TableHead>
            <TableHead>{t("localeManager.columnLanguage")}</TableHead>
            <TableHead>{t("localeManager.columnStatus")}</TableHead>
            <TableHead>{t("localeManager.columnDefault")}</TableHead>
            <TableHead>{t("localeManager.columnTranslated")}</TableHead>
            <TableHead className="text-right">{t("localeManager.columnActions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((locale, index) => (
            <TableRow key={locale.code}>
              <TableCell>
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Yukarı taşı"
                    disabled={index === 0 || busyCode === locale.code}
                    onClick={() => void handleMove(locale, "up")}
                  >
                    <ArrowUp className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Aşağı taşı"
                    disabled={index === sorted.length - 1 || busyCode === locale.code}
                    onClick={() => void handleMove(locale, "down")}
                  >
                    <ArrowDown className="h-3 w-3" />
                  </Button>
                </div>
              </TableCell>
              <TableCell>
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground" title={locale.nativeLabel}>
                    {locale.nativeLabel}
                  </p>
                  <p className="truncate text-xs text-foreground/60">
                    {locale.code} · {locale.label}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <Badge tone={locale.enabled ? "success" : "neutral"} size="sm">
                  {locale.enabled ? t("localeManager.statusEnabled") : t("localeManager.statusDisabled")}
                </Badge>
              </TableCell>
              <TableCell>
                {locale.isDefault ? (
                  <Badge tone="primary" solid size="sm">
                    {t("localeManager.badgeDefault")}
                  </Badge>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busyCode === locale.code}
                    onClick={() => setMakeDefaultTarget(locale)}
                  >
                    {t("localeManager.makeDefault")}
                  </Button>
                )}
              </TableCell>
              <TableCell className="tabular-nums text-xs text-foreground/60">
                {t("localeManager.contentCount", { count: locale.translatedContentCount ?? 0 })}
              </TableCell>
              <TableCell className="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="İşlemler" />}>
                    <MoreVertical className="h-4 w-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void handleToggleEnabled(locale)} disabled={locale.isDefault}>
                      {locale.enabled ? t("localeManager.statusDisabled") : t("localeManager.statusEnabled")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={locale.isDefault}
                      title={locale.isDefault ? "Varsayılan dil silinemez" : undefined}
                      onClick={() => !locale.isDefault && setDeleteTarget(locale)}
                    >
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AddLocaleDialog open={addOpen} onOpenChange={setAddOpen} onCreated={() => void load()} />

      {makeDefaultTarget && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setMakeDefaultTarget(null)}
          title={`"${makeDefaultTarget.nativeLabel}" dilini varsayılan yap`}
          description={`Bu işlem site URL yapısını değiştirir: "${defaultLocale?.nativeLabel ?? ""}" içerik artık /${defaultLocale?.code ?? ""}/... altında yayınlanır, "${makeDefaultTarget.nativeLabel}" ise prefix'siz hale gelir. Mevcut bağlantılar 301 ile yönlendirilir ama arama motoru sıralaması geçici olarak etkilenebilir.`}
          confirmText="Varsayılanı Değiştir"
          cancelText="Vazgeç"
          tone="warning"
          loading={busyCode === makeDefaultTarget.code}
          onConfirm={() => void handleMakeDefault()}
        />
      )}

      {deleteTarget && (
        <DeleteLocaleDialog
          locale={deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onDeleted={() => void load()}
        />
      )}
    </div>
  );
}
