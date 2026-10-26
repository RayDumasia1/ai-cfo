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
5. A handoff from a weekly-plan risk to a prefilled decision test without duplicating saved records. **Implemented in CASHPLAN-05:** the published outlook passes only a version and optional item identifier. The server verifies that the immutable published version belongs to the authenticated account, then loads its evidence. The decision test changes one planned amount/date or adds one temporary receipt to an in-memory copy and reruns the same deterministic 13-week engine. It compares the low point, first reserve warning and ending cash without changing the published plan or imported financial data. An optional action links back to the published forecast version. The existing monthly collections/spending test remains available separately.

Draft discard is a single service-only database operation. It locks and rechecks the account-owned draft and its last-update timestamp, refuses drafts referenced by actions or later versions, deletes child evidence while the parent remains visible to draft-only protection triggers, then deletes the draft. Any failure rolls the complete operation back; published plans and imported financial history remain unchanged.

## Published-plan guidance

CASHPLAN-04 makes publication useful to an owner beyond preserving an immutable calculation. A published plan leads with a plain-language cash outlook, the projected low point, the largest planned cash-out items scheduled through that point, material confidence limitations and a seven-day review date. It offers direct paths to create an action, test a decision and begin the next weekly update. Driver wording remains evidence-bounded: the application identifies the largest planned payments before the low point and does not claim they caused a result without further analysis.

The published outlook follows an evidence-first action sequence. When starting cash, scheduled evidence, missing inputs or confidence needs attention, the primary and only action is **Review and update plan**; the owner is told which inputs to correct and to republish before relying on the result. When inputs are current and a reserve or cash shortfall remains, the outlook quantifies the dollar gap below the protected reserve and makes **Test ways to protect cash** the primary action, followed by an optional tracking action. A healthy current plan instead leads to routine review. The published outlook replaces the separate generic reserve-action panel so owners are not given conflicting next steps.

**Review and update plan** opens a guided evidence review rather than a generic maintenance section. It explains that the published version will remain unchanged, asks for a verifiable current cash balance and date, and creates an editable revision only after the owner starts the review. The next step ranks cash items needing attention before current items and labels missing amount/date, uncertain confidence and old evidence separately. Editing an item refreshes its manual evidence date; the owner may retain honest uncertainty and continue, in which case the republished outlook will continue to disclose it. The published view does not display draft setup progress or claim that an already-published plan remains a draft.

The review translates confidence into evidence an owner can recognize: confirmed by a document or person, expected from good evidence, a best current estimate, or needing help to confirm. When an item needs confirmation, the screen gives category-specific checks and a conservative fallback. For example, customer receipts point to the invoice, customer payment timing and past collection behavior; payroll points to the payroll register and withdrawal date. The owner may keep an honest estimate or explicitly move an incoming item two weeks later or an outgoing item one week earlier before saving the editable draft. These disclosed timing adjustments provide a simple safer case without silently changing the published plan. This is Core guidance because the saved weekly plan is a Core capability; the same plain-language evidence pattern should be reused in Starter imports, alerts and decision tests when those flows accept uncertain inputs.

The owner-facing flow has one transition for each decision. Publishing moves focus to **Your cash outlook**. **Review and update plan** creates the editable revision immediately and opens the first item needing attention, without a second start button or a duplicate update form. Saving an item advances to the next flagged item; honestly retained estimates count as reviewed for that session while remaining visibly flagged in the calculation. **Review updated outlook** moves focus to the draft result, and **Publish updated plan** returns focus to the newly published outlook. Programmatic focus accompanies scrolling so keyboard and assistive-technology users arrive at the same destination as visual users.

Starting a revision is idempotent for the same published version. The client rejects a second in-flight mutation immediately, and the database serializes revision creation on the published version and returns its existing child draft on a retry. This preserves the one-active-draft invariant without turning a double click or network retry into a server error.

Revision creation and response loading are separate database operations. If the revision commits but the immediate state reload fails transiently, the API retries the read once and logs the failing stage and database code without financial values. If the response still fails, the client performs a read-only recovery request and continues with the committed draft rather than reporting that the entire revision failed.

Guided-review mode is derived from the saved `parent_version_id`, not only browser state, so a reload or recovered response resumes the same owner workflow. When starting cash is stale, the balance date is intentionally cleared and must be re-entered to show when the owner verified it. If no scheduled cash item needs confirmation after that update, the flow states this explicitly and moves to the updated outlook instead of opening an empty review or returning to the weekly detail table without explanation.

The weekly graph, exact-value table, cash-item evidence and immutable version remain available for a finance professional or an owner who wants detail. Owner guidance and professional evidence are two presentations of the same deterministic result, not separate calculations. Future Ask CFO and AI Insights may explain a published version only when they cite that version, its assumptions and its limitations.

