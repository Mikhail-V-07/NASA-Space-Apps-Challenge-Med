# AEGIS v3 — Development Plan

Status: v3.1 increments delivered · 2026-11-15 · repository `Mikhail-V-07/NASA-Space-Apps-Challenge-Med`, branch `analytics-so-on` (kept separate from `main`)

## Increments

| # | Increment | Result | State |
|---|---|---|---|
| 1 | **Vertical slice**: registry → observation → trend/baseline → concern → action → follow-up → outcome → closure; persistence; v2 migration | Working in the browser | ✅ Done (2686665, 8b19963, 4f4f7aa) |
| 2 | **Domain expansion (v3.1)**: analytics framework, versioned baseline policies, preventive plans and adherence, data-driven rules → attention items, clinical framework (intake, exam, illustrative workflows, safety checks, decisions, priority/emergency), mission presets, store-and-forward messages, lot/expiry inventory, sourced knowledge base, assistant provider architecture, seeded v3 simulator | 29 new unit tests | ✅ Done (fd1ac18) |
| 3 | **Connected UI (v3.1)**: tabbed health workspace (Overview, Monitoring, Analytics, Prevention, Care, Profile, Mission & resources, Knowledge & assistant); synthetic workspace writable in Simulated scope; CMO rule and mission configuration | Full loop in the browser for both data workspaces | ✅ Done (8cc5b23) |
| 4 | **Retire Core v2 paths**: move DEMO-ENV-01 into the rules engine (needs an environment observation type), migrate spacecraft/events views to the v3 synthetic workspace, then drop the v2 projection (D-05) | One data model | Next |
| 5 | **Follow-up as plan items**: an intervention's follow-up creates a time-bounded plan item, so it appears in Prevention and adherence | Tighter loop | Next |
| 6 | **Export / import**: per-subject private export package and import of device files (CSV) mapped through the registry | Data exchange | Planned |
| 7 | **Cross-crew views (CMO)**: crew-level attention list and adherence, shared-environment rule | Crew overview | Planned |
| 8 | Hardening: App UI tests in CI, React typecheck, accessibility pass, mobile layout, storage-size budget for long simulations | — | Ongoing |

## How to run

```sh
npm ci
npm run check      # lint + vitest + typecheck + build
npm run dev
```

Demo path:

1. **Astronaut, Observed records.** Monitoring: record readings; propose a baseline (the default policy needs 7 readings; lower the minimum to try it). Care: record a concern and a structured intake.
2. **Crew Medical Officer.** Accept the baseline; in Care, record a finding, start the *General symptom assessment* workflow, step through it (safety issues must be acknowledged), record a decision and queue a ground message. Load the demonstration plan (Prevention) and inventory (Mission & resources).
3. **Simulated scope** (Data workspace → Synthetic). The seeded scenario (default *Sleep disruption*, seed 42, 21 days) shows attention items for Mira Chen. Open a care encounter from an item, run the *Emergency coordination* workflow and note the equipment issue (ECG monitor under maintenance). Regenerate with another scenario or seed; observed records are untouched.
4. Ask the assistant about sleep or bone loss (sourced answers) and about a dose (refused).

## Verification so far

The sandbox cannot reach the npm registry, so `npm run check` was **not** run here. Instead:

- Unit tests under a vitest-compatible runner: domain 17/17, v3.1 domain 29/29, reducer 10/10, persistence 8/8, health engine 9/9, simulator 6/6.
- Strict typecheck (TypeScript 6, repo flags) of domain, simulator, store and persistence: passed. React views were not typechecked (no `@types/react` available).
- Playwright run of the demo path above against an esbuild bundle: all steps passed, reload persistence verified, no console errors.
- `src/app/App.test.tsx` was **not executed** (no jsdom). Run `npm run check` locally or in CI.

## Open items needing a team decision

1. Baseline policy defaults per parameter (D-01, now configurable; default 7 of last 14 is provisional).
2. Self-care policy (D-03).
3. Units and derivation methods for PAL and Body movement.
4. Which rules, if any, should become "approved" — requires the mission medical authority and sourced reference values; none exist in AEGIS.
5. Contract changes in `contracts/types.ts` are additive (see commit fd1ac18). Per AGENTS.md rule 9 the team should review them.
