# AEGIS v3 — Development Scope

Status: active · 2026-11-15 · branch `analytics-so-on`

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
| Extensible parameter registry: definitions, units, sources, categories (§3, §10) | **Implemented** | 22 parameters: the 14 from the initial list plus 8 from Core v2. PAL and Body movement are *provisional* (unit TBD). |
| Observations: quantity, ordinal, raw waveform; provenance; missing ≠ 0 (§3) | **Implemented** | Manual entry, grouped entry (SBP/DBP), exact unit conversion (L→mL, kPa→mmHg), ECG import |
| Individual profile: longitudinal series, descriptive baseline (proposed → accepted by CMO), difference from baseline (§4, §10) | **Implemented** | Median of ≥ 3 valid readings. Descriptive, never "normal". |
| Concern → encounter → recorded action → follow-up → outcome → closure (§6, §9) | **Implemented** | Role-limited; audit trail |
| Persistence, v2→v3 migration, scoped export (§11) | **Implemented** | `aegis.core.v3`; the v2 copy is left untouched |
| Existing Core v2 features: simulator, demo rules, spacecraft view, assessments | **Retained** | Fed through the v2 projection of v3 data |
| Scheduled measurement and countermeasure plan with adherence (§5) | **Next: demonstration** | Data model drafted in the design (§3, CarePlanItem) |
| Analysis rules engine: configurable, data-driven, each rule labelled demonstration or approved (§4) | **Next: demonstration** | Existing DEMO-RECOVERY/ENV rules migrate into it |
| Simulator emitting v3 parameters (HR, PR, SpO₂, RR …) (§3) | **Next: demonstration** | Synthetic, deterministic, labelled |
| Medical resource inventory: stock, expiry, forecast (§8) | **Next: demonstration** | Synthetic inventory |
| Context-aware health information: per-parameter explanations, sourced (§7) | **Next: demonstration** | Sourced text only |
| Protocol-guided encounter steps (§6.2–6.4) | **Requires validated clinical content** | The framework can be built and shown with *illustrative* protocols. Real use needs an approved protocol library. |
| Medication/contraindication checks (§6.4, §8) | **Requires validated clinical content** | Needs an approved drug reference |
| Reference ranges and abnormality flags (§4, §11) | **Requires validated clinical content** | `ReferenceValue` type exists; the registry ships none |
| Device integration: Bio-Monitor, ECG, oximeter, TcCO₂ (§3) | **Requires external dependency** | Sources registered as `not_connected` |
| Ground transmission and delayed communication (§11) | **Deferred** | Store-and-forward export first |
| Natural-language assistant, LLM (§7) | **Deferred** | Allowed only as an interface over approved content; never decides |
| Crew workload, schedule, power constraints (§8) | **Deferred** | Owned by vehicle and ops systems; consumed later |
| Derived indicators: PAL, HRV from RRI | **Deferred** | Method must be defined first (`derivation.methodId`) |
| Computer vision, speech or keystroke behavioural analysis | **Excluded / deferred** | Unvalidated research (source digest §4) |

## Definition of done for each increment

Domain tests pass, the store and domain typecheck strictly, and an end-to-end browser run passes with no console errors. Docs are updated and every label stays honest (synthetic, demonstration or illustrative).
