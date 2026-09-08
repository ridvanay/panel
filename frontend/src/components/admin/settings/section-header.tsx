import type { LucideIcon } from "lucide-react";

/** `/admin/settings` sekmelerindeki kart başlıklarının ortak deseni — ikon rozeti + başlık/açıklama. */
export function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <h2 className="admin-h2">{title}</h2>
        <p className="mt-0.5 admin-text-secondary">{description}</p>
      </div>
    </div>
  );
}
