# AEGIS v3 — Development Plan

Status: increment 1 done · 2026-11-15 · branch `analytics-so-on`

## Increments (each one is end-to-end and demonstrable)

| # | Increment | Result | State |
|---|---|---|---|
| 1 | **Vertical slice**: registry → observation → trend and baseline → concern → action → follow-up → outcome → closure, with persistence and migration | Working in the browser | ✅ Done (commits 2686665, 8b19963, 4f4f7aa) |
| 2 | **Preventive plan**: `CarePlanItem` (scheduled measurements and countermeasures), due prompts, adherence view; follow-ups appear as plan items | Prompts and adherence in My Health | Next |
| 3 | **Rules engine**: `AnalysisRule` data model; move DEMO-RECOVERY-01 / ENV-01 into it; CMO-configurable baseline-delta rules labelled demonstration; attention items can open an encounter | Monitoring → attention → encounter loop | Planned |
| 4 | **Simulator on v3**: synthetic HR, PR, SpO₂, RR, BP, body mass, sleep; scenarios feed v3 directly; remove the v2 projection where possible | One data model | Planned |
| 5 | **Resources**: synthetic medical inventory, availability check when recording a medication or procedure action, depletion view | Resource constraints visible | Planned |
| 6 | **Protocol framework (illustrative)**: step-guided encounter templates loaded as data, clearly marked illustrative | CDS demonstration without clinical claims | Planned |
| 7 | **Ground link**: store-and-forward packages; private-data export per subject | Delayed-comms demo | Planned |
| 8 | Hardening: accessibility pass, App UI tests in CI, mobile layout | — | Ongoing |

## How to run

```sh
npm ci
npm run check      # lint + vitest + typecheck + build
npm run dev
```

Start in Astronaut Mode → My Health. Select a parameter tile, record readings, propose a baseline, record a concern, record an action with a follow-up, record a follow-up reading. Then switch to Crew Medical Officer Mode to accept the baseline, record the outcome and close the encounter.

## Verification so far

The build sandbox could not reach the npm registry, so `npm run check` was **not** run there. Instead:

- Unit tests ran under a minimal vitest-compatible runner: domain 17/17, reducer 9/9, persistence 6/6, health engine 9/9, simulator 6/6.
- Strict typecheck (TypeScript 6, repo flags) passed for the domain, store, persistence and engine modules. The React views were not typechecked: no `@types/react` was available.
- Playwright end-to-end run of the full slice against an esbuild bundle: both roles, reload persistence, synthetic read-only preview, no console errors.
- `src/app/App.test.tsx` was updated for the new UI but **not executed** (no jsdom). Run `npm run check` locally or in CI before merging.

## Open items needing a team decision (not blocking increment 2)

1. Baseline protocol (D-01): window, number of readings, conditions.
2. Self-care policy (D-03): which action types an astronaut may record alone.
3. Units and derivation methods for PAL and Body movement.
