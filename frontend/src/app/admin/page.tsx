import { StatCard } from "@/components/admin/stats/stat-card";
import { VisitorChart } from "@/components/admin/stats/visitor-chart";

export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Genel Bakış</h1>
        <p className="mt-1 text-sm text-foreground/60">Sitenizin son durumu.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Toplam sayfa" value="—" />
        <StatCard label="Yayında blog yazısı" value="—" />
        <StatCard label="Bu ay ziyaretçi" value="—" />
        <StatCard label="Bu ay sayfa görüntüleme" value="—" />
      </div>

      <VisitorChart />
    </div>
  );
}
