"use client";

import { useEffect, useRef, useState } from "react";
import {
  Building2,
  Check,
  Download,
  FileSpreadsheet,
  Lightbulb,
  Receipt,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import OnboardingImportZone from "./OnboardingImportZone";

interface OnboardingModalProps {
  businessName: string | null;
  onComplete: () => void;
  onClose: () => void;
  /** "I need more time" on step 3 — parent closes the modal and shows a toast. */
  onNeedMoreTime?: () => void;
  /** Called after step 1 saves a new business name. */
  onBusinessNameSaved?: (name: string) => void;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS = ["Your business", "What you'll need", "The template", "Import data"];
const TEMPLATE_URL = "/downloads/elidan-financial-template.xlsx";

const NEEDS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Building2,
    title: "Your bank statements",
    body: "Opening and closing cash balance for each month. Find these in online banking or ask your bookkeeper.",
  },
  {
    icon: Receipt,
    title: "Revenue and expenses",
    body: "Total cash collected and total cash paid out each month. QuickBooks users: run a Cash Flow Statement — it has everything.",
  },
  {
    icon: Users,
    title: "Payroll total",
    body: "Total payroll and contractor payments per month. Check your payroll system or bank transfers.",
  },
];

const TEMPLATE_STEPS = [
  {
    title: "Open the Monthly Summary tab",
    body: "One row per month — opening cash, closing cash, revenue, expenses, and payroll.",
  },
  {
    title: "Open Expense Categories tab",
    body: "List each expense type and amount per month. Use consistent category names.",
  },
  {
    title: "Save as .xlsx and come back",
    body: "Keep the file in Excel format and upload it on the next step.",
  },
];

// ── Shared pieces ────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const progress = ((step - 1) / (STEP_LABELS.length - 1)) * 75;
  return (
    <ol className="relative mb-8 grid grid-cols-4" aria-label={`Step ${step} of 4`}>
      {/* Connector line runs between the first and last dot centres (12.5% → 87.5%). */}
      <div className="absolute left-[12.5%] right-[12.5%] top-[8.5px] h-px bg-line" />
      <div
        className="absolute left-[12.5%] top-[8.5px] h-px bg-teal transition-[width] duration-300 motion-reduce:transition-none"
        style={{ width: `${progress}%` }}
      />
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "active" : "todo";
        return (
          <li
            key={label}
            className="relative flex flex-col items-center"
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="flex h-[18px] w-[18px] items-center justify-center">
              {state === "done" ? (
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-teal">
                  <Check size={11} strokeWidth={3} className="text-white" />
                </span>
              ) : (
                <span
                  className={`h-2.5 w-2.5 rounded-full ${state === "active" ? "bg-teal" : "bg-line"}`}
                  style={state === "active" ? { boxShadow: "0 0 0 4px rgba(44,166,164,0.15)" } : undefined}
                />
              )}
            </span>
            <span className="mt-2 text-center text-[10px] text-dim">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function StepHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: "rgba(44,166,164,0.12)" }}
      >
        <Icon size={28} className="text-teal" />
      </div>
      <h2 id="onboarding-title" className="mt-4 text-xl font-medium text-navy">
        {title}
      </h2>
      <p className="mt-1 text-sm text-dim">{subtitle}</p>
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  type = "button",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="mt-6 h-12 w-full bg-teal text-sm font-medium text-white transition-colors hover:bg-teal-light disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderRadius: "var(--radius-md)" }}
    >
      {children}
    </button>
  );
}

function TextLink({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto mt-3 block text-[13px] text-dim transition-colors hover:text-navy"
    >
      {children}
    </button>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────

export default function OnboardingModal({
  businessName,
  onComplete,
  onClose,
  onNeedMoreTime,
  onBusinessNameSaved,
}: OnboardingModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState(businessName ?? "");
  const [savedName, setSavedName] = useState(businessName ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [imported, setImported] = useState(false);
  const downloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Once data is imported, any way out of the modal counts as completion.
  const close = imported ? onComplete : onClose;
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (downloadTimer.current) clearTimeout(downloadTimer.current);
    };
  }, []);

  async function handleBusinessNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === savedName) {
      setStep(2);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: trimmed }),
      });
      if (!res.ok) throw new Error("save failed");
      setSavedName(trimmed);
      onBusinessNameSaved?.(trimmed);
      setStep(2);
    } catch {
      setSaveError("Couldn't save your business name. Try again or skip for now.");
    } finally {
      setSaving(false);
    }
  }

  function handleDownload() {
    window.open(TEMPLATE_URL, "_blank");
    setDownloaded(true);
    if (downloadTimer.current) clearTimeout(downloadTimer.current);
    downloadTimer.current = setTimeout(() => setDownloaded(false), 3000);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4"
      style={{ background: "rgba(10,26,47,0.6)", backdropFilter: "blur(4px)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="relative my-auto w-[90vw] max-w-[560px] bg-surface p-10"
        style={{ borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)" }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-4 top-4 text-dim transition-colors hover:text-navy"
        >
          <X size={18} />
        </button>

        <StepIndicator step={step} />

        {step === 1 && (
          <form onSubmit={handleBusinessNameSubmit}>
            <StepHeader
              icon={Building2}
              title="What's your business called?"
              subtitle="We'll use this to personalise your dashboard."
            />
            <div className="mt-6">
              <label
                htmlFor="onboarding-business-name"
                className="text-[11px] font-medium uppercase tracking-[0.08em] text-dim"
              >
                Business name
              </label>
              <input
                id="onboarding-business-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Services LLC"
                autoFocus
                autoComplete="organization"
                className="mt-2 h-12 w-full border-[1.5px] border-line bg-surface px-4 text-base text-navy outline-none transition-[border-color,box-shadow] placeholder:text-dim focus:border-teal focus:shadow-[0_0_0_3px_rgba(44,166,164,0.12)]"
                style={{ borderRadius: "var(--radius-md)" }}
              />
              <p className="mt-2 text-xs text-dim">
                You can change this anytime in Settings → Account
              </p>
              {saveError && (
                <p className="mt-2 text-xs text-danger" role="alert">
                  {saveError}
                </p>
              )}
            </div>
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? "Saving…" : "Continue →"}
            </PrimaryButton>
            <TextLink onClick={() => setStep(2)}>Skip for now</TextLink>
          </form>
        )}

        {step === 2 && (
          <>
            <StepHeader
              icon={FileSpreadsheet}
              title="What you'll need"
              subtitle="Gather these before you start — takes about 15 minutes."
            />
            <ul className="mt-7">
              {NEEDS.map(({ icon: Icon, title, body }) => (
                <li
                  key={title}
                  className="flex items-start gap-3.5 border-b border-cloud py-3.5 last:border-b-0"
                >
                  <Icon size={20} className="mt-0.5 shrink-0 text-teal" />
                  <div>
                    <p className="text-sm font-medium text-navy">{title}</p>
                    <p className="mt-0.5 text-[13px] leading-normal text-dim">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div
              className="mt-5 flex items-start gap-2 px-4 py-3"
              style={{
                background: "rgba(44,166,164,0.06)",
                border: "1px solid rgba(44,166,164,0.20)",
                borderRadius: 8,
              }}
            >
              <Lightbulb size={14} className="mt-[3px] shrink-0 text-teal" />
              <p className="text-[13px] text-ink">
                Tip: Start with your most recent 3 months. You can add more later.
              </p>
            </div>
            <PrimaryButton onClick={() => setStep(3)}>Got it, let&apos;s go →</PrimaryButton>
            <TextLink onClick={onClose}>I&apos;ll figure it out myself</TextLink>
          </>
        )}

        {step === 3 && (
          <>
            <StepHeader
              icon={Download}
              title="Fill in the Elidan template"
              subtitle="Download our simple spreadsheet and fill in your numbers. No formulas needed."
            />
            <div
              className="mt-6 flex items-center gap-4 border border-line bg-cloud px-5 py-4"
              style={{ borderRadius: "var(--radius-md)" }}
            >
              <FileSpreadsheet size={32} className="shrink-0 text-teal" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-navy">Elidan Financial Template</p>
                <p className="mt-0.5 text-xs text-dim">
                  Excel (.xlsx) · 5 sheets · ~15 min to complete
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownload}
                className={`flex shrink-0 items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white transition-colors ${
                  downloaded ? "bg-teal" : "bg-navy hover:bg-navy-light"
                }`}
                style={{ borderRadius: 8 }}
              >
                {downloaded ? (
                  <>
                    Downloaded <Check size={14} />
                  </>
                ) : (
                  "Download"
                )}
              </button>
            </div>

            <ol
              className="mt-6 overflow-hidden border border-line"
              style={{ borderRadius: "var(--radius-md)" }}
            >
              {TEMPLATE_STEPS.map((s, i) => (
                <li
                  key={s.title}
                  className="flex items-start gap-3.5 border-b border-cloud px-4 py-3.5 last:border-b-0 even:bg-row-alt odd:bg-surface"
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal text-xs font-medium text-white">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-navy">{s.title}</p>
                    <p className="mt-0.5 text-[13px] leading-normal text-dim">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <PrimaryButton onClick={() => setStep(4)}>I&apos;ve filled it in →</PrimaryButton>
            <TextLink onClick={onNeedMoreTime ?? onClose}>I need more time</TextLink>
          </>
        )}

        {step === 4 && (
          <>
            <StepHeader
              icon={Upload}
              title="Import your data"
              subtitle="Upload your completed template and Elidan calculates your dashboard instantly."
            />
            <div className="mt-6">
              <OnboardingImportZone
                onImported={() => setImported(true)}
                onContinue={onComplete}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
