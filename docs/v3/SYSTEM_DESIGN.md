# AEGIS v3 — System Design

Status: implemented for slice 1; sections marked *(planned)* are not yet built · 2026-11-15

## 1. Boundaries

| Responsibility | AEGIS software | Astronaut | Crew Medical Officer (CMO) | Ground medical | Devices / vehicle |
|---|---|---|---|---|---|
| Capture and store observations | validates, stores, shows provenance | records own data | records any crew member's data | receives exports *(planned)* | measure (not connected yet) |
| Trend and baseline | computes descriptive statistics | proposes a baseline | proposes and **accepts** a baseline | — | — |
| Flag deviations | *(planned)* rules engine; each rule labelled demonstration or approved | — | configures rules *(planned)* | supplies approved criteria | — |
| Concern / encounter | structures and links evidence | opens, adds notes | opens, adds notes, **closes** | — | — |
| Actions (interventions) | **records only**; never selects | records self-care actions only (monitoring, activity adjustment) | records any action type | concurs or modifies (off-system) | — |
| Follow-up outcome | shows the evidence collected after the action | — | **judges** the outcome, citing readings | — | — |
| Clinical knowledge | holds; never authors | — | — | owns | — |

The demo context switch is **not authentication**. These rules are enforced in the domain layer (`src/domain/workspace.ts`, `care.ts`), not only in the UI.

## 2. Structure

```
contracts/types.ts      canonical types (v1/v2 retained; v3 appended, additive)
src/domain/             pure TypeScript, no React, fully unit-tested
  registry.ts           categories, units, data sources, parameter definitions + integrity check
  observations.ts       structural schema, registry-aware checks, exact unit normalisation
  series.ts             series, summaries, descriptive baselines, differences, freshness
  care.ts               encounter / intervention / follow-up / outcome rules
  workspace.ts          commands + audit, role scoping, persistence schema, v2 migration
  legacy.ts             v3 ⇄ v2 HealthMeasurement adapter
src/app/state/          React store: `health` (v3, writable) → derived `personal.measurements` (v2)
src/health/v3/          registry-driven views: overview, detail/trend, entry, care panel
src/simulation, src/health/engine.ts   Core v2 simulator and demo rules (read the v2 projection)
```

There is one writable record for observed data (`state.health`). The v2 projection exists only so Core v2 consumers keep working until they are migrated (plan, increments 3–4).

## 3. Data model

| Entity | Key fields | Notes |
|---|---|---|
| `ParameterDefinition` | id, code, displayName, categoryId, kind (raw_signal · measurement · derived · self_report · examination), valueType (quantity · ordinal · waveform), canonicalUnitId, acceptedUnitIds, entry (definitional), scale, potentialSourceIds, manualEntry, entryGroupId, disambiguation, derivation, status, version, provenance | Data, not code |
| `UnitDefinition` | id, symbol, dimension, toCanonical (exact only) | |
| `DataSourceDefinition` | id, kind, availability (simulated · manual · not_connected), providesParameterIds | |
| `Observation` | subjectId, parameterId + version, value (quantity · ordinal · waveform · null), effectiveAt, recordedAt, sourceId, method, origin, quality, original (pre-conversion), derivedFrom, context (condition, note, encounterId…), demonstrationOnly | Corrections are new records |
| `Baseline` | subjectId, parameterId, unit, method, value (median), summary (n, min, max), observationIds, window, status (proposed · accepted · superseded) | Descriptive |
| `ReferenceValue` | parameterId, unit, low/high, applicability, sourceRefId (required), approvalStatus | None ship |
| `CareEncounter` | subjectId, origin, trigger, concern, status (open · monitoring · closed), observationIds, notes, interventionIds, closure | |
| `Intervention` | encounterId, kind, description, protocol {none · illustrative · approved}, recordedByRole, followUp {dueAt, parameterIds}, outcome {result, note, observationIds} | A record, not a prescription |
| `AuditEntry` | at, role, action, recordIds | Appended by every command |
| `CarePlanItem` *(planned)* | subjectId, kind (measurement · countermeasure · self_report), parameterIds, schedule, status | Adherence = observations in the due windows |
| `AnalysisRule` *(planned)* | id, parameterIds, condition (baseline delta · reference value · missing schedule), configuredByRole, status (demonstration · approved), sourceRefIds | Output = attention item, never a diagnosis |

## 4. Parameter extensibility

**To add a parameter, append one `ParameterDefinition` to `PARAMETERS`.** The overview, entry form, trend, baseline, storage, validation and care follow-up all read the registry, and `createRegistry` rejects inconsistent definitions at startup. Unit tests check that unknown units, conversions without an exact definition and duplicate codes are rejected.

- **Undefined unit or method:** `status: 'provisional'`, `canonicalUnitId: null`, `manualEntry: false`. The parameter is shown as "Definition pending" and cannot be recorded (PAL, Body movement).
- **New unit:** add a `UnitDefinition`. A conversion is allowed only if it is an exact definition.
- **Derived indicator:** `kind: 'derived'` plus `derivation.fromParameterIds`. Observations carry `derivedFrom`. The method stays `null` until it is defined.
- **Raw signal:** `valueType: 'waveform'`. It is imported, never typed, and shown as recorded. AEGIS does not interpret it.
- **Similar parameters:** codes are unique, and `disambiguation` text appears in the detail view. HR and PR are separate series. RRI is in ms, RR is in breaths/min.
- **Versioning:** each observation stores `parameterVersion`. A changed definition increments `version`.

## 5. Data lifecycle

capture (form, import, *planned* device adapters) → `createObservation` (normalise, then structural and registry checks) → command (subject and role checks, then audit) → `state.health` → v2 projection → Core v2 demo rules → views (series, baseline, difference) → care workflow → persisted as `aegis.core.v3`. Restore validates the schema and registry integrity. Invalid stored data is kept unchanged and saving is blocked. On first load a v2 store is migrated, and the v2 copy is left intact.

## 6. Safety and integrity constraints

1. Missing is `null` + `quality: 'missing'`, never 0.
2. Synthetic data never enters the observed workspace (enforced at write and at restore).
3. Entry constraints are definitional only, and the UI says so.
4. No colour or wording labels a value normal or abnormal.
5. `protocol.status = 'approved'` is accepted only for IDs in `APPROVED_PROTOCOL_IDS`, which is empty.
6. Outcomes cite readings recorded **after** the action, or are marked "not assessable".
7. An encounter closes only in the CMO context, and only once every scheduled follow-up has an outcome. Closed encounters are read-only.
8. The astronaut context reads and writes only its own records (`visibleTo`, `assertSubject`).

## 7. Interfaces and external dependencies

| Interface | State |
|---|---|
| Manual entry, waveform file import | Implemented |
| Device adapters (Bio-Monitor, ECG, BP, oximeter, TcCO₂) → `createObservation` with `method: 'wearable'` | *Planned*; sources registered as not connected |
| Ground transmission: scoped JSON export (v3) | Export implemented; store-and-forward *planned* |
| Approved protocol and drug libraries | External; required before clinical use |
| Mission simulator | Core v2. It will emit v3 parameters *(planned)* |

## 8. Existing implementation: evaluation

| Item | Decision | Reason |
|---|---|---|
| Vite/React/TS/Tailwind shell, design system, navigation | **Reused** | Sound and offline |
| Provenance fields, `null` for missing, zod validation, guarded persistence and recovery | **Reused / adapted** | Matches v3 needs |
| `MetricKey` union + `measurementRules` | **Replaced** by the registry | A closed union blocks new parameters |
| `HealthMonitor` (fixed 3 tiles, fixed form) | **Rebuilt** as `src/health/v3` | Not registry-driven |
| Alert-bound `MedicalEncounter` (v2) | **Kept for scenario cases**; v3 `CareEncounter` used for observed care | v2 encounters exist only for alerts and have no interventions |
| Demo rules DEMO-RECOVERY-01 / ENV-01 | **Kept**, read via the projection; to move into the rules engine | Their thresholds are labelled demo |
| Simulator, spacecraft view, assessments, research registry | **Kept** | Working; outside this slice |
| `develop` branch vision work | **Not merged** | CV excluded |

## 9. Provisional decisions (reversible)

| ID | Decision | Revisit when |
|---|---|---|
| D-01 | Baseline = median of the last 3 valid readings chosen by the user; the CMO accepts | The team defines a baseline protocol |
| D-02 | Resting HR stays a separate parameter (from Core v2) rather than HR with a "resting" condition | Simulator moves to v3 |
| D-03 | Astronaut self-care kinds = monitoring, activity adjustment | The team defines a self-care policy |
| D-04 | Sleep, exercise and self-rating scales kept from Core v2 as registry entries | The parameter list evolves |
| D-05 | v2 projection kept until the simulator and rules read v3 | Plan increment 4 |
