"use client";

import Link from "next/link";
import { useState } from "react";
import ActionModal from "@/app/components/ActionModal";
import ManualCalculator from "@/app/components/ManualCalculator";
import type { ForecastDecisionContext } from "@/lib/cashPlanDecision";
import type { ScenarioBaseline } from "@/lib/scenarioPlanning";
import type { Action, ActionInsert } from "@/lib/types";
import ForecastDecisionTest from "./ForecastDecisionTest";

export default function ScenariosClient({ baseline, hasData, forecastContext = null, suggestedItemId }: {
  baseline: ScenarioBaseline;
  hasData: boolean;
  forecastContext?: ForecastDecisionContext | null;
  suggestedItemId?: string;
}) {
  const [modalPrefill, setModalPrefill] = useState<Partial<ActionInsert>>();
  const [modalKey, setModalKey] = useState(0);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [createdActionName, setCreatedActionName] = useState<string | null>(null);

  function openAction(prefill: Partial<ActionInsert>) {
    setModalPrefill(prefill);
    setModalKey((key) => key + 1);
    setIsModalOpen(true);
  }

  function handleSave(action: Action) {
    setIsModalOpen(false);
    setCreatedActionName(action.name);
  }

  return (
    <>
      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm sm:p-6">
        {forecastContext ? (
          <ForecastDecisionTest
            context={forecastContext}
            suggestedItemId={suggestedItemId}
            onCreateAction={openAction}
          />
        ) : (
          <ManualCalculator bare baseline={baseline} hasData={hasData} onCreateAction={openAction} />
        )}
      </section>
      {createdActionName && (
        <p role="status" className="mt-4 rounded-md border border-line bg-surface px-4 py-3 text-sm text-ink">
          “{createdActionName}” was added to your{" "}
          <Link href="/dashboard/actions" className="font-medium text-teal underline">Action Tracker</Link>.
        </p>
      )}
      <p className="mt-4 text-xs leading-relaxed text-dim">
        Decision tests are temporary and do not change your saved financial data. Actions you create are saved in your{" "}
        <Link href="/dashboard/actions" className="font-medium text-teal underline">Action Tracker</Link>.
      </p>
      <ActionModal
        key={modalKey}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        prefill={modalPrefill}
      />
    </>
  );
}
