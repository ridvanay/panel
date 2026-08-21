import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { newId } from "@/lib/page-builder/registry";
import { PRICING_MAX_FEATURES, PRICING_MAX_PLANS, type PricingPlan, type PricingTableBlock } from "@/lib/page-builder/types";

function newPlan(): PricingPlan {
  return {
    id: newId(),
    name: "Yeni Plan",
    price: "₺0",
    period: "/ay",
    description: "",
    features: [],
    highlighted: false,
    buttonLabel: "Satın Al",
    buttonHref: "/",
  };
}

export function PricingTableBlockEditor({
  block,
  onChange,
}: {
  block: PricingTableBlock;
  onChange: (block: PricingTableBlock) => void;
}) {
  const plans = block.data.plans;

  function updatePlan(id: string, patch: Partial<PricingPlan>) {
    onChange({ ...block, data: { ...block.data, plans: plans.map((plan) => (plan.id === id ? { ...plan, ...patch } : plan)) } });
  }

  function removePlan(id: string) {
    onChange({ ...block, data: { ...block.data, plans: plans.filter((plan) => plan.id !== id) } });
  }

  function movePlan(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= plans.length) return;
    const next = [...plans];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange({ ...block, data: { ...block.data, plans: next } });
  }

  function addPlan() {
    if (plans.length >= PRICING_MAX_PLANS) return;
    onChange({ ...block, data: { ...block.data, plans: [...plans, newPlan()] } });
  }

  function updateFeature(planId: string, index: number, value: string) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const features = [...plan.features];
    features[index] = value;
    updatePlan(planId, { features });
  }

  function removeFeature(planId: string, index: number) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    updatePlan(planId, { features: plan.features.filter((_, i) => i !== index) });
  }

  function addFeature(planId: string) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan || plan.features.length >= PRICING_MAX_FEATURES) return;
    // Boş satır BAŞLANGIÇTA konulmaz — backend her özellik satırını `.min(1)` ile doğrular
    // (bkz. `pages.schemas.ts::PricingTableBlockDataSchema`), `AccordionBlockEditor`nin
    // "Soru" varsayılanıyla AYNI gerekçe.
    updatePlan(planId, { features: [...plan.features, "Yeni özellik"] });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {plans.map((plan, index) => (
          <div key={plan.id} className="space-y-2 rounded-lg border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/50">Plan {index + 1}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Yukarı taşı"
                  onClick={() => movePlan(index, -1)}
                  disabled={index === 0}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Aşağı taşı"
                  onClick={() => movePlan(index, 1)}
                  disabled={index === plans.length - 1}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Planı sil"
                  onClick={() => removePlan(plan.id)}
                  disabled={plans.length <= 1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <Field id={`${plan.id}-name`} label="Plan adı" required>
              {(inputProps) => (
                <Input {...inputProps} value={plan.name} onChange={(e) => updatePlan(plan.id, { name: e.target.value })} />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${plan.id}-price`} label="Fiyat" required>
                {(inputProps) => (
                  <Input {...inputProps} value={plan.price} onChange={(e) => updatePlan(plan.id, { price: e.target.value })} />
                )}
              </Field>
              <Field id={`${plan.id}-period`} label="Dönem (opsiyonel)">
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    value={plan.period ?? ""}
                    onChange={(e) => updatePlan(plan.id, { period: e.target.value || undefined })}
                  />
                )}
              </Field>
            </div>
            <Field id={`${plan.id}-description`} label="Açıklama (opsiyonel)">
              {(inputProps) => (
                <Textarea
                  {...inputProps}
                  rows={2}
                  value={plan.description ?? ""}
                  onChange={(e) => updatePlan(plan.id, { description: e.target.value })}
                />
              )}
            </Field>

            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Özellikler</p>
              <div className="space-y-1.5">
                {plan.features.map((feature, featureIndex) => (
                  <div key={featureIndex} className="flex items-center gap-1.5">
                    <Input
                      aria-label={`Özellik ${featureIndex + 1}`}
                      value={feature}
                      onChange={(e) => updateFeature(plan.id, featureIndex, e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Özelliği sil"
                      onClick={() => removeFeature(plan.id, featureIndex)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => addFeature(plan.id)}
                disabled={plan.features.length >= PRICING_MAX_FEATURES}
              >
                <Plus className="h-4 w-4" />
                Özellik Ekle
              </Button>
            </div>

            <div className="flex items-center justify-between">
              <label htmlFor={`${plan.id}-highlighted`} className="text-sm font-medium text-foreground">
                Öne çıkan plan
              </label>
              <Switch
                id={`${plan.id}-highlighted`}
                checked={plan.highlighted ?? false}
                onCheckedChange={(highlighted) => updatePlan(plan.id, { highlighted })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${plan.id}-button-label`} label="Buton metni" required>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    value={plan.buttonLabel}
                    onChange={(e) => updatePlan(plan.id, { buttonLabel: e.target.value })}
                  />
                )}
              </Field>
              <Field id={`${plan.id}-button-href`} label="Buton bağlantısı" required>
                {(inputProps) => (
                  <Input
                    {...inputProps}
                    value={plan.buttonHref}
                    onChange={(e) => updatePlan(plan.id, { buttonHref: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={addPlan} disabled={plans.length >= PRICING_MAX_PLANS}>
        <Plus className="h-4 w-4" />
        Plan Ekle
      </Button>
    </div>
  );
}
