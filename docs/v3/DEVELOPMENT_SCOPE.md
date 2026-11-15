# AEGIS v3 — Development Scope

Status: active (v3.1) · 2026-11-15 · branch `analytics-so-on`

## Product direction (unchanged)

AEGIS is an integrated crew health monitoring and decision-support system. It links continuous monitoring, individual health profiles, preventive management, medical encounters, intervention tracking and follow-up into one process (project concept, `nasa project 4.txt`).

## Ground rules that shape every tier

- **No real-world diagnosis, treatment authorization or autonomous intervention.** AEGIS informs and supports. People decide, and AEGIS records their decisions.
- **Demonstrated ≠ validated.** Demonstration content is labelled `demonstrationOnly` or `protocol: illustrative` in data and in the UI.
- **No invented clinical values.** The registry ships with no reference ranges, thresholds or diagnostic rules. Input checks are definitional only.
- **Computer vision is excluded.** Nothing depends on it.

## Tiers

| Capability (concept §) | Tier | State |
|---|---|---|
| Extensible parameter registry (§3, §10) | **Implemented** | 24 parameters (adds fluid and energy intake; exact kJ→kcal). PAL and Body movement stay *provisional*. |
| Observations with provenance; missing ≠ 0 (§3) | **Implemented** | Manual, grouped, unit-converted, waveform import; synthetic entries in the simulated workspace |
| Health profile: history, allergies, medications (as reported), limitations, risk factors and pre-flight results (CMO), qualifications, baselines, closed encounters (§4) | **Implemented** | Recorded text; no risk is derived |
| Longitudinal baselines: policies (method, dataset, minimum), versions, supersession, recalculation (§4) | **Implemented** | Default policy provisional; 3 readings is only the arithmetic floor |
| Analytics: windows, trend with uncertainty, completeness vs plan cadence, quality, freshness, spread, window comparison, multi-parameter view; pluggable analyses (§4) | **Implemented (descriptive)** | No normal/abnormal judgement |
| Rules → attention items, configurable by CMO (§4) | **Demonstration** | 9 shipped rules, all `demonstration`; DEMO-RECOVERY-01 re-expressed; `approved` cannot be set inside AEGIS |
| Preventive plans: schedule, completion/skip, adherence from readings, intake totals, CMO editor, escalation to care (§5) | **Demonstration** | Demonstration plan cadences are illustrative; no clinical targets |
| Care workflow: concern → encounter → action → follow-up → outcome → closure (§6, §9) | **Implemented** | Role-limited, audited |
| Clinical framework: structured intake, exam findings, priority/emergency mode, guided workflows with safety checks (equipment, qualification, comms), decision records (§6) | **Demonstration** | 3 *illustrative* workflows with no criteria, drugs or doses |
| Approved protocols, medication/contraindication checks, reference ranges (§6, §8) | **Requires validated clinical content** | Types exist; nothing approved is loaded |
| Mission configuration: presets with sourced comms/resupply context, crew qualifications (§8, §11) | **Demonstration** | Level-of-care labels are placeholders until NASA/TM-2017-219290 is reviewed |
| Medical inventory: lots, expiry, FEFO use, forecast to mission end (§8) | **Demonstration** | Generic categories only, synthetic quantities |
| Ground communication: store-and-forward with mission delay (§11) | **Demonstration** | Recorded and timed locally; not transmitted or encrypted |
| Knowledge layer with sources (§7) | **Implemented (reference)** | 8 articles, every point cited to the source digest |
| Assistant (§7) | **Architecture + local retrieval** | Provider interface; local keyword provider with guardrails; LLM provider is a stub marked *not connected* |
| v3 simulator: seeded, reproducible scenarios feeding all workflows | **Implemented (synthetic)** | 4 scenarios; values are not physiological predictions |
| Core v2 simulator, spacecraft view, assessments, DEMO-ENV-01 | **Retained** | To migrate (plan increment 4) |
| Device integration (§3) | **Requires external dependency** | Sources registered as `not_connected` |
| Derived indicators (PAL, HRV) | **Deferred** | Method must be defined |
| Computer vision, speech/keystroke behavioural analysis | **Excluded** | |

## Definition of done for each increment

Domain tests pass, the store and domain typecheck strictly, and an end-to-end browser run passes with no console errors. Docs are updated and every label stays honest (synthetic, demonstration or illustrative).
