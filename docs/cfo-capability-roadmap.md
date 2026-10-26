# Elidan CFO capability roadmap

**Status:** Product direction approved 25 October 2026; implementation is incremental  
**Audience:** Small and medium business owners, professional CFO/CPA users and Elidan advisors  
**Depends on:** [Financial metric contract](financial-metric-contract.md), [data contract v2](financial-data-contract-v2.md), [FIN-03 normalized engine](fin-03-normalized-engine.md)

## Product promise

Elidan should help an owner understand the financial condition of the business, identify risks and opportunities, compare practical choices and turn decisions into accountable actions. It should perform the repeatable analytical and monitoring work of a strong CFO while making the reasoning understandable to an owner without financial training. Human CFO support adds judgment, challenge, relationship management and accountability where software alone is insufficient.

Elidan must not create confidence unsupported by the available data. Every conclusion identifies its source period, accounting basis, material assumptions, completeness and freshness. Missing, zero, estimated and provider-confirmed values remain distinct. Tiering controls breadth, automation, collaboration and service; it does not make lower-tier calculations less accurate or hide a material safety warning.

## Capability layers

### 1. Financial record and control layer

The current version-2 monthly cash contract supports cash health, operating trends and simple scenarios. Full CFO capability also requires versioned, account-scoped records for:

- weekly and transaction-level cash activity;
- invoices, bills, due dates, aging and expected collection/payment dates;
- known commitments, payroll, taxes, debt schedules and recurring obligations;
- budgets, forecasts, assumptions, actual-versus-plan results and forecast versions;
- customers, products, projects, contracts, vendors and allocation dimensions;
- ownership, capitalization, debt instruments, credit facilities and financing terms;
- source, currency, accounting basis, reconciliation state, confidence and evidence lineage.

Accounting integrations normalize into this shared model. Provider-specific fields must not silently redefine a metric. Uploaded spreadsheets remain a simpler path and should request only the information needed for the selected analysis.

### 2. Deterministic finance engine

Material figures are produced by documented, tested formulas and policy rules before AI generates an explanation. The engine should eventually cover:

- a rolling 13-week direct cash forecast with weekly receipts, payments and commitments;
- base, downside and upside forecasts with named assumptions and actual-versus-plan variance;
- working-capital analysis across receivables, payables and inventory where applicable;
- customer, product, project and contract contribution margins;
- unit economics, including explicitly defined CAC, contribution margin, retention and LTV methods;
- debt capacity, covenant headroom, repayment schedules and borrowing cost comparisons;
- capitalization tables, dilution outcomes and financing scenario comparisons;
- capital-allocation comparisons with liquidity constraints and decision criteria;
- vendor concentration, spend trends, duplicate tools and project-margin allocation;
- forecast quality, anomaly detection and data-quality controls.

WACC is useful only when the company and inputs support it. Elidan should not present a precise WACC for a small private business from guessed market values, beta or cost-of-equity assumptions. It can show transparent financing-cost and dilution comparisons first, then introduce WACC for qualified cases with disclosed assumptions.

### 3. Guidance and workflow layer

The platform translates calculations into owner-friendly observations, decision questions, scenarios and actions. Guidance must distinguish:

- an observed fact from an estimate;
- a deterministic result from an AI interpretation;
- a possible explanation from a verified cause;
- a planning option from a recommendation approved by a professional;
- an automated alert from advice supplied by an identified human advisor.

Actions retain the triggering alert, scenario, forecast version or review evidence so an owner or advisor can later evaluate the result. High-impact changes should support review, approval, comments and an audit history.

### 4. Human and professional service layer

Elidan advisors and external CFO/CPA practices need organization-scoped client access, assignments, service entitlements, review queues, customer-visible deliverables, separate internal notes and complete access history. Human involvement may be included with a plan or purchased separately. Credentials and scope must be visible; access ends when an assignment ends.

Complex financing, securities, tax, entity and legal decisions use an explicit handoff. The software can organize facts, calculate alternatives and prepare questions, but final recommendations may require a qualified CFO, CPA, attorney, investment professional or lender. The IRS states that entity form affects tax filing and involves legal and tax considerations; the SEC identifies distinct regulated pathways for raising equity capital. Those boundaries are part of the workflow rather than a footer-only disclaimer.

## Proposed tier allocation

Tier names describe increasing depth. Final commercial packaging remains a pricing decision.

| Capability | Starter | Core | Growth | Advisory / professional service |
| --- | --- | --- | --- | --- |
| Cash visibility | Accurate current cash health, trends, material alerts and simple actions | Automated accounting sync, richer data-quality monitoring and working-capital context | Multi-entity/consolidated views when the organization model exists | Human review, corrections and management discussion |
| Planning | One unsaved baseline scenario | Saved scenarios and rolling forecast basics | Versioned 13-week forecast, base/downside/upside cases, budgets and variance analysis | CFO-built assumptions, challenge and monthly forecast review |
| Performance | Essential cash and spending signals | Core KPI definitions and basic customer/project inputs | Unit economics, margins, break-even, vendor and project performance | KPI design, interpretation and operating recommendations |
| Capital | Education and readiness checklist | Debt/payment scenarios and financing data room checklist | Debt-versus-equity, dilution, cap-table and allocation models | Capital strategy, lender/investor preparation and term review with professional/legal coordination |
| Contracts | Payment-term capture and cash-timing effects | Structured contract cash schedules | Financial-term extraction, concentration and margin risk | Human commercial review; legal provisions referred to counsel |
| Collaboration | Owner actions | Team workflows | Approvals, saved analyses and advisor-ready reporting | Assigned CFO/CPA workspace, meetings, deliverables and audit trail |

Starter should provide a trustworthy answer and a useful next step. Upgrades should add automation, predictive depth, retained models, comparisons, collaboration and expert access rather than withholding the meaning of the customer's own data.

Plan changes reuse the same account-scoped financial record. A customer upgrading from Starter to Core or higher receives immediate Ask CFO and AI Insight value from valid monthly history without re-uploading it or connecting an accounting provider. An upgrade-readiness/context service identifies which guidance the existing evidence supports and requests only the additional dates, commitments or schedules needed for a specific forward-looking question. QuickBooks improves automation and timeliness; it is not a prerequisite for guidance.

## Treatment of the proposed high-impact modules

### Contract risk analysis

Build this initially as **contract financial-term analysis**. Extract payment terms, retainers, milestones, holdbacks, renewal/termination timing, price escalation, minimum commitments, currency and cash-flow exposure. Show the extracted clause and confidence, require user confirmation and model the cash impact. Liability, indemnity, enforceability and missing legal protections are legal-review issues; the product can identify them for counsel without claiming a legal conclusion.

### Entity selection analysis

Do not launch a universal “best entity” calculator. Entity treatment depends on jurisdiction, ownership, compensation, elections and changing law. A later jurisdiction-bounded comparison can collect assumptions, calculate transparent financial illustrations from reviewed rules and generate questions for a CPA/attorney. It should never file an election or state that one entity is legally or tax-optimal without qualified review.

### Ecosystem performance matrix

This is a strong Growth capability after cost allocation and project/customer margin data exist. Begin with vendor spend trends, concentration, renewals and duplicate categories. Add allocation rules and contribution margin before claiming that a tool creates or destroys value. Correlation should be labelled as correlation; causal claims require evidence beyond coincident spend and margin movements.

## Recommended implementation sequence

1. Finish current chart transparency and zero-collections anomaly guidance.
2. Specify and build the [rolling 13-week forecast](forecast-01-13-week-cash-forecast.md), including commitments, AR/AP timing, assumptions, freshness and actual-versus-plan variance.
3. Add saved, versioned scenarios and forecast-to-action tracking.
4. Implement QuickBooks normalization into the shared model and reconciliation controls.
5. Add dimensional profitability and unit-economics definitions before AI performance recommendations.
6. Establish organization, professional-client and Elidan-advisor access before multi-client or human advisory workflows.
7. Add capital and financing models with reviewed formulas, evidence, approvals and professional handoffs.
8. Add contract financial-term analysis, then vendor/project performance; defer jurisdiction-specific entity comparisons until legal/tax governance exists.

## Governance requirements

- Version every formula, assumption set, forecast and AI narrative.
- Retain source lineage and the data snapshot used for every material conclusion.
- Test deterministic outputs against independently prepared cases.
- Measure forecast accuracy and alert usefulness; do not optimize only for engagement.
- Require explicit review for low-confidence extraction and high-impact recommendations.
- Keep customer approval and professional sign-off distinct from AI generation.
- Apply role-based access, least privilege and auditable advisor assignments.
- Establish counsel-approved disclosures and escalation language through LEGAL-01.

## Authoritative policy references

- [SEC small-business funding roadmap](https://www.sec.gov/files/funding-roadmap-capital-raising.pdf) distinguishes self-funding, non-dilutive capital and ownership-diluting investor capital.
- [SEC offering pathways](https://www.sec.gov/resources-small-businesses/capital-raising-building-blocks/offering-pathways) explains that securities offerings require registration or an applicable exemption.
- [IRS business structures](https://www.irs.gov/businesses/small-businesses-self-employed/business-structures) confirms that entity form affects tax filing and involves legal and tax considerations.
- [SBA business-management guidance](https://www.sba.gov/counseling/manage-your-business/) emphasizes balance-sheet, cash-flow, cost-benefit and professional accounting support for business management.

