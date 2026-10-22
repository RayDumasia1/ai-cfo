"use client";

import type { ReactNode } from "react";
import type { FeatureTier } from "@/lib/featureGates";
import type { Action, Alert, DismissedAlert, SnoozeType } from "@/lib/types";
import TopAlerts from "@/app/components/TopAlerts";
import BottomAlerts from "@/app/components/BottomAlerts";
import ScenarioPanel from "@/app/components/ScenarioPanel";
import ActionTrackerPanel from "@/app/components/ActionTrackerPanel";
import ActionModal from "@/app/components/ActionModal";
import { useActionManager } from "@/app/components/useActionManager";
import UpgradeStrip from "@/app/components/billing/UpgradeStrip";
import ImportRefresher from "./ImportRefresher";

interface DashboardClientProps {
  featureTier: FeatureTier;
  initialActions: Action[];
  visibleAlerts: Alert[];
  dismissedAlerts: DismissedAlert[];
  dataVersion: string | null;
  snoozeDuration: SnoozeType;
  hasData: boolean;
  isNewUser: boolean;
  /** Server-rendered content between TopAlerts and BottomAlerts (stat cards, chart). */
  children: ReactNode;
}

/**
 * Interactive dashboard sections: alerts (with "Create action"), import/scenario
 * row, Action Tracker, upgrade strip. Owns the single ActionModal instance and
 * the actions list so alert-created and panel-created actions share state.
 */
export default function DashboardClient({
  featureTier,
  initialActions,
  visibleAlerts,
  dismissedAlerts,
  dataVersion,
  snoozeDuration,
  hasData,
  isNewUser,
  children,
}: DashboardClientProps) {
  const { actions, actionError, openModal, modalKey, modalProps } = useActionManager(initialActions);

  return (
    <>
      {/* Top alerts — danger + warning only; renders nothing when all clear */}
      <TopAlerts
        alerts={visibleAlerts}
        dismissedAlerts={dismissedAlerts}
        dataVersion={dataVersion}
        snoozeDuration={snoozeDuration}
        onCreateAction={(prefill) => openModal(prefill)}
      />

      {children}

      {/* Bottom alerts — success only, or "everything healthy" when zero total */}
      <div className="mb-8">
        <BottomAlerts
          alerts={visibleAlerts}
          dismissedAlerts={dismissedAlerts}
          dataVersion={dataVersion}
          snoozeDuration={snoozeDuration}
          onCreateAction={(prefill) => openModal(prefill)}
        />
      </div>

      {/* Two-column data row: Import | What-If Scenario */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        <div id="import-section">
          <ImportRefresher hasData={hasData} isNewUser={isNewUser} />
        </div>

        <ScenarioPanel hasData={hasData} />
      </div>

      <ActionTrackerPanel
        featureTier={featureTier}
        actions={actions}
        onAddAction={() => openModal()}
        onEditAction={(action) => openModal(undefined, action)}
        errorMessage={actionError}
      />

      {/* Upgrade strip — Starter only */}
      <UpgradeStrip currentTier={featureTier} />

      <ActionModal key={modalKey} {...modalProps} />
    </>
  );
}
