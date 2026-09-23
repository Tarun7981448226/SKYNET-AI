import { WallpaperVideo } from "@/components/WallpaperVideo";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

export default function DashboardPage() {
  return (
    <div className="min-h-screen px-6 py-10">
      <WallpaperVideo />
      <DashboardShell />
    </div>
  );
}
