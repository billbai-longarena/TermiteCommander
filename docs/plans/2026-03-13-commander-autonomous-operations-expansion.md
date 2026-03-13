# Commander Autonomous Operations Expansion

**Date**: 2026-03-13
**Status**: Proposal

---

## 1. Why This Expansion

Commander should not remain narrowly positioned as "a system that makes cheap models write code."

That framing is too small for the underlying architecture:

- Termite Protocol already provides a general coordination substrate based on environment, signals, and pheromone memory.
- The original Commander design already mentions human users who may be developers or business users, plus research, audience analysis, and report/data deliverables.
- The current product narrative and v2 runtime narrowed the scope back to coding execution.

The right product definition is:

> Commander is an autonomous project operator.
>
> It can plan, launch, operate, observe, and iterate a project across code, research, growth, sales, support, and feedback loops.

Code generation remains one execution domain, not the whole product.

---

## 2. Current Mismatch

The repo currently has a clear design/implementation gap:

- Top-level README positions Commander primarily as AI coding orchestration.
- `commander/src/engine/classifier.ts` only supports `BUILD` and `HYBRID`.
- `commander/src/colony/plan-writer.ts` restricts `taskType` to `BUILD | HYBRID`.
- `commander/src/engine/decomposer.ts` assumes weak models will mainly modify files/modules in one session.
- `commander/src/engine/pipeline.ts` defaults deliverables to `Code + tests` or `Analysis + code`.
- `WIP.md` records that v2 intentionally removed research/simulate/design/quality phases in favor of a slim coding-oriented pipeline.

So the architecture wants to be broader than the product messaging, and the product messaging is broader than the current implementation.

---

## 3. Target Product Definition

Commander should evolve from:

- "autonomous coding orchestrator"

to:

- "autonomous project operating system"

### Core principle

Commander does not only answer "how do we build this?"

It should also answer:

- What market should we target first?
- Which users should we talk to?
- What messaging should we test?
- Which channel should we launch on?
- What feedback patterns are emerging?
- What should we change in the product next?

### Primary operating loop

1. Sense
2. Diagnose
3. Plan
4. Execute
5. Measure
6. Learn
7. Iterate

This loop should run for both product work and go-to-market work.

---

## 4. Capability Domains

Commander should support at least six first-class domains.

### 4.1 Build

Existing scope:

- feature implementation
- refactors
- tests
- docs
- engineering operations

### 4.2 Research

- competitor analysis
- user segmentation
- pricing research
- market mapping
- trend synthesis

### 4.3 Marketing

- launch plan generation
- channel-specific content production
- experiment design
- campaign tracking
- landing page and copy iteration

### 4.4 Sales

- ICP definition
- lead research
- account briefs
- outbound sequence drafting
- objection clustering
- CRM hygiene and follow-up planning

### 4.5 Operations

- support triage
- issue clustering
- release coordination
- documentation upkeep
- KPI monitoring

### 4.6 Feedback-to-Product Iteration

- collect feedback from support, CRM, analytics, and community
- cluster recurring pain points
- convert validated pain points into product signals
- prioritize fixes and experiments
- track whether the change improved user outcomes

---

## 5. New Task Model

The task system should expand from `BUILD | HYBRID` to a richer model.

Recommended top-level task types:

- `BUILD`
- `RESEARCH`
- `MARKET`
- `SALES`
- `OPERATE`
- `ITERATE`
- `HYBRID`

### Example intents

| Task Type | Example |
| --- | --- |
| `BUILD` | "Implement usage-based billing for team accounts" |
| `RESEARCH` | "Analyze the top 20 competitors in AI browser testing" |
| `MARKET` | "Prepare a Product Hunt launch plan and generate launch assets" |
| `SALES` | "Find 50 target accounts and draft outbound messages by segment" |
| `OPERATE` | "Summarize this week's support backlog and identify top incident themes" |
| `ITERATE` | "Review user complaints from the past 14 days and propose product fixes" |
| `HYBRID` | "Analyze churn reasons, update onboarding copy, and implement top fixes" |

---

## 6. Signal Expansion

Current signal design is too code-centric. Commander needs domain-specific executable units.

Recommended signal types:

- `BUILD`: code or configuration changes
- `RESEARCH`: gather facts, sources, comparisons
- `CONTENT`: create copy, assets, messaging drafts
- `OUTREACH`: prepare or schedule outreach actions
- `CAMPAIGN`: set up or adjust a launch/marketing experiment
- `OPS`: perform operational maintenance or triage
- `FEEDBACK`: summarize or cluster user feedback
- `EXPERIMENT`: define hypothesis, metric, and treatment
- `REVIEW`: validate quality, brand, safety, or compliance

### Important distinction

Not every signal should auto-execute externally.

There are three execution classes:

- `internal`: safe local actions, such as writing docs, code, reports, CRM notes
- `proposed`: produces artifacts for human approval, such as outbound email drafts or ad copy
- `guarded-external`: allowed to call external systems under explicit constraints, such as updating a CRM field or tagging feedback

Commander should default to `internal` and `proposed`. `guarded-external` should require policy checks.

---

## 7. Safety Model

Automatic sales/marketing is high leverage but also high risk. The system needs a stronger action policy before broadening execution.

### Required controls

- Brand policy: tone, banned claims, approved positioning
- Budget policy: spend caps, daily limits, channel allowlists
- Contact policy: who can be contacted, frequency, opt-out handling
- Data policy: PII boundaries, source provenance, retention rules
- Approval policy: which actions require human sign-off
- Rollback policy: how campaigns, copy, or workflows are reverted

### Practical default

Phase 1 should be recommendation-first:

- Commander can research, draft, prioritize, and prepare
- Commander should not autonomously publish externally at scale until policy and audit layers exist

---

## 8. Architecture Changes

### 8.1 Re-expand the pipeline

The v2 slim pipeline was fine for coding throughput, but too narrow for project operations.

Recommended phases:

1. Task classification
2. Context intake
3. Research / evidence gathering
4. Audience / segment analysis
5. Strategy synthesis
6. Signal decomposition
7. Execution
8. Measurement
9. Iteration planning

### 8.2 Introduce domain adapters

Commander should work through adapters instead of hardcoding coding workflows.

Examples:

- Git adapter
- Docs/content adapter
- Analytics adapter
- CRM adapter
- Support/ticket adapter
- Community/social adapter
- Ad platform adapter

Each adapter should expose:

- `readContext()`
- `listEntities()`
- `proposeActions()`
- `executeAction()`
- `collectMetrics()`
- `writeBackObservations()`

### 8.3 Add a project memory layer

The colony needs persistent non-code memory:

- ICP definitions
- messaging variants
- campaign history
- user feedback clusters
- churn reasons
- launch postmortems
- experiment outcomes

This is where the pheromone model becomes especially valuable: the system should learn which messages, channels, and changes worked before.

---

## 9. Feedback Loop Design

The most valuable extension is not "auto marketing" by itself.

It is the closed loop:

1. Collect signals from users
2. Cluster feedback into themes
3. Estimate impact and urgency
4. Generate product or messaging responses
5. Dispatch build/ops/market tasks
6. Observe downstream metrics
7. Feed results back into prioritization

### Example

- Users complain that onboarding is confusing
- Commander clusters complaints into "time to first success too long"
- Commander proposes:
  - onboarding copy changes
  - guided setup email
  - product UI simplification
  - activation metric tracking
- Commander dispatches:
  - `CONTENT` signals for copy
  - `BUILD` signals for UI changes
  - `EXPERIMENT` signal for activation measurement
- Commander later compares activation and support volume before/after

That is a real autonomous operating loop, not just a code swarm.

---

## 10. Concrete Repo Changes

These are the minimum code-level changes needed to align implementation with the broader product direction.

### Phase A: semantic broadening

- Expand `TaskClassifier` to classify non-code intents.
- Expand `Plan.taskType` beyond `BUILD | HYBRID`.
- Expand `deliverableFormat` to include `report`, `content`, `ops`, `mixed`.
- Update decomposition prompts so they can emit non-code signals.

Primary files:

- `commander/src/engine/classifier.ts`
- `commander/src/engine/decomposer.ts`
- `commander/src/engine/pipeline.ts`
- `commander/src/colony/plan-writer.ts`

### Phase B: domain-aware execution

- Add adapter contracts for CRM, analytics, support, and content systems.
- Add execution classes: `internal`, `proposed`, `guarded-external`.
- Add policy checks before external execution.

### Phase C: feedback intelligence

- Add ingestion pipelines for feedback and KPI data.
- Add clustering/prioritization logic.
- Add automatic conversion from feedback themes to build/market/ops signals.

### Phase D: full autonomous project operation

- Add scheduled recurring objectives.
- Add weekly operating reviews.
- Add automatic re-planning based on measured outcomes.

---

## 11. Recommended Rollout

Do not jump directly to "fully autonomous sales."

Recommended order:

1. Expand planning semantics beyond coding.
2. Make Commander excellent at research, synthesis, reporting, and feedback clustering.
3. Add human-approved marketing and sales artifact generation.
4. Add narrow guarded integrations for CRM/support updates.
5. Add closed-loop product iteration from user feedback.
6. Add selective autonomous external actions only after policy and auditability are mature.

This sequence matches the current strengths of the project and avoids premature operational risk.

---

## 12. Bottom Line

The user's intuition is correct:

- Commander should not be limited to automatic coding.
- The right abstraction is autonomous project operation.
- The strongest wedge is not "auto-selling" in isolation.
- The strongest wedge is turning user feedback, market signals, and project goals into a continuous execution loop across code and operations.

If Commander does this well, "coding agent" becomes only one worker role inside a much larger system.
