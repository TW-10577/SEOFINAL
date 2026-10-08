# LOGOS SEO Ontology — Standalone YAML

Semantic sources: `LOGOS_SEO_Ontology_Design.md_.md`, `LOGOS_SEO_Workflow_Design.md`, and the client
judgment rules in `SEO.txt`. Structure: the LOGOS repository (D2 Ontology Modeling Spec, `spec/kinds`).

**Status:** compiles with the official LOGOS compiler: all passes and the release closure, 0 diagnostics,
115 definitions. Check it with `npm run ontology:check` from `SEO/`.

The SEO system (`SEO/api`) loads this folder at startup and runs on it (see "How the SEO system uses it").
Every `*.logos.yaml` under `ontology/` is loaded, plus `rules.yaml` in this folder: all the YAML the system reads is here.

## Layout

```
rules.yaml                                client rules ① ② (the JudgmentCondition values), thresholds, GA4/GSC mappings
ontology/
  root/package.logos.yaml                 release root (assembles the closure; no business semantics)
  domains/seo/
    package.logos.yaml, domain.logos.yaml
    objects/          11   O1–O10 + Site
    relations/        20   R1–R13 (R8 / R13 split per subject type) + Site HAS SEO Data
    actions/          25   A1–A7, A9 + A8 as one governed action per lifecycle transition, plus Modify cause / Adjust countermeasure
    functions/         5   DetectSignificantChange, IsChangeSignificant, SuggestCause, RequiresHumanReview, ComputeCVR
    value-types/      41   every value type in design §9 + the vocabularies the rules need
    policies/          7   authorization (upload / system / SEO team review / reader), retention, model usage
    evidence/          3   source record, model inference record, SEO team decision record
    source-bindings/   2   GA4 export, Search Console export (column → property mappings)
```

Standalone: every ID is `logos.seo.*` (the root is `logos.platform.package.root`), with no dependency on
shared-core or any other domain.

## Coverage of the design

| Design | Here |
|---|---|
| Actions A1–A9 | `actions/` — A8 "Review and Decide" is 14 transition actions (LOGOS LIF-07: every transition is bound to exactly one action) |
| Objects O1–O10 | `objects/` — plus **Site** (see decisions) |
| Relations R1–R13 | `relations/` — R8 DETECTED_ON and R13 APPLIED_TO have one relation per subject type (LOGOS relations have concrete endpoints) |
| States §8 | lifecycles on SEO Anomaly, Cause Hypothesis (review status) and Countermeasure, with explicit transitions |
| Value types §9 | `value-types/` — counts are non-negative integers, CTR / CVR 0–100 %, position ≥ 1 |
| §6.1 | MetricChange, SEO Report and Weekly Monitoring Report are **not** objects; absolute change, change rate and surge/drop rate are value types |

## Lifecycles (what the SEO team can do)

| Object | Initial (system) | Transitions (SEO team) |
|---|---|---|
| SEO Anomaly | DETECTED | → TRIAGED → COUNTERMEASURE_ASSIGNED → RESOLVED; DETECTED → DISMISSED |
| Cause Hypothesis | NOT_REVIEWED | → CONFIRMED / REJECTED / NEEDS_MORE_EVIDENCE; NEEDS_MORE_EVIDENCE → CONFIRMED / REJECTED |
| Countermeasure | PROPOSED | → APPROVED → IN_PROGRESS → COMPLETED → VERIFIED_EFFECTIVE / VERIFIED_INEFFECTIVE |

The system only creates records in the initial state. Every other move is a governed action
authorized by `can-review-seo-outcome` (SEO team; the system identity is excluded), with separation of
duties, and it requires a decision record. The agent mode is `deny` for review actions and
`propose_only` elsewhere.

## Changes made in review (vs. the first draft)

1. **Identity:** each object has a real immutable primary key (`anomaly-id`, `seo-data-id`, …). Before,
   seven objects used an ordinary field (`subjectType`, nullable `sessions`, the hypothesis text, …).
   Search Query, Page, Traffic Source and Site are `source_bound` on their exported key.
2. **Value types:**
   - `primitiveType` → `primitive`, the field LOGOS defines
   - `granularity` and `classificationType` no longer reuse `condition-type`
   - new vocabularies: threshold unit, change direction, data source, data quality, analysis unit,
     period granularity, classification type
3. **Lifecycles:** states plus explicit transitions, each bound to its action. Before, there were only
   status vocabularies with no transitions.
4. **Actions:**
   - every action now declares its target, inputs, effects, risk, authorization policy, approval,
     idempotency, failure handling, reconciliation and audit
   - creation effects set the fields and link the relations: anomaly → evidence, condition and subject;
     cause → anomaly; countermeasure → cause and target
5. **Cardinality:**
   - SEO Data MEASURED_IN exactly 1 period
   - an anomaly is EVALUATED_BY exactly 1 condition and BASED_ON at least 1 SEO Data
   - a cause EXPLAINS 1 anomaly
   - a countermeasure ADDRESSES 1 cause
6. **Functions:**
   - IsChangeSignificant and DetectSignificantChange return SignificanceResult (including NOT_EVALUABLE)
     and accept a threshold unit and direction
   - RequiresHumanReview returns a boolean (confidence LOW or condition AMBIGUOUS)
   - SuggestCause has its model contract and evidence
7. **Source bindings:** real column mappings (セッション → sessions, クリック数 → clicks, …).
   File-owned properties are `external` and are never overwritten by actions.
8. **Japanese:** display names of objects, properties, states, vocabulary values and actions have `ja`
   labels. Descriptions are English.

## Decisions taken with the SEO team

- **Site is an anomaly subject.** Client rules ① and ② judge the site total (GA4 segment 通販（全体）)
  and traffic sources, so DETECTED_ON / APPLIED_TO can point at Site, Traffic Source, Search Query or
  Page (design open item B4).
- **Confidence is a vocabulary** (HIGH / MEDIUM / LOW), defined on `confidence-level`, not a decimal.
- **SuggestCause stays `model_based`,** as in design A6. The PoC implementation applies the client rules
  deterministically ("rules first") and records the same evidence.

## Differences from LOGOS_SEO_Ontology_Design.md — need design approval

The design document was not changed. These additions are in the YAML and need the design owner's approval
(or a design update):

| Addition | Why |
|---|---|
| Object **Site**; DETECTED_ON / APPLIED_TO to **Site** and **Traffic Source**; Site HAS SEO Data | Both client rules judge the site total and traffic channels, which R8 / R13 (Search Query / Page only) cannot express. |
| Countermeasure state **Rejected** + action `reject-countermeasure` | Design H2 "approve, adjust or **dismiss**" the countermeasure; §8 has no state for a dismissed suggestion. |
| Cause review **NeedsMoreEvidence → Confirmed / Rejected** | §8 lists NeedsMoreEvidence but no way out of it. |
| Actions `amend-cause-hypothesis`, `adjust-countermeasure` (no state change) | Workflow step 10 "confirm, reject or **modify** the cause"; A8 "approve, **adjust** or dismiss". |
| Transition **guards**: approve only when `context.causeReviewStatus == 'CONFIRMED'`; assign only when `context.hasApprovedCountermeasure == true` | R12 "the action answers the **confirmed** cause". LOGOS expressions cannot traverse relations, so the API supplies these `context` facts. |

## Still to confirm with the client (marked `logos.ext/confirmation-status: unconfirmed`)

- GA4 segments: 通販（全体） = site total, オーガニックサーチ = organic, ペイド系合算 = paid / advertising
- CV column (e コマース購入数 or トランザクション); the brand classification rule
- The rule ② threshold unit and the definition of "flat" (configured in `rules.yaml`)
- Retention periods for audit and evidence

## How the SEO system uses it

- `SEO/api/src/ontology.ts` loads this folder at startup. The API refuses to start when:
  - a required object, lifecycle or vocabulary is missing
  - a transition's action does not perform it
  - an initial state differs from what the system creates
  - a judgment condition in `rules.yaml` uses a unit, direction or type outside the vocabularies
- SEO team decisions (`POST /api/anomalies/:id/state`, `/api/causes/:id/review`,
  `/api/countermeasures/:id/status`) are checked against these lifecycles and their `guards`.
  Modify / Adjust (`POST /api/causes/:id/amend`, `/api/countermeasures/:id/adjust`) are allowed only in
  the states whose `allowedActionRefs` list the action. The detail drawer shows one
  button per allowed transition, labelled with the action's name, e.g. 異常のトリアージ.
- `GET /api/ontology` returns the objects, lifecycles, vocabularies, relations and actions (en / ja).
- `api/test/ontology.test.ts` checks that the database status columns, measurement results, subject
  types and confidence values match these vocabularies.
