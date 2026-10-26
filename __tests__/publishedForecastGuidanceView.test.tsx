import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PublishedGuidance } from "../app/dashboard/forecast/ForecastClient";
import type { PublishedForecastGuidance } from "../lib/publishedForecastGuidance";

const base: PublishedForecastGuidance = {
  severity: "warning",
  headline: "Cash may fall below your reserve",
  explanation: "The projected low point is below the protected reserve.",
  drivers: [],
  confidenceNote: null,
  needsInputReview: false,
  reserveGap: 10_500,
  nextSteps: ["Test ways to keep more cash available.", "Choose a response and turn it into an action."],
  nextReviewDate: "2026-11-02",
};

describe("published weekly-plan next actions", () => {
  it("makes input review the only action when evidence needs attention", () => {
    const html = renderToStaticMarkup(<PublishedGuidance
      guidance={{ ...base, needsInputReview: true, confidenceNote: "Review uncertain inputs." }}
      decisionHref="/dashboard/scenarios?forecast=version"
      onReviewPlan={vi.fn()}
      onCreateAction={vi.fn()}
    />);
    expect(html).toContain("Review and update plan");
    expect(html).not.toContain("Test ways to protect cash");
    expect(html).not.toContain("Create action");
  });

  it("prioritizes testing a response when a reliable plan shows risk", () => {
    const html = renderToStaticMarkup(<PublishedGuidance
      guidance={base}
      decisionHref="/dashboard/scenarios?forecast=version"
      onReviewPlan={vi.fn()}
      onCreateAction={vi.fn()}
    />);
    expect(html).toContain("Test ways to protect cash");
    expect(html).toContain("Create action");
    expect(html).toContain('href="/dashboard/scenarios?forecast=version"');
  });
});
