# Cash planning foundation

Approved 26 October 2026. This decision establishes the customer-facing architecture and terminology for weekly forecasting and scenario testing. It changes navigation and presentation only; calculation, storage, publication, permissions and tier enforcement remain owned by their existing engines.

## Product structure

`Cash planning` is the parent product area. It began with weekly planning and temporary decision tests and now contains four owner tasks:

| Owner task | Customer-facing name | Existing route and engine | Persistence | Tier |
| --- | --- | --- | --- | --- |
| See whether the business may have enough cash each week | Weekly cash plan | `/dashboard/forecast`; deterministic 13-week forecast | Draft and immutable published versions | Core and higher |
| Explore the effect of a possible decision | Test a decision | `/dashboard/scenarios`; monthly scenario calculator | Temporary; only an optional action is saved | Starter and higher |
| Compare actual cash with a finished plan week | Review a completed week | `/dashboard/forecast-review`; actual-versus-plan engine | Actual evidence, match decisions and immutable review history | Growth and higher |
| Retain and compare named alternative assumptions | Compare cash-plan cases | `/dashboard/forecast-cases`; cases using the weekly forecast engine | Base-linked downside/upside versions and calculation snapshots | Growth and higher |

The sidebar exposes one `Cash planning` destination. The original two-task foundation now also includes Growth's completed-week reviews and retained cases, as detailed below. Existing child URLs remain stable for bookmarks, tests, action links and future API clients. Internal domain names such as forecast, scenario, variance and forecast version remain precise in code and storage.

## Current tier allocation and documentation reference

Reconciled against the implementation on 28 October 2026. This section is the current cash-planning allocation for the product playbook and subscription architecture; older references to Growth-only forecasting, a delivered 12-month forecast, or saved monthly scenarios do not describe the shipped cash-planning tools. The [CFO capability roadmap](cfo-capability-roadmap.md) also contains future product direction, which must remain distinct from implemented capability.

| Element | Starter | Core and active Founding Member | Growth | Advisory |
| --- | --- | --- | --- | --- |
| Test a decision: monthly collections/spending and one-time cash events | Temporary test | Included | Included | Included |
| Weekly cash plan: saved rolling 13-week base | Upgrade context | Included | Included | Included |
| Published-plan outlook, evidence review, revision and republishing | — | Included | Included | Included |
| Decision test from a published weekly base plan | Requires an existing owned base; see access note below | Included; temporary calculation | Included | Included |
| Review a completed week: actual cash, matching, retained review history | — | Upgrade context | Included | Included |
| Compare cash-plan cases: retained named downside/upside assumptions | — | Upgrade context | Included | Included |
| Assigned human CFO review, commentary and sign-off | Not enabled | Not enabled | Future service option; no current sign-off workflow | Intended service layer; no current assigned-advisor/sign-off workflow |

**Starter** provides a temporary monthly decision test against the customer's existing financial baseline. Recurring collections/spending adjustments and one-time receipts/payments are separate. The test is not a saved financial model; an optional linked action is saved independently under the account's action limits.

**Core** adds the saved 13-week weekly plan: starting cash/date, protected reserve, expected receipts/payments and evidence/confidence. It supports a working draft, immutable published base versions, cash outlook, weekly detail, review/update revisions and decision tests anchored to an owned published base. One current base planning stream can retain multiple published versions; it is not limited to one historical version. Revising a base from current facts is Core; retaining actual-to-plan matching and variance reviews is Growth.

**Growth** adds two separate durable workflows. Review a completed week records actual cash events/balances, match decisions, coverage and immutable review snapshots against the published plan. A full seven-day plan week must end before a review is available. Compare cash-plan cases retains named downside/upside assumptions and calculated results against the same published base; case history does not replace or mutate the Core base. These are saved weekly cases, not persistence of the Starter monthly calculator. See [FORECAST-01E](forecast-01e-actual-versus-plan.md).

**Advisory** inherits the Growth planning software. The intended additional value is human judgment, assumption challenge and review; assigned advisor access, comments, sign-off and shared team workflows require later service/access increments. A feature-gate name or a pricing promise is not evidence that those workflows are delivered.

**Founding Member** is a billing identity mapping to Core entitlement while paid and eligible. It therefore receives the weekly base plan, without automatically receiving Growth reviews/cases or Advisory services. This documentation update does not change Stripe prices, subscription rows or Founding cancellation rules.

Commercial availability and feature authorization are separate. `GROWTH_AVAILABLE` and `ADVISORY_AVAILABLE` remain false in [launchConfig](../lib/launchConfig.ts); existing entitled accounts can use the implemented Growth/Advisory software. Neither those flags nor this allocation authorize opening sales. QuickBooks sync remains parked, and neither it nor a bank connection is required to build a manual weekly plan or enter weekly actuals. E5 owner case acceptance passed; the full E4 completed-week owner acceptance remains scheduled for 2 November 2026.

## Implementation map

| Owner workflow | Route | Engine and authorization | Durable evidence |
| --- | --- | --- | --- |
| Cash planning entry | `/dashboard/cash-planning` | Verified, paid session; capability-specific entry cards | No separate planning dataset |
| Test a decision | `/dashboard/scenarios` | `lib/scenarioPlanning.ts` for monthly tests; `lib/cashPlanDecision.ts` for owned published-weekly tests | Temporary test; optional action only |
| Weekly cash plan | `/dashboard/forecast`, `/api/cash-forecast` | `lib/cashForecast.ts`; Core `forecasting` | Forecast headers, schedules/items, draft and immutable published base versions |
| Review a completed week | `/dashboard/forecast-review`, `/api/forecast-review` | `lib/forecastVariance.ts`; Growth `forecast_variance` | Actual events/balances, allocations, immutable weekly review snapshots |
| Compare cash-plan cases | `/dashboard/forecast-cases`, `/api/forecast-cases` | `lib/forecastCases.ts` wraps the same weekly engine; Growth `scenario_comparison` | Base-linked case versions, named assumptions, lineage and retained calculation snapshots |

Pages and APIs independently enforce the paid feature boundary; client cards are navigation, not authorization. Server operations derive the acting account from the authenticated session and check evidence ownership. Calculated values are deterministic; no AI explanation is needed to publish or review. Monthly history, weekly plan evidence, actual cash events, matches and cases remain distinct records. Missing evidence never becomes a confirmed zero, and material accuracy/source warnings are never tier-gated.

Access note: creating, revising and publishing the weekly base requires Core `forecasting`. The existing `/dashboard/scenarios?forecast=<id>` loader checks a verified paid session and ownership of a published base, but does not independently recheck `forecasting`; an owner retaining a plan after a downgrade can therefore load that temporary read/test context. This is an implementation distinction from the Core plan-creation entitlement, not a promise of saved weekly planning on Starter. Any stricter post-downgrade context policy needs a separate implementation change.

These planning paths remain account-scoped owner paths. ORG-01C converted monthly Financial Data reads only; it did not convert forecast writes, enable invited members, or give an advisor permission through their personal tier. [ORG-01](org-01-organization-architecture.md) defines the later organization/domain enforcement required before collaboration.

## Terminology contract

| Internal or professional term | Default owner-facing language |
| --- | --- |
| Forecast | Weekly cash plan |
| 13-week forecast | Weekly cash plan for the next 13 weeks |
| Scenario | Decision test |
| Scenario comparison | Compare cash-plan cases |
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
- Feature gates remain capability-based: Starter can test a decision; Core can maintain the weekly base plan; Growth adds the implemented retained alternatives and plan-versus-actual comparison.
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

