# Cash planning foundation

Approved 26 October 2026. This decision establishes the customer-facing architecture and terminology for weekly forecasting and scenario testing. It changes navigation and presentation only; calculation, storage, publication, permissions and tier enforcement remain owned by their existing engines.

## Product structure

`Cash planning` is the parent product area. It contains two distinct owner tasks:

| Owner task | Customer-facing name | Existing route and engine | Persistence | Tier |
| --- | --- | --- | --- | --- |
| See whether the business may have enough cash each week | Weekly cash plan | `/dashboard/forecast`; deterministic 13-week forecast | Draft and immutable published versions | Core and higher |
| Explore the effect of a possible decision | Test a decision | `/dashboard/scenarios`; monthly scenario calculator | Temporary; only an optional action is saved | Starter and higher |

The sidebar exposes one `Cash planning` destination. A landing page explains both choices before the owner enters either workflow. Existing child URLs remain stable for bookmarks, tests, action links and future API clients. Internal domain names such as forecast, scenario, variance and forecast version remain precise in code and storage.

## Terminology contract

| Internal or professional term | Default owner-facing language |
| --- | --- |
| Forecast | Weekly cash plan |
| 13-week forecast | Weekly cash plan for the next 13 weeks |
| Scenario | Decision test |
| Scenario comparison | Compare cash plans |
| Baseline | Current plan or starting point |
| Variance | What happened compared with the plan |
| Inflow / outflow | Cash in / cash out |
| Minimum reserve | Lowest cash balance the owner wants to keep |

Technical terms may appear in methodology, professional views, exports or contextual education when precision requires them. A label change must not change the underlying financial definition.

## Architectural boundaries

- `cashForecast.ts` remains the deterministic weekly calculation engine.
- `scenarioPlanning.ts` remains the bounded monthly decision-test engine.
- `/api/cash-forecast` remains the authoritative publication path; the browser never publishes calculated totals.
- Scenario calculations remain temporary and never mutate imported financial data.
- The parent area does not merge weekly forecast records with monthly scenario inputs.
- Feature gates remain capability-based: Starter can test a decision; Core can maintain one weekly base plan; Growth later adds retained alternatives and plan-versus-actual comparison.
- Existing forecast version and action linkage identifiers remain unchanged.

## Next increments

1. Guided weekly-plan setup using owner questions and common payment groups. **Implemented in CASHPLAN-03:** the Core workflow now presents a progressive three-step accordion. Saving the starting point collapses Step 1 and focuses expected cash; the owner explicitly chooses **Review plan** after adding all intended items, which collapses Step 2 and opens projections, warnings, exact weekly values and publishing in Step 3. Completed steps remain editable without losing the draft. A returned saved draft is explicit and can be updated or discarded. Discarding removes only the draft and its items; immutable published plans and imported financial data remain. The workflow asks whether cash is coming in or going out before showing the relevant categories and explains confidence in plain language. The normalized categories, server validation, storage and calculation engine are unchanged.
2. Decision templates for late customer payments, hiring, spending reductions, equipment, financing and taxes.
3. Decision-focused results led by timing, lowest cash, reserve risk and suggested actions.
4. Visible sources, assumptions, freshness, missing inputs and confidence.
5. A handoff from a weekly-plan risk to a prefilled decision test without duplicating saved records.

