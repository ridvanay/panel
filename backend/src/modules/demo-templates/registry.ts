import { assertDemoTemplateCaps, type DemoTemplateDefinition } from "./types";
import { MODERN_ARCHITECTURE_TEMPLATE } from "./templates/modern-architecture";
import { ECOMMERCE_PRO_TEMPLATE } from "./templates/ecommerce-pro";

/**
 * Kod içi statik şablon registry'si — `MODULE_REGISTRY`/`APPEARANCE_PRESETS` ile AYNI patern
 * (§0/§1.1/§2 madde 1). Yeni bir şablon eklemek = `templates/<key>.ts` yazmak +
 * `DEMO_TEMPLATE_REGISTRY`'ye eklemek; DB migration GEREKMEZ.
 */
export const DEMO_TEMPLATE_REGISTRY: DemoTemplateDefinition[] = [MODERN_ARCHITECTURE_TEMPLATE, ECOMMERCE_PRO_TEMPLATE];

// §3.3 — kayıt hacmi tavanları modül YÜKLEME anında zorlanır ("derlenmez/testten geçmez").
for (const definition of DEMO_TEMPLATE_REGISTRY) {
  assertDemoTemplateCaps(definition);
}

const keys = new Set(DEMO_TEMPLATE_REGISTRY.map((d) => d.key));
if (keys.size !== DEMO_TEMPLATE_REGISTRY.length) {
  throw new Error("DEMO_TEMPLATE_REGISTRY içinde yinelenen `key` bulundu.");
}

export function getDemoTemplate(key: string): DemoTemplateDefinition | undefined {
  return DEMO_TEMPLATE_REGISTRY.find((definition) => definition.key === key);
}
