import type { DataSourceDefinition, ParameterCategory, ParameterDefinition, UnitDefinition } from '../../contracts/types'

/**
 * AEGIS v3 health parameter registry.
 *
 * Adding a parameter = adding one entry below (or loading one at runtime via createRegistry).
 * No type, schema, storage or engine change is required.
 *
 * Rules (see docs/v3/SYSTEM_DESIGN.md §4):
 *  - No clinical reference ranges, thresholds or diagnostic rules live here.
 *  - `entry` constraints are definitional only (e.g. a percentage cannot exceed 100).
 *  - A parameter whose unit or method is not yet defined is 'provisional' and cannot be recorded.
 *  - Unit conversions are exact definitions only.
 */

export const CATEGORIES: ParameterCategory[] = [
  { id: 'cardiovascular', label: 'Cardiovascular', order: 1 },
  { id: 'respiratory', label: 'Respiratory', order: 2 },
  { id: 'physical', label: 'Physical', order: 3 },
  { id: 'sleep_activity', label: 'Sleep & activity', order: 4 },
  { id: 'self_report', label: 'Self-report', order: 5 },
  { id: 'examination', label: 'Examinations', order: 6 },
  { id: 'intake', label: 'Hydration & nutrition', order: 7 },
]

// 1 mmHg = 101325/760 Pa exactly (conventional definition) → 0.133322368… kPa.
const MMHG_IN_KPA = 101.325 / 760

export const UNITS: UnitDefinition[] = [
  { id: 'bpm', symbol: 'bpm', dimension: 'rate_per_minute' },
  { id: 'breaths_per_min', symbol: 'breaths/min', dimension: 'breath_rate' },
  { id: 'ms', symbol: 'ms', dimension: 'time_interval' },
  { id: 'mV', symbol: 'mV', dimension: 'voltage' },
  { id: 'mmHg', symbol: 'mmHg', dimension: 'pressure' },
  { id: 'kPa', symbol: 'kPa', dimension: 'pressure', canonicalUnitId: 'mmHg', toCanonical: { factor: 1 / MMHG_IN_KPA, offset: 0 } },
  { id: 'percent', symbol: '%', dimension: 'fraction' },
  { id: 'mL', symbol: 'mL', dimension: 'volume' },
  { id: 'L', symbol: 'L', dimension: 'volume', canonicalUnitId: 'mL', toCanonical: { factor: 1000, offset: 0 } },
  { id: 'degC', symbol: '°C', dimension: 'temperature' },
  { id: 'kg', symbol: 'kg', dimension: 'mass' },
  { id: 'h', symbol: 'h', dimension: 'duration_hours' },
  { id: 'min', symbol: 'min', dimension: 'duration_minutes' },
  { id: 'g_per_cm2', symbol: 'g/cm²', dimension: 'areal_density' },
  { id: 'kcal', symbol: 'kcal', dimension: 'energy' },
  // 1 thermochemical kilocalorie = 4.184 kJ exactly (definition).
  { id: 'kJ', symbol: 'kJ', dimension: 'energy', canonicalUnitId: 'kcal', toCanonical: { factor: 1 / 4.184, offset: 0 } },
]

export const SOURCES: DataSourceDefinition[] = [
  { id: 'manual-entry', label: 'Manual entry', kind: 'manual', availability: 'manual', providesParameterIds: [], note: 'Typed by the crew member or CMO.' },
  { id: 'bio-monitor', label: 'Bio-Monitor (wearable)', kind: 'device', availability: 'not_connected', providesParameterIds: ['hr', 'ecg', 'sbp', 'dbp', 'spo2', 'pr', 'rr', 'vt', 'skin_temp'], note: 'Potential source from the project parameter list. No device integration exists yet.' },
  { id: 'ecg-monitor', label: 'ECG monitor', kind: 'device', availability: 'not_connected', providesParameterIds: ['ecg', 'rri'] },
  { id: 'bp-monitor', label: 'Blood pressure monitor', kind: 'device', availability: 'not_connected', providesParameterIds: ['sbp', 'dbp'] },
  { id: 'pulse-oximeter', label: 'Pulse oximeter', kind: 'device', availability: 'not_connected', providesParameterIds: ['spo2', 'pr'] },
  { id: 'tcco2-monitor', label: 'Transcutaneous CO₂ monitor', kind: 'device', availability: 'not_connected', providesParameterIds: ['ptcco2'] },
  { id: 'file-import', label: 'File import', kind: 'import', availability: 'manual', providesParameterIds: [], note: 'Recorded device export loaded from a file.' },
  { id: 'mission-simulator', label: 'Mission simulator', kind: 'simulator', availability: 'simulated', providesParameterIds: ['hr', 'resting_hr', 'spo2', 'rr', 'sbp', 'dbp', 'skin_temp', 'body_mass', 'sleep_duration', 'exercise_duration', 'fatigue', 'mood', 'stress', 'fluid_intake', 'energy_intake'], note: 'Synthetic, deterministic scenario data. Not physiological predictions.' },
]

const base = { version: 1, sourceRefIds: [] as string[], status: 'active' as const }
const initialList = 'AEGIS initial parameter list (project team, 2026-11-15)'
const coreV2 = 'Carried over from AEGIS Core v2 manual entry'

export const PARAMETERS: ParameterDefinition[] = [
  // ── Cardiovascular ──
  { ...base, id: 'hr', code: 'HR', displayName: 'Heart rate', categoryId: 'cardiovascular', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'bpm', acceptedUnitIds: ['bpm'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['bio-monitor', 'manual-entry'], manualEntry: true, disambiguation: 'Recorded separately from Pulse rate (PR): the two can come from different measurement methods.', visualization: 'line', description: 'Heart beats per minute.', provenance: initialList },
  { ...base, id: 'ecg', code: 'ECG', displayName: 'ECG signal', categoryId: 'cardiovascular', kind: 'raw_signal', valueType: 'waveform', canonicalUnitId: 'mV', acceptedUnitIds: ['mV'], potentialSourceIds: ['bio-monitor', 'ecg-monitor', 'file-import'], manualEntry: false, visualization: 'waveform', description: 'Raw electrocardiogram samples. Stored and displayed only; AEGIS does not interpret rhythms.', provenance: initialList },
  { ...base, id: 'rri', code: 'RRI', displayName: 'R-R interval', categoryId: 'cardiovascular', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'ms', acceptedUnitIds: ['ms'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['ecg-monitor', 'manual-entry'], manualEntry: true, disambiguation: 'Interval between successive R waves of the ECG. Not respiratory rate (RR).', visualization: 'line', description: 'Time between consecutive heartbeats on the ECG.', provenance: initialList },
  { ...base, id: 'sbp', code: 'SBP', displayName: 'Systolic blood pressure', categoryId: 'cardiovascular', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'mmHg', acceptedUnitIds: ['mmHg'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['bio-monitor', 'bp-monitor', 'manual-entry'], manualEntry: true, entryGroupId: 'blood_pressure', visualization: 'line', description: 'Systolic component of a blood pressure reading.', provenance: initialList },
  { ...base, id: 'dbp', code: 'DBP', displayName: 'Diastolic blood pressure', categoryId: 'cardiovascular', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'mmHg', acceptedUnitIds: ['mmHg'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['bio-monitor', 'bp-monitor', 'manual-entry'], manualEntry: true, entryGroupId: 'blood_pressure', visualization: 'line', description: 'Diastolic component of a blood pressure reading.', provenance: initialList },
  { ...base, id: 'spo2', code: 'SpO₂', displayName: 'Blood oxygen saturation', categoryId: 'cardiovascular', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'percent', acceptedUnitIds: ['percent'], entry: { min: 0, max: 100, basis: 'definitional', note: 'A saturation percentage cannot exceed 100.' }, potentialSourceIds: ['bio-monitor', 'pulse-oximeter', 'manual-entry'], manualEntry: true, visualization: 'line', description: 'Peripheral oxygen saturation.', provenance: initialList },
  { ...base, id: 'pr', code: 'PR', displayName: 'Pulse rate', categoryId: 'cardiovascular', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'bpm', acceptedUnitIds: ['bpm'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['bio-monitor', 'pulse-oximeter', 'manual-entry'], manualEntry: true, disambiguation: 'Recorded separately from Heart rate (HR): the two can come from different measurement methods.', visualization: 'line', description: 'Peripheral pulses per minute.', provenance: initialList },
  // Kept from Core v2 so existing simulated scenarios and demo rules remain readable.
  { ...base, id: 'resting_hr', code: 'RHR', displayName: 'Resting heart rate', categoryId: 'cardiovascular', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'bpm', acceptedUnitIds: ['bpm'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, disambiguation: 'Heart rate recorded under resting conditions; kept as a separate series from HR.', visualization: 'line', description: 'Heart rate measured at rest.', provenance: coreV2 },

  // ── Respiratory ──
  { ...base, id: 'rr', code: 'RR', displayName: 'Respiratory rate', categoryId: 'respiratory', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'breaths_per_min', acceptedUnitIds: ['breaths_per_min'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['bio-monitor', 'manual-entry'], manualEntry: true, disambiguation: 'Breaths per minute. Not the R-R interval (RRI).', visualization: 'line', description: 'Breaths per minute.', provenance: initialList },
  { ...base, id: 'vt', code: 'VT', displayName: 'Tidal volume', categoryId: 'respiratory', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'mL', acceptedUnitIds: ['mL', 'L'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['bio-monitor', 'manual-entry'], manualEntry: true, visualization: 'line', description: 'Volume of air per breath. Litres are converted exactly to millilitres.', provenance: initialList },
  { ...base, id: 'ptcco2', code: 'PtcCO₂', displayName: 'Transcutaneous CO₂', categoryId: 'respiratory', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'mmHg', acceptedUnitIds: ['mmHg', 'kPa'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['tcco2-monitor', 'manual-entry'], manualEntry: true, visualization: 'line', description: 'Transcutaneous partial pressure of CO₂. kPa is converted exactly to mmHg.', provenance: initialList },

  // ── Physical ──
  { ...base, id: 'skin_temp', code: 'Tskin', displayName: 'Skin temperature', categoryId: 'physical', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'degC', acceptedUnitIds: ['degC'], potentialSourceIds: ['bio-monitor', 'manual-entry'], manualEntry: true, visualization: 'line', description: 'Skin surface temperature. Not core body temperature.', provenance: initialList },
  { ...base, id: 'body_mass', code: 'BM', displayName: 'Body mass', categoryId: 'physical', kind: 'measurement', valueType: 'quantity', canonicalUnitId: 'kg', acceptedUnitIds: ['kg'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['manual-entry'], manualEntry: true, visualization: 'line', description: 'Body mass measurement.', provenance: initialList },
  { ...base, status: 'provisional', id: 'pal', code: 'PAL', displayName: 'Physical activity level', categoryId: 'physical', kind: 'derived', valueType: 'quantity', canonicalUnitId: null, acceptedUnitIds: [], potentialSourceIds: [], manualEntry: false, derivation: { fromParameterIds: [], methodId: null }, visualization: 'line', description: 'Derived from activity data. Unit and derivation method are to be determined; recording is disabled until they are defined.', provenance: initialList },
  { ...base, status: 'provisional', id: 'body_movement', code: 'MOV', displayName: 'Body movement', categoryId: 'physical', kind: 'measurement', valueType: 'quantity', canonicalUnitId: null, acceptedUnitIds: [], potentialSourceIds: [], manualEntry: false, visualization: 'none', description: 'Unit and data source are to be determined; recording is disabled until they are defined.', provenance: initialList },

  // ── Sleep & activity (Core v2) ──
  { ...base, id: 'sleep_duration', code: 'SLP', displayName: 'Sleep duration', categoryId: 'sleep_activity', kind: 'self_report', valueType: 'quantity', canonicalUnitId: 'h', acceptedUnitIds: ['h'], entry: { min: 0, max: 24, basis: 'definitional', note: 'One sleep period per record (at most 24 h).' }, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Duration of the last sleep period.', provenance: coreV2 },
  { ...base, id: 'exercise_duration', code: 'EX', displayName: 'Exercise duration', categoryId: 'sleep_activity', kind: 'self_report', valueType: 'quantity', canonicalUnitId: 'min', acceptedUnitIds: ['min'], entry: { min: 0, max: 1440, basis: 'definitional', note: 'At most one day per record.' }, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Duration of an exercise session.', provenance: coreV2 },

  // ── Self-report scales (Core v2; descriptive, not validated instruments) ──
  { ...base, id: 'fatigue', code: 'FAT', displayName: 'Fatigue (self-rating)', categoryId: 'self_report', kind: 'self_report', valueType: 'ordinal', canonicalUnitId: null, acceptedUnitIds: [], scale: { min: 0, max: 10, lowAnchor: 'none', highAnchor: 'maximum', validatedInstrument: false }, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Descriptive 0–10 self-rating. Not a validated questionnaire.', provenance: coreV2 },
  { ...base, id: 'mood', code: 'MOOD', displayName: 'Mood (self-rating)', categoryId: 'self_report', kind: 'self_report', valueType: 'ordinal', canonicalUnitId: null, acceptedUnitIds: [], scale: { min: 0, max: 10, lowAnchor: 'very low', highAnchor: 'very good', validatedInstrument: false }, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Descriptive 0–10 self-rating. Not a validated questionnaire.', provenance: coreV2 },
  { ...base, id: 'stress', code: 'STR', displayName: 'Stress (self-rating)', categoryId: 'self_report', kind: 'self_report', valueType: 'ordinal', canonicalUnitId: null, acceptedUnitIds: [], scale: { min: 0, max: 10, lowAnchor: 'none', highAnchor: 'maximum', validatedInstrument: false }, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Descriptive 0–10 self-rating. Not a validated questionnaire.', provenance: coreV2 },
  { ...base, id: 'symptom_severity', code: 'SYM', displayName: 'Symptom severity (self-rating)', categoryId: 'self_report', kind: 'self_report', valueType: 'ordinal', canonicalUnitId: null, acceptedUnitIds: [], scale: { min: 0, max: 10, lowAnchor: 'none', highAnchor: 'maximum', validatedInstrument: false }, requiresNote: true, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Describe the symptom in the note. Not a diagnosis.', provenance: coreV2 },

  // ── Examinations (Core v2) ──
  // ── Hydration & nutrition (v3.1; intake logging for preventive plans) ──
  { ...base, id: 'fluid_intake', code: 'FLU', displayName: 'Fluid intake', categoryId: 'intake', kind: 'self_report', valueType: 'quantity', canonicalUnitId: 'mL', acceptedUnitIds: ['mL', 'L'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Fluid consumed in one logged period. AEGIS sums logs; it sets no intake target.', provenance: 'AEGIS v3.1 preventive-plan logging (project team)' },
  { ...base, id: 'energy_intake', code: 'KCAL', displayName: 'Energy intake', categoryId: 'intake', kind: 'self_report', valueType: 'quantity', canonicalUnitId: 'kcal', acceptedUnitIds: ['kcal', 'kJ'], entry: { min: 0, basis: 'definitional' }, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Food energy logged for one meal or period. kJ is converted exactly to kcal. No target is set by AEGIS.', provenance: 'AEGIS v3.1 preventive-plan logging (project team)' },

  { ...base, id: 'bmd', code: 'BMD', displayName: 'Bone mineral density (exam)', categoryId: 'examination', kind: 'examination', valueType: 'quantity', canonicalUnitId: 'g_per_cm2', acceptedUnitIds: ['g_per_cm2'], entry: { min: 0, basis: 'definitional' }, requiresNote: true, potentialSourceIds: ['manual-entry', 'mission-simulator'], manualEntry: true, visualization: 'line', description: 'Recorded result of a bone density examination. Include site and report in the note.', provenance: coreV2 },
]

export interface Registry {
  categories: ParameterCategory[]
  units: UnitDefinition[]
  sources: DataSourceDefinition[]
  parameters: ParameterDefinition[]
  parameter(id: string): ParameterDefinition | undefined
  unit(id: string): UnitDefinition | undefined
  source(id: string): DataSourceDefinition | undefined
}

/** Builds a registry and checks referential integrity. Throws on an inconsistent definition. */
export function createRegistry(input: { categories: ParameterCategory[]; units: UnitDefinition[]; sources: DataSourceDefinition[]; parameters: ParameterDefinition[] }): Registry {
  const problems = registryProblems(input)
  if (problems.length) throw new Error(`Invalid parameter registry: ${problems.join('; ')}`)
  const p = new Map(input.parameters.map(x => [x.id, x])), u = new Map(input.units.map(x => [x.id, x])), s = new Map(input.sources.map(x => [x.id, x]))
  return { ...input, parameter: id => p.get(id), unit: id => u.get(id), source: id => s.get(id) }
}

export function registryProblems(input: { categories: ParameterCategory[]; units: UnitDefinition[]; sources: DataSourceDefinition[]; parameters: ParameterDefinition[] }): string[] {
  const problems: string[] = []
  const dup = (label: string, ids: string[]) => { const seen = new Set<string>(); for (const id of ids) { if (seen.has(id)) problems.push(`duplicate ${label} '${id}'`); seen.add(id) } }
  dup('parameter id', input.parameters.map(p => p.id)); dup('parameter code', input.parameters.map(p => p.code))
  dup('unit', input.units.map(u => u.id)); dup('source', input.sources.map(s => s.id)); dup('category', input.categories.map(c => c.id))
  const units = new Map(input.units.map(u => [u.id, u])), categories = new Set(input.categories.map(c => c.id)), sources = new Set(input.sources.map(s => s.id)), params = new Set(input.parameters.map(p => p.id))
  for (const u of input.units) if (u.toCanonical && (!u.canonicalUnitId || units.get(u.canonicalUnitId)?.dimension !== u.dimension)) problems.push(`unit '${u.id}' converts to a missing or different-dimension unit`)
  for (const p of input.parameters) {
    if (!categories.has(p.categoryId)) problems.push(`${p.id}: unknown category`)
    for (const s of p.potentialSourceIds) if (!sources.has(s)) problems.push(`${p.id}: unknown source '${s}'`)
    if (p.valueType === 'ordinal') {
      if (!p.scale) problems.push(`${p.id}: ordinal parameter needs a scale`)
      if (p.canonicalUnitId !== null || p.acceptedUnitIds.length) problems.push(`${p.id}: ordinal scales carry no unit`)
    } else if (p.canonicalUnitId === null) {
      if (p.status !== 'provisional') problems.push(`${p.id}: a parameter without a defined unit must be provisional`)
      if (p.manualEntry) problems.push(`${p.id}: provisional parameter cannot accept entry`)
    } else {
      const canonical = units.get(p.canonicalUnitId)
      if (!canonical) problems.push(`${p.id}: unknown canonical unit`)
      if (!p.acceptedUnitIds.includes(p.canonicalUnitId)) problems.push(`${p.id}: accepted units must include the canonical unit`)
      for (const id of p.acceptedUnitIds) {
        const unit = units.get(id)
        if (!unit) problems.push(`${p.id}: unknown unit '${id}'`)
        else if (id !== p.canonicalUnitId && unit.canonicalUnitId !== p.canonicalUnitId) problems.push(`${p.id}: unit '${id}' has no exact conversion to '${p.canonicalUnitId}'`)
      }
    }
    if (p.kind === 'raw_signal' && p.manualEntry) problems.push(`${p.id}: raw signals are imported, not typed`)
    if (p.derivation) for (const id of p.derivation.fromParameterIds) if (!params.has(id)) problems.push(`${p.id}: derived from unknown parameter '${id}'`)
    if (p.entry && p.entry.min !== undefined && p.entry.max !== undefined && p.entry.min > p.entry.max) problems.push(`${p.id}: entry min exceeds max`)
  }
  for (const s of input.sources) for (const id of s.providesParameterIds) if (!params.has(id)) problems.push(`source '${s.id}' provides unknown parameter '${id}'`)
  return problems
}

export const registry: Registry = createRegistry({ categories: CATEGORIES, units: UNITS, sources: SOURCES, parameters: PARAMETERS })
