"use client";

import { useMemo, useState, type ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import { Link2, Plus, Search } from "lucide-react";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";

export interface PickableContentItem {
  id: string;
  title: string;
  href: string;
}

interface ContentSectionProps {
  items: PickableContentItem[];
  existingHrefs: Set<string>;
  onAdd: (items: { label: string; href: string }[]) => void;
}

function ContentSection({ items, existingHrefs, onAdd }: ContentSectionProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.title.toLowerCase().includes(query));
  }, [items, search]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleAdd() {
    const toAdd = items
      .filter((item) => selected.has(item.id))
      .map((item) => ({ label: item.title, href: item.href }));
    if (toAdd.length === 0) return;
    onAdd(toAdd);
    setSelected(new Set());
  }

  return (
    <div className="space-y-2 px-1 py-2">
      {items.length > 10 && (
        <InputGroup className="w-full">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Ara…"
            aria-label="İçerikte ara"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
      )}

      {items.length === 0 ? (
        <p className="px-2 py-3 text-xs text-foreground/50">Yayında içerik yok.</p>
      ) : (
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {filtered.map((item) => {
            const alreadyInMenu = existingHrefs.has(item.href);
            return (
              <label
                key={item.id}
                className={
                  alreadyInMenu
                    ? "flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm opacity-50 transition-colors"
                    : "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-surface-muted"
                }
              >
                {/* `aria-label` KASITLI OLARAK verilmez — bu checkbox saran `<label>` elemanının
                    içinde, o `<label>`'ın metin içeriği (başlık + varsa "Eklendi" rozeti) zaten
                    erişilebilir ismi oluşturur. Ayrıca `aria-label` eklemek çakışan/çift bir isim
                    üretir (bkz. qa/a11y bulgusu — axe "accessible name" ihlali). */}
                <Checkbox
                  checked={alreadyInMenu || selected.has(item.id)}
                  disabled={alreadyInMenu}
                  onCheckedChange={(checked) => toggle(item.id, checked === true)}
                />
                <span className="flex-1 truncate text-foreground">{item.title}</span>
                {alreadyInMenu && (
                  <Badge tone="neutral" size="sm">
                    Eklendi
                  </Badge>
                )}
              </label>
            );
          })}
        </div>
      )}

      <Button type="button" variant="secondary" size="sm" disabled={selected.size === 0} onClick={handleAdd}>
        <Plus className="h-4 w-4" />
        Menüye Ekle
      </Button>
    </div>
  );
}

interface CustomLinkSectionProps {
  hrefHint: string;
  onAdd: (items: { label: string; href: string }[]) => void;
}

function CustomLinkSection({ hrefHint, onAdd }: CustomLinkSectionProps) {
  const [label, setLabel] = useState("");
  const [href, setHref] = useState("");

  function handleAdd() {
    if (!label.trim() || !href.trim()) return;
    onAdd([{ label: label.trim(), href: href.trim() }]);
    setLabel("");
    setHref("");
  }

  return (
    <div className="space-y-2 px-1 py-2">
      <div className="space-y-1.5">
        <label htmlFor="custom-link-label" className="block text-xs font-medium text-foreground/70">
          Etiket
        </label>
        <Input id="custom-link-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ör. Kampanyalar" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="custom-link-href" className="block text-xs font-medium text-foreground/70">
          Bağlantı
        </label>
        <Input id="custom-link-href" value={href} onChange={(e) => setHref(e.target.value)} placeholder="/kampanyalar" />
      </div>
      <p className="text-xs text-foreground/50">{hrefHint}</p>
      <Button type="button" variant="secondary" size="sm" disabled={!label.trim() || !href.trim()} onClick={handleAdd}>
        <Plus className="h-4 w-4" />
        Ekle
      </Button>
    </div>
  );
}

export interface ContentPickerSection {
  key: string;
  label: string;
  icon: ComponentType<LucideProps>;
  items: PickableContentItem[];
}

interface ContentPickerPanelProps {
  sections: ContentPickerSection[];
  existingHrefs: Set<string>;
  hrefHint: string;
  onAddItems: (items: { label: string; href: string }[]) => void;
}

/** Sol panel — Karar 2.1/2.2: içerik türü accordion'ları + "Özel Bağlantılar" manuel giriş bölümü. */
export function ContentPickerPanel({ sections, existingHrefs, hrefHint, onAddItems }: ContentPickerPanelProps) {
  return (
    <Accordion multiple defaultValue={["pages"]}>
      {sections.map((section) => (
        <AccordionItem key={section.key} value={section.key}>
          <AccordionTrigger>
            <section.icon className="h-4 w-4 shrink-0 text-foreground/50" />
            <span className="flex-1 text-left">{section.label}</span>
            <Badge tone="neutral" size="sm">
              {section.items.length}
            </Badge>
          </AccordionTrigger>
          <AccordionPanel>
            <ContentSection items={section.items} existingHrefs={existingHrefs} onAdd={onAddItems} />
          </AccordionPanel>
        </AccordionItem>
      ))}
      <AccordionItem value="custom">
        <AccordionTrigger>
          <Link2 className="h-4 w-4 shrink-0 text-foreground/50" />
          <span className="flex-1 text-left">Özel Bağlantılar</span>
        </AccordionTrigger>
        <AccordionPanel>
          <CustomLinkSection hrefHint={hrefHint} onAdd={onAddItems} />
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}
