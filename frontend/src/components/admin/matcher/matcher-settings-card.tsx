"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getMatcherSettings, updateMatcherSettings, type MatcherSettings } from "@/lib/api/matcher";
import { fieldErrorsFrom, friendlyErrorMessage } from "@/lib/api/friendly-error";

/**
 * Paket W — Tele-Sağlık → Ayarlar → "Eşleştirme sihirbazı": öneri eşiği, en çok önerilecek uzmanlık
 * sayısı, iletişim adımının zorunluluğu ve saklama süresi. Yazma yalnızca ADMIN; her değişiklik audit'e
 * (`matcher.settings_updated`, önce/sonra değerleriyle) yazılır.
 */
export function MatcherSettingsCard({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<MatcherSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    getMatcherSettings()
      .then(setSettings)
      .catch(() => {});
  }, []);

  if (!settings) return null;

  async function save(current: MatcherSettings) {
    setSaving(true);
    setErrors({});
    try {
      setSettings(await updateMatcherSettings(current));
      toast.success("Eşleştirme sihirbazı ayarları kaydedildi.");
    } catch (err) {
      setErrors(fieldErrorsFrom(err));
      toast.error(friendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const num = (value: string, fallback: number) => (Number.isFinite(Number(value)) && value.trim() !== "" ? Math.trunc(Number(value)) : fallback);

  return (
    <Card className="space-y-4" data-testid="matcher-settings">
      <div>
        <h2 className="admin-h2">Eşleştirme sihirbazı</h2>
        <p className="admin-text-secondary">“Hekimimi bul” sihirbazının öneri kuralı ve veri saklama ayarları. Konu kataloğu: Tele-Sağlık → Eşleştirme kataloğu.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Öneri eşiği (puan)</span>
          <Input
            type="number"
            min={1}
            max={300}
            disabled={!canEdit}
            value={settings.scoreThreshold}
            onChange={(e) => setSettings({ ...settings, scoreThreshold: num(e.target.value, settings.scoreThreshold) })}
            aria-describedby="matcher-threshold-help"
          />
          <span id="matcher-threshold-help" className="block text-xs text-foreground/60">
            Seçilen konuların ağırlık toplamı bu değere ulaşan uzmanlıklar önerilir (varsayılan 40).
          </span>
          {errors.scoreThreshold && <span className="block text-xs text-danger">{errors.scoreThreshold}</span>}
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">En çok önerilecek uzmanlık sayısı</span>
          <Input
            type="number"
            min={1}
            max={5}
            disabled={!canEdit}
            value={settings.maxSpecialties}
            onChange={(e) => setSettings({ ...settings, maxSpecialties: num(e.target.value, settings.maxSpecialties) })}
          />
          <span className="block text-xs text-foreground/60">1–5 (varsayılan 2). Hekimi olmayan uzmanlık her durumda önerilmez.</span>
          {errors.maxSpecialties && <span className="block text-xs text-danger">{errors.maxSpecialties}</span>}
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Saklama süresi (gün)</span>
          <Input
            type="number"
            min={30}
            max={3650}
            disabled={!canEdit}
            value={settings.retentionDays}
            onChange={(e) => setSettings({ ...settings, retentionDays: num(e.target.value, settings.retentionDays) })}
          />
          <span className="block text-xs text-foreground/60">Süre dolunca sihirbaz taleplerinin sağlık VE kişi alanları anonimleştirilir (varsayılan 365).</span>
        </label>
        <label className="flex items-center gap-3 self-start pt-6 text-sm">
          <Switch
            checked={settings.contactRequired}
            disabled={!canEdit}
            onCheckedChange={(v: boolean) => setSettings({ ...settings, contactRequired: v })}
            aria-label="İletişim adımı sonuçtan önce"
          />
          İletişim adımı sonuçtan önce (kapalıysa sonuçlardan sonra, isteğe bağlı)
        </label>
      </div>
      <p className="admin-text-secondary">İletişim izni verilmeyen gönderimlerde ad, telefon, e-posta ve sağlık bilgileri kaydedilmez; yalnızca anonim istatistik tutulur.</p>
      {canEdit && (
        <div className="flex justify-end">
          <Button type="button" loading={saving} onClick={() => void save(settings)}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Kaydet
          </Button>
        </div>
      )}
    </Card>
  );
}
