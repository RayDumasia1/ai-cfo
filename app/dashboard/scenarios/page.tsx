import DashboardLayout from "@/app/components/DashboardLayout";
import ManualCalculator from "@/app/components/ManualCalculator";

export default function ScenariosPage() {
  return (
    <DashboardLayout>
      <div className="px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-medium text-ink">Scenarios</h1>
          <p className="mt-1 text-sm font-light text-dim">
            Model financial scenarios manually to plan ahead.
          </p>
        </div>

        <ManualCalculator />
      </div>
    </DashboardLayout>
  );
}
