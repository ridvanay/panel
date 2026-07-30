import { StatCard } from "@/components/admin/stats/stat-card";
import { VisitorChart } from "@/components/admin/stats/visitor-chart";

export default function AdminStatsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">İstatistikler</h1>
        <p className="mt-1 text-sm text-foreground/60">Ziyaretçi ve sayfa görüntüleme verileri.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Benzersiz ziyaretçi" value="—" />
        <StatCard label="Sayfa görüntüleme" value="—" />
        <StatCard label="Ortalama oturum süresi" value="—" />
      </div>

      <VisitorChart />
    </div>
  );
}
