import type { HealthMeasurement, MetricKey, Observation } from '../../contracts/types'

/**
 * Bridge between Core v2 `HealthMeasurement` (fixed MetricKey union) and v3 `Observation`.
 * v3 is the single writable model. v2 records are DERIVED from v3 so that existing v2 consumers
 * (demo rules, simulator, spacecraft view) keep working during migration. Parameters without a
 * v2 equivalent simply have no v2 projection.
 */
const MAP: { parameterId: string; metric: MetricKey; legacyUnit: string; v3Unit: string | null }[] = [
  { parameterId: 'hr', metric: 'heart_rate', legacyUnit: 'bpm', v3Unit: 'bpm' },
  { parameterId: 'resting_hr', metric: 'resting_heart_rate', legacyUnit: 'bpm', v3Unit: 'bpm' },
  { parameterId: 'sbp', metric: 'blood_pressure_systolic', legacyUnit: 'mmHg', v3Unit: 'mmHg' },
  { parameterId: 'dbp', metric: 'blood_pressure_diastolic', legacyUnit: 'mmHg', v3Unit: 'mmHg' },
  { parameterId: 'sleep_duration', metric: 'sleep_duration', legacyUnit: 'h', v3Unit: 'h' },
  { parameterId: 'exercise_duration', metric: 'exercise_duration', legacyUnit: 'min', v3Unit: 'min' },
  { parameterId: 'fatigue', metric: 'reported_fatigue', legacyUnit: '0–10', v3Unit: null },
  { parameterId: 'mood', metric: 'reported_mood', legacyUnit: '0–10', v3Unit: null },
  { parameterId: 'stress', metric: 'reported_stress', legacyUnit: '0–10', v3Unit: null },
  { parameterId: 'symptom_severity', metric: 'symptom_severity', legacyUnit: '0–10', v3Unit: null },
  { parameterId: 'bmd', metric: 'bone_mineral_density', legacyUnit: 'g/cm²', v3Unit: 'g_per_cm2' },
]
const byParameter = new Map(MAP.map(m => [m.parameterId, m]))
const byMetric = new Map(MAP.map(m => [m.metric, m]))

const sourceFor = (method: HealthMeasurement['source']) => method === 'simulator' ? 'mission-simulator' : method === 'manual' ? 'manual-entry' : method === 'wearable' ? 'bio-monitor' : 'file-import'

export function toLegacy(o: Observation): HealthMeasurement | null {
  const m = byParameter.get(o.parameterId)
  if (!m || (o.value && o.value.type === 'waveform')) return null
  const value = o.value ? o.value.value : null
  return {
    id: o.id, astronautId: o.subjectId, metric: m.metric, value, unit: m.legacyUnit, timestamp: o.effectiveAt,
    source: o.method, origin: o.origin, quality: o.quality, sourceRefId: o.sourceId,
    ...(o.context?.compartmentId ? { compartmentId: o.context.compartmentId } : {}),
    ...(o.demonstrationOnly ? { demonstrationOnly: true } : {}),
    ...(o.context?.note ? { note: o.context.note } : {}),
  }
}

export function fromLegacy(r: HealthMeasurement): Observation | null {
  const m = byMetric.get(r.metric)
  if (!m || r.unit !== m.legacyUnit) return null
  const value: Observation['value'] = r.value === null ? null : m.v3Unit === null ? { type: 'ordinal', value: r.value } : { type: 'quantity', value: r.value, unitId: m.v3Unit }
  const context = { ...(r.compartmentId ? { compartmentId: r.compartmentId } : {}), ...(r.note ? { note: r.note } : {}) }
  return {
    id: r.id, subjectId: r.astronautId, parameterId: m.parameterId, parameterVersion: 1, value,
    effectiveAt: r.timestamp, recordedAt: r.timestamp, sourceId: sourceFor(r.source), method: r.source,
    origin: r.origin, quality: r.quality, ...(Object.keys(context).length ? { context } : {}),
    demonstrationOnly: r.demonstrationOnly ?? r.origin === 'synthetic',
  }
}

export const legacyProjection = (observations: readonly Observation[]) => observations.flatMap(o => toLegacy(o) ?? [])
export const fromLegacyAll = (records: readonly HealthMeasurement[]) => records.flatMap(r => fromLegacy(r) ?? [])
