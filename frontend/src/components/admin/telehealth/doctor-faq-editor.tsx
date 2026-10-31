"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { DoctorFaqItem } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const FAQ_MAX_ITEMS = 20;
export const FAQ_QUESTION_MAX = 200;
export const FAQ_ANSWER_MAX = 2000;

/** Boş satırları atar, metinleri kırpar — kaydetme öncesi. */
export function cleanFaq(items: DoctorFaqItem[]): DoctorFaqItem[] {
  return items.map((i) => ({ question: i.question.trim(), answer: i.answer.trim() })).filter((i) => i.question || i.answer);
}

/** Paket Y — profil SSS düzenleyici (düz metin; ekle/sil/sırala; en çok 20). */
export function DoctorFaqEditor({ items, onChange }: { items: DoctorFaqItem[]; onChange: (items: DoctorFaqItem[]) => void }) {
  function patch(index: number, change: Partial<DoctorFaqItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...change } : item)));
  }
  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" data-testid="doctor-faq-editor">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Sık Sorulan Sorular (SSS)</h2>
        <p className="text-xs text-foreground/60">
          Düz metin; HTML kullanılamaz. En çok {FAQ_MAX_ITEMS} soru. Doluysa profil sayfasında gösterilir ve arama motorları için SSS işaretlemesi eklenir.
        </p>
      </div>
      {items.length === 0 && <p className="text-xs text-foreground/60">Henüz soru eklenmedi.</p>}
      <ul className="space-y-3">
        {items.map((item, index) => (
          <li key={index} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-foreground/60">Soru {index + 1}</span>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" aria-label={`Soru ${index + 1} yukarı taşı`} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`Soru ${index + 1} aşağı taşı`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" aria-label={`Soru ${index + 1} sil`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Input aria-label={`Soru ${index + 1} metni`} maxLength={FAQ_QUESTION_MAX} placeholder="Soru" value={item.question} onChange={(e) => patch(index, { question: e.target.value })} />
            <Textarea aria-label={`Soru ${index + 1} cevabı`} rows={3} maxLength={FAQ_ANSWER_MAX} placeholder="Cevap" value={item.answer} onChange={(e) => patch(index, { answer: e.target.value })} />
          </li>
        ))}
      </ul>
      <Button type="button" variant="outline" size="sm" disabled={items.length >= FAQ_MAX_ITEMS} onClick={() => onChange([...items, { question: "", answer: "" }])}>
        <Plus className="h-4 w-4" />
        Soru ekle
      </Button>
    </div>
  );
}
